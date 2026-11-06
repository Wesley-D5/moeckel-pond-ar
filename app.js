// Moeckel Pond Seasons — web AR
//
// Three ways in, picked automatically:
//   1. Scan the poster  -> MindAR image tracking (iPhone + Android + laptop webcam)
//   2. Hang it on a wall:
//      a. WebXR hit-test  -> real wall anchoring (Android Chrome with ARCore, and any
//                            future browser that adds WebXR AR)
//      b. Camera + gyro   -> fallback everywhere else (iPhone Safari today): the video
//                            stays fixed in the direction you placed it while you look around.
//
// Everything (libraries, video, target) is served from this folder, so the site has no
// outside services that can disappear.

import * as THREE from 'three';
import { qrcode } from './vendor/qrcode.mjs';

const VIDEO_SRC = './assets/poster-540.mp4';
const POSTER_SRC = './assets/poster.jpg';
const TARGET_SRC = './assets/target.mind';
const ASPECT = 1080 / 1920;        // height / width of the video
const START_WIDTH_M = 1.0;         // default size on a wall, in metres
const GYRO_DISTANCE_M = 2.0;       // how far away the gyro-mode poster sits

const $ = (id) => document.getElementById(id);
const home = $('home'), stage = $('stage'), overlay = $('overlay'), hint = $('hint');

// ---------- shared video + material ----------

const video = document.createElement('video');
video.src = VIDEO_SRC;
video.loop = true;
video.playsInline = true;
video.setAttribute('playsinline', '');
video.setAttribute('webkit-playsinline', '');
video.preload = 'auto';
video.crossOrigin = 'anonymous';

const imageTex = new THREE.TextureLoader().load(POSTER_SRC);
imageTex.colorSpace = THREE.SRGBColorSpace;
const videoTex = new THREE.VideoTexture(video);
videoTex.colorSpace = THREE.SRGBColorSpace;
// Show the still poster until the video actually has frames, so there is never a black flash.
const material = new THREE.MeshBasicMaterial({ map: imageTex, toneMapped: false });
video.addEventListener('playing', () => { material.map = videoTex; material.needsUpdate = true; });

// Must run synchronously inside a tap so browsers allow sound later.
function unlockVideo() {
  video.muted = false;
  const p = video.play();
  if (p) p.then(() => video.pause()).catch(() => { video.muted = true; });
  updateSoundButton();
}

function makePoster({ frame }) {
  const group = new THREE.Group();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, ASPECT), material);
  group.add(plane);
  if (frame) {
    const border = 0.035;
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(1 + border * 2, ASPECT + border * 2),
      new THREE.MeshBasicMaterial({ color: 0x15130f })
    );
    back.position.z = -0.004;
    group.add(back);
  }
  return group;
}

// ---------- overlay controls ----------

let exitHandler = () => location.reload();
let sizeHandler = () => {};
let placeHandler = () => {};

function updateSoundButton() { $('btnSound').textContent = video.muted ? '🔇' : '🔊'; }
$('btnSound').onclick = () => { video.muted = !video.muted; updateSoundButton(); };
$('btnExit').onclick = () => exitHandler();
$('btnBigger').onclick = () => sizeHandler(1.2);
$('btnSmaller').onclick = () => sizeHandler(1 / 1.2);
$('btnPlace').onclick = () => placeHandler();

function enterMode(mode) {
  home.hidden = true;
  stage.hidden = false;
  overlay.hidden = false;
  overlay.className = `mode-${mode}`;
  updateSoundButton();
}

function showError(err) {
  console.error(err);
  stage.hidden = true;
  overlay.hidden = true;
  home.hidden = false;
  const msg = (err && (err.message || err.name)) || String(err);
  let friendly = msg;
  if (/NotAllowed|denied|Permission/i.test(msg)) friendly = 'Camera or motion access was blocked. Allow it in your browser settings and try again.';
  if (/NotFound|no camera|Requested device not found/i.test(msg)) friendly = 'No camera was found on this device.';
  $('error').textContent = friendly;
  $('error').hidden = false;
}

// ---------- 1. Scan the poster (MindAR) ----------

async function startScan() {
  enterMode('scan');
  hint.textContent = 'Point your camera at the poster';
  const { MindARThree } = await import('mindar-image-three');
  const mindar = new MindARThree({
    container: $('mindar'),
    imageTargetSrc: TARGET_SRC,
    uiLoading: 'yes', uiScanning: 'yes', uiError: 'yes',
    filterMinCF: 0.0001, filterBeta: 0.001,   // smoother, less jittery overlay
  });
  const { renderer, scene, camera } = mindar;
  const anchor = mindar.addAnchor(0);
  anchor.group.add(makePoster({ frame: false }));   // target width = 1 unit, matches poster exactly
  anchor.onTargetFound = () => { hint.textContent = ''; video.play(); };
  anchor.onTargetLost = () => { hint.textContent = 'Point your camera at the poster'; video.pause(); };
  await mindar.start();
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  exitHandler = () => { mindar.stop(); location.reload(); };
}

// ---------- 2a. Hang it on a wall with WebXR ----------

