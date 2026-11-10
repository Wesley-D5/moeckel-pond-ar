import {
  DoubleSide,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  VideoTexture,
  WebGLRenderer,
} from "three";

export async function attachWebXR({
  session,
  root,
  stage,
  video,
  onStatus,
  onEnd,
  signal,
}) {
  const canvas = document.createElement("canvas"),
    scene = new Scene(),
    camera = new PerspectiveCamera();
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  canvas.className = "wall-xr-surface";
  stage.append(canvas);
  renderer.setClearColor(0, 0);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  const texture = new VideoTexture(video);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  const geometry = new PlaneGeometry(0.86, (0.86 * 9) / 16);
  const material = new MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  scene.add(mesh);
  let stopped = false,
    source,
    space,
    anchor,
    placed = false,
    queued = false,
    stable = 0,
    lastGood = 0,
    serial = 0;
  let latest = null,
    offset = null,
    visible = false;
  const identity = new Matrix4(),
    one = new Vector3(1, 1, 1),
    up = new Vector3(0, 1, 0);
  const hint = "Aim at a wall and move slowly until the frame is ready.";
  function show(value) {
    if (value === visible) return;
    visible = value;
    mesh.visible = value;
    if (value)
      video.play().catch(() => {
        if (!stopped && visible) {
          video.muted = true;
          video.play().catch(() => {});
        }
      });
    else video.pause();
  }
  function reset() {
    serial++;
    anchor?.delete();
    anchor = null;
    offset = null;
    placed = false;
    queued = false;
    latest = null;
    stable = 0;
    show(false);
    onStatus("searching", hint);
  }
  function place() {
    if (stopped || placed || stable < 3 || performance.now() - lastGood > 250)
      return false;
    queued = true;
    return true;
  }
  const beforeSelect = (e) => {
    if (e.target.closest?.("button,a")) e.preventDefault();
  };
  function end() {
    stop();
    onEnd();
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    serial++;
    signal.removeEventListener("abort", stop);
    root.removeEventListener("beforexrselect", beforeSelect);
    space?.removeEventListener("reset", reset);
    session.removeEventListener("select", place);
    session.removeEventListener("end", end);
    source?.cancel();
    anchor?.delete();
    anchor = null;
    renderer.setAnimationLoop(null);
    video.pause();
    texture.dispose();
    material.dispose();
    geometry.dispose();
    // The session must release the XR framebuffer before its GL context is destroyed.
    Promise.resolve(session.end())
      .catch(() => {})
      .finally(() => {
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
      });
  }
  signal.addEventListener("abort", stop, { once: true });
  try {
    await renderer.xr.setSession(session);
    if (stopped) return { place, reset, stop };
    space = renderer.xr.getReferenceSpace();
    const viewer = await session.requestReferenceSpace("viewer");
    if (stopped) return { place, reset, stop };
    const hits = await session.requestHitTestSource({
      space: viewer,
      entityTypes: ["plane"],
    });
    if (stopped) {
      hits?.cancel();
      return { place, reset, stop };
    }
    if (!hits) throw new Error("This device could not measure wall surfaces.");
    source = hits;
    root.addEventListener("beforexrselect", beforeSelect);
    space.addEventListener("reset", reset);
    session.addEventListener("select", place);
    session.addEventListener("end", end);
    onStatus("searching", hint);
    renderer.setAnimationLoop((time, frame) => {
      if (!frame || stopped) return;
      const view = frame.getViewerPose(space);
      if (!view || session.visibilityState !== "visible") {
        latest = null;
        stable = 0;
        queued = false;
        show(false);
        onStatus("lost", "Move back toward the wall to recover tracking.");
      } else if (placed) {
        const pose = anchor ? frame.getPose(anchor.anchorSpace, space) : null;
        if (pose && offset) {
          mesh.matrix.fromArray(pose.transform.matrix).multiply(offset);
          mesh.matrixWorldNeedsUpdate = true;
        }
        show(!anchor || !!pose);
        onStatus(
          visible ? "placed" : "lost",
          visible
            ? "Film anchored to the wall."
            : "Return to the wall to recover tracking.",
        );
      } else {
        const eye = new Vector3().setFromMatrixPosition(
          identity.fromArray(view.transform.matrix),
        );
        let candidate = null;
        for (const hit of frame.getHitTestResults(source)) {
          const pose = hit.getPose(space);
          if (!pose) continue;
          const h = new Matrix4().fromArray(pose.transform.matrix),
            at = new Vector3().setFromMatrixPosition(h);
          const normal = new Vector3().setFromMatrixColumn(h, 1).normalize();
          if (
            Math.abs(normal.y) > 0.22 ||
            eye.distanceTo(at) < 0.22 ||
            eye.distanceTo(at) > 5.8
          )
            continue;
          if (normal.dot(eye.clone().sub(at)) < 0) normal.negate();
          candidate = { hit, h, at, normal };
          break;
        }
        if (!candidate) {
          latest = null;
          stable = 0;
          queued = false;
          onStatus("searching", hint);
        } else {
          const { hit, h, at, normal } = candidate;
          stable =
            latest &&
            normal.dot(latest.normal) > 0.975 &&
            Math.abs(at.clone().sub(latest.at).dot(normal)) < 0.055
              ? stable + 1
              : 1;
          latest = candidate;
          lastGood = performance.now();
          onStatus(
            stable >= 3 ? "ready" : "searching",
            stable >= 3 ? "Wall found. Tap to hang the film." : hint,
          );
          if (queued && stable >= 3) {
            queued = false;
            placed = true;
            const rot = new Quaternion().setFromAxisAngle(
              up,
              Math.atan2(normal.x, normal.z),
            );
            mesh.matrix.compose(
              at.clone().addScaledVector(normal, 0.006),
              rot,
              one,
            );
            mesh.matrixWorldNeedsUpdate = true;
            offset = h.clone().invert().multiply(mesh.matrix);
            const id = ++serial;
            if (hit.createAnchor) {
              try {
                hit
                  .createAnchor()
                  .then((value) => {
                    if (stopped || serial !== id) value.delete();
                    else anchor = value;
                  })
                  .catch(() => {});
              } catch {}
            }
            show(true);
            onStatus("placed", "Film anchored to the wall.");
          }
        }
      }
      renderer.render(scene, camera);
    });
    return { place, reset, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
