// Surface placement on browsers that provide an immersive WebXR session.
const THREE_URL = './tracking/three/three.module.js';
const POSTER_HEIGHT = 9 / 16;
const DEFAULT_WIDTH = 0.9;

// Hit poses use their local +Y axis as the surface normal.
// Reject surfaces that tilt more than 20 degrees away from vertical.
const MAX_WALL_NORMAL_Y = Math.sin(20 * Math.PI / 180);
const MIN_STABLE_TIME_MS = 120;

export async function supportsNativeWall() {
  try {
    return Boolean(window.isSecureContext && await navigator.xr?.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

function createArtwork(T, video, posterUrl) {
  const still = new T.TextureLoader().load(posterUrl);
  still.colorSpace = T.SRGBColorSpace;
  const film = new T.VideoTexture(video);
  film.colorSpace = T.SRGBColorSpace;
  const geometry = new T.PlaneGeometry(1, POSTER_HEIGHT);
  const artMaterial = new T.MeshBasicMaterial({ map: still, toneMapped: false });
  const frameMaterial = new T.MeshBasicMaterial({ color: 0x282622 });
  const artwork = new T.Group();
  const frame = new T.Mesh(geometry, frameMaterial);
  frame.position.z = -0.002;
  frame.scale.set(1.016, 1.028, 1);
  artwork.add(frame, new T.Mesh(geometry, artMaterial));

  // The reticle also works on headsets where the phone's DOM overlay is absent.
  const guides = [];
  for (const x of [-0.5, 0.5]) {
    for (const y of [-POSTER_HEIGHT / 2, POSTER_HEIGHT / 2]) {
      guides.push(x - Math.sign(x) * 0.075, y, 0, x, y, 0,
        x, y, 0, x, y - Math.sign(y) * 0.075, 0);
    }
  }
  const guideGeometry = new T.BufferGeometry();
  guideGeometry.setAttribute('position', new T.Float32BufferAttribute(guides, 3));
  const guideMaterial = new T.LineBasicMaterial({ color: 0xfff4d8, toneMapped: false });
  const guide = new T.LineSegments(guideGeometry, guideMaterial);
  const root = new T.Group();
  root.matrixAutoUpdate = false;
  root.visible = false;
  root.add(artwork, guide);
  artwork.visible = false;

  return {
    root,
    setPlaced(placed) {
      artwork.visible = placed;
      guide.visible = !placed;
    },
    setWidth(width) {
      artwork.scale.setScalar(width);
      guide.scale.setScalar(width);
    },
    updateFrame() {
      const hasFrame = video.readyState >= 2 && video.videoWidth > 0;
      const texture = hasFrame ? film : still;
      if (artMaterial.map !== texture) {
        artMaterial.map = texture;
        artMaterial.needsUpdate = true;
      }
    },
    dispose() {
      for (const resource of [still, film, geometry, artMaterial, frameMaterial, guideGeometry, guideMaterial]) {
        resource.dispose();
      }
    }
  };
}

// No awaits precede requestSession. The initiating tap supplies user activation.
export function startWebXR({
  canvas, video, posterUrl, overlayRoot, onStatus = () => {}, onError = () => {}, onEnd = () => {}
}) {
  let status = '';
  let stopped = false;
  let cleaned = false;
  let placed = false;
  let requestPlace = false;
  let anchorGeneration = 0;
  let anchor = null;
  let session, renderer, artwork, hits, removeListeners, pendingSession;
  let width = DEFAULT_WIDTH;
  let stopTask;
  let clearHistory = () => {};

  function report(state, message) {
    if (state === status || stopped) return;
    status = state;
    onStatus(state, message);
  }

  function resetAnchor() {
    anchorGeneration++;
    anchor?.delete();
    anchor = null;
  }

  function reset() {
    requestPlace = false;
    resetAnchor();
    placed = false;
    clearHistory();
    video.pause();
    if (artwork) {
      artwork.root.visible = false;
      artwork.setPlaced(false);
    }
    report('searching', 'Move slowly across a well-lit wall with visible detail.');
  }

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    removeListeners?.();
    renderer?.setAnimationLoop(null);
    try { hits?.cancel(); } catch { /* A system-ended session already released the source. */ }
    resetAnchor();
    video.pause();
    artwork?.dispose();
    renderer?.dispose();
  }

  function stop() {
    if (stopTask) return stopTask;
    stopped = true;
    stopTask = (async () => {
      // A close during the permission dialog must end the session when it arrives.
      const currentSession = session || await pendingSession?.catch(() => null);
      try { await currentSession?.end(); } catch { /* Ended through the system UI. */ }
      cleanup();
    })();
    return stopTask;
  }

  function place() {
    if (!stopped && !placed && status === 'wall-ready') {
      requestPlace = true;
      return true;
    }
    return false;
  }

  async function run() {
    if (!navigator.xr) throw new DOMException('This browser does not support native wall placement.', 'NotSupportedError');
    const options = { requiredFeatures: ['hit-test'], optionalFeatures: ['anchors'] };
    if (overlayRoot) {
      options.optionalFeatures.push('dom-overlay');
      options.domOverlay = { root: overlayRoot };
    }
    pendingSession = navigator.xr.requestSession('immersive-ar', options);
    session = await pendingSession;
    const systemEnd = () => {
      const external = !stopped;
      stopped = true;
      cleanup();
      if (external) onEnd();
    };
    const ignoreControl = event => {
      if (event.target.closest?.('button,a,input,select,[role="button"]')) event.preventDefault();
    };
    const select = () => { place(); };
    const contextLost = () => {
      if (!stopped) {
        void stop();
        onError(new Error('The graphics session was interrupted. Open the camera again.'));
      }
    };
    session.addEventListener('end', systemEnd, { once: true });
    session.addEventListener('select', select);
    overlayRoot?.addEventListener('beforexrselect', ignoreControl);
    canvas.addEventListener('webglcontextlost', contextLost);
    removeListeners = () => {
      session.removeEventListener('end', systemEnd);
      session.removeEventListener('select', select);
      overlayRoot?.removeEventListener('beforexrselect', ignoreControl);
      canvas.removeEventListener('webglcontextlost', contextLost);
    };
    function checkActive() {
      if (stopped) throw new DOMException('The camera was closed.', 'AbortError');
    }
    checkActive();
    report('loading', 'Opening the AR camera…');
    const T = await import(THREE_URL);
    checkActive();
    renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    checkActive();
    const refSpace = renderer.xr.getReferenceSpace();
    const viewerSpace = await session.requestReferenceSpace('viewer');
    checkActive();
    hits = await session.requestHitTestSource({ space: viewerSpace, entityTypes: ['plane'] });
    checkActive();
    if (!hits) throw new Error('The device could not start wall detection. Try opening the camera again.');

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera();
    artwork = createArtwork(T, video, posterUrl);
    artwork.setWidth(width);
    scene.add(artwork.root);
    const up = new T.Vector3(0, 1, 0);
    const normal = new T.Vector3();
    const right = new T.Vector3();
    const towardViewer = new T.Vector3();
    const position = new T.Vector3();
    const previousPosition = new T.Vector3();
    const previousNormal = new T.Vector3();
    const hitMatrix = new T.Matrix4();
    const artworkMatrix = new T.Matrix4();
    const anchorOffset = new T.Matrix4();
    let stableSince = null;
    clearHistory = () => { stableSince = null; };

    function updateCandidate(time, frame, viewer) {
      let currentHit = null;
      for (const hit of frame.getHitTestResults(hits)) {
        const pose = hit.getPose(refSpace);
        if (!pose || pose.emulatedPosition) continue;
        hitMatrix.fromArray(pose.transform.matrix);
        normal.setFromMatrixColumn(hitMatrix, 1).normalize();
        if (Math.abs(normal.y) > MAX_WALL_NORMAL_Y) continue;
        position.setFromMatrixPosition(hitMatrix);
        towardViewer.copy(viewer.transform.position).sub(position);
        const distance = towardViewer.length();
        if (distance < 0.18 || distance > 6) continue;
        normal.y = 0;
        normal.normalize();
        if (normal.dot(towardViewer) < 0) normal.negate();
        currentHit = hit;
        break;
      }

      if (!currentHit) {
        stableSince = null;
        requestPlace = false;
        artwork.root.visible = false;
        report('searching', 'Move slowly across a well-lit wall with visible detail.');
        return;
      }
      if (stableSince === null || previousPosition.distanceToSquared(position) > 0.12 ** 2 ||
        previousNormal.dot(normal) < 0.96) stableSince = time;
      previousPosition.copy(position);
      previousNormal.copy(normal);
      right.crossVectors(up, normal).normalize();
      artworkMatrix.makeBasis(right, up, normal);
      artworkMatrix.setPosition(position.addScaledVector(normal, 0.008));
      artwork.root.matrix.copy(artworkMatrix);
      artwork.root.matrixWorldNeedsUpdate = true;
      artwork.root.visible = true;
      if (time - stableSince < MIN_STABLE_TIME_MS) {
        requestPlace = false;
        report('searching', 'Hold steady while the wall comes into focus.');
        return;
      }
      report('wall-ready', 'Wall found. Tap to hang the artwork.');
      if (!requestPlace) return;
      requestPlace = false;
      placed = true;
      artwork.setPlaced(true);
      report('placed', 'Artwork placed.');
      video.play()?.catch(() => {});
      if (typeof currentHit.createAnchor !== 'function') return;
      // Hit anchors follow XR's +Y-normal convention. Preserve the mounted,
      // gravity-upright pose relative to that anchor as the map refines.
      anchorOffset.copy(hitMatrix).invert().multiply(artworkMatrix);
      const generation = ++anchorGeneration;
      try {
        currentHit.createAnchor().then(created => {
          if (generation === anchorGeneration && !stopped) anchor = created;
          else created.delete();
        }).catch(() => {}); // A fixed local-space pose is valid without the optional anchors feature.
      } catch { /* The optional feature can be present on the prototype but disabled. */ }
    }

    function onFrame(time, frame) {
      if (stopped || !frame) return;
      const viewer = frame.getViewerPose(refSpace);
      if (!viewer || viewer.emulatedPosition) {
        stableSince = null;
        requestPlace = false;
        artwork.root.visible = false;
        report('recovering', 'Move slowly to recover tracking.');
      } else if (placed) {
        const anchoredPose = anchor ? frame.getPose(anchor.anchorSpace, refSpace) : null;
        artwork.root.visible = !anchor || Boolean(anchoredPose && !anchoredPose.emulatedPosition);
        if (anchoredPose && !anchoredPose.emulatedPosition) {
          artwork.root.matrix.fromArray(anchoredPose.transform.matrix).multiply(anchorOffset);
          artwork.root.matrixWorldNeedsUpdate = true;
        }
        if (artwork.root.visible) report('placed', 'Artwork placed.');
        else report('recovering', 'Move back toward the wall to recover tracking.');
        artwork.updateFrame();
      } else {
        updateCandidate(time, frame, viewer);
      }
      renderer.render(scene, camera);
    }
    const referenceReset = () => {
      if (placed && !anchor) reset();
      else clearHistory();
    };
    refSpace.addEventListener('reset', referenceReset);
    const removeSessionListeners = removeListeners;
    removeListeners = () => {
      refSpace.removeEventListener('reset', referenceReset);
      removeSessionListeners();
    };
    report('searching', 'Move slowly across a well-lit wall with visible detail.');
    renderer.setAnimationLoop((time, frame) => {
      try { onFrame(time, frame); } catch (error) {
        if (!stopped) {
          void stop();
          onError(error);
        }
      }
    });
  }

  const ready = run().catch(async error => {
    await stop();
    throw error;
  });
  return {
    ready, stop, place, reset,
    setSize(metres) {
      if (!Number.isFinite(metres)) return;
      width = Math.max(0.25, Math.min(4, metres));
      artwork?.setWidth(width);
    }
  };
}