async function startWebXR() {
  enterMode('xr');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.domElement.className = 'ar';
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const poster = makePoster({ frame: true });
  poster.visible = false;
  poster.scale.setScalar(START_WIDTH_M);
  scene.add(poster);

  // Taps on our buttons must not also place the poster.
  $('bar').addEventListener('beforexrselect', (e) => e.preventDefault());

  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: overlay },
  });
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  const refSpace = renderer.xr.getReferenceSpace();
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewerSpace });

  hint.textContent = 'Slowly scan a wall until the ring appears';
  let lastHit = null;
  let onFloor = false;
  const viewerPos = new THREE.Vector3();
  const m = new THREE.Matrix4();

  session.addEventListener('select', () => {
    if (!lastHit) return;
    m.fromArray(lastHit);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    const normal = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
    const isWall = Math.abs(normal.y) < 0.6;
    onFloor = !isWall;
    if (isWall) {
      // Make sure the normal points towards the viewer, then hang upright on the wall.
      const toViewer = viewerPos.clone().sub(pos);
      if (normal.dot(toViewer) < 0) normal.negate();
      normal.y = 0; normal.normalize();
      poster.position.copy(pos).addScaledVector(normal, 0.01);
      poster.lookAt(pos.clone().add(normal));
    } else {
      // Floor or table: stand it upright on the spot, facing you.
      poster.position.copy(pos);
      poster.position.y += (ASPECT * poster.scale.x) / 2;
      poster.lookAt(viewerPos.x, poster.position.y, viewerPos.z);
    }
    poster.visible = true;
    video.play();
    hint.textContent = 'Tap anywhere to move it';
  });

  sizeHandler = (k) => {
    const s = THREE.MathUtils.clamp(poster.scale.x * k, 0.2, 6);
    if (onFloor) poster.position.y += (ASPECT * (s - poster.scale.x)) / 2; // keep it standing on the floor
    poster.scale.setScalar(s);
  };

  renderer.setAnimationLoop((t, frame) => {
    if (frame) {
      const vp = frame.getViewerPose(refSpace);
      if (vp) viewerPos.set(vp.transform.position.x, vp.transform.position.y, vp.transform.position.z);
      const hits = frame.getHitTestResults(hitSource);
      if (hits.length) {
        const pose = hits[0].getPose(refSpace);
        lastHit = pose.transform.matrix;
        reticle.matrix.fromArray(lastHit);
        reticle.visible = true;
      } else {
        reticle.visible = false;
      }
    }
    renderer.render(scene, camera);
  });

  exitHandler = () => session.end();
  session.addEventListener('end', () => location.reload());
}

// ---------- 2b. Hang it on a wall with camera + gyro (fallback) ----------

const Q_WORLD = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° around X
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function orientationToQuaternion(q, alpha, beta, gamma, screenAngle) {
  const d = THREE.MathUtils.DEG2RAD;
  q.setFromEuler(new THREE.Euler(beta * d, alpha * d, -gamma * d, 'YXZ'));
  q.multiply(Q_WORLD);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -screenAngle * d));
}

async function startGyro() {
  // Both permission prompts must be requested inside the tap, before any await.
  const motionPermission = (typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function')
    ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
  const cameraPromise = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  enterMode('gyro');

  const [perm, stream] = await Promise.all([motionPermission, cameraPromise]);
  if (perm !== 'granted') throw new Error('Motion permission denied');
  const feed = $('camfeed');
  feed.srcObject = stream;
  await feed.play();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.className = 'ar';
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 50);
  const poster = makePoster({ frame: true });
  poster.visible = false;
  poster.scale.setScalar(START_WIDTH_M);
  scene.add(poster);

  // Match the virtual camera's field of view to the real camera image on screen.
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const vw = feed.videoWidth || 1080, vh = feed.videoHeight || 1920;
    const longFov = 64 * THREE.MathUtils.DEG2RAD;  // typical phone main camera
    const half = Math.tan(longFov / 2);
    const vHalf = vh >= vw ? half : half * (vh / vw);   // vertical half-FOV of the camera image
    const scale = Math.max(w / vw, h / vh);              // object-fit: cover
    const visibleFrac = h / (vh * scale);
    camera.fov = 2 * Math.atan(vHalf * visibleFrac) * THREE.MathUtils.RAD2DEG;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  feed.addEventListener('loadedmetadata', resize);

  let orient = null;
  const onOrient = (e) => { if (e.alpha !== null) orient = e; };
  window.addEventListener('deviceorientation', onOrient);

  hint.textContent = 'Point at a wall, then tap Place here';

  placeHandler = () => {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    poster.position.copy(dir.multiplyScalar(GYRO_DISTANCE_M));
    poster.lookAt(0, poster.position.y, 0);
    poster.visible = true;
    video.play();
    $('btnPlace').textContent = 'Move here';
    hint.textContent = 'Use − / + to resize';
  };
  sizeHandler = (k) => poster.scale.setScalar(THREE.MathUtils.clamp(poster.scale.x * k, 0.2, 6));

  renderer.setAnimationLoop(() => {
    if (orient) {
      const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      orientationToQuaternion(camera.quaternion, orient.alpha, orient.beta, orient.gamma, screenAngle);
    }
    renderer.render(scene, camera);
  });

  exitHandler = () => { stream.getTracks().forEach((t) => t.stop()); location.reload(); };
}

// ---------- home screen wiring ----------

let xrSupported = false;
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
    xrSupported = ok;
    if (ok) $('wallHint').textContent = 'Uses your phone’s AR to stick it to a real wall';
  }).catch(() => {});
}

$('btnScan').onclick = () => {
  unlockVideo();
  startScan().catch(showError);
};
$('btnWall').onclick = () => {
  unlockVideo();
  (xrSupported ? startWebXR() : startGyro()).catch(showError);
};

// On a computer, show a QR code so people can jump to their phone.
const isTouch = matchMedia('(pointer: coarse)').matches;
if (!isTouch) {
  const qr = qrcode(0, 'M');
  qr.addData(location.href.split('#')[0]);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  $('url').textContent = location.href.split('#')[0];
  $('desktop').hidden = false;
}
if (!window.isSecureContext) {
  $('error').textContent = 'This page must be opened over https:// for the camera to work.';
  $('error').hidden = false;
}
