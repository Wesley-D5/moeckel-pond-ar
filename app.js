// Moeckel Pond Seasons: web AR on the self-hosted 8th Wall engine.
//
//   Scan the poster   -> 8th Wall image tracking: the video is locked onto the printed poster.
//   Hang it on a wall -> 8th Wall world tracking (SLAM): tap a wall and the video stays fixed
//                        there in 3D, even as you walk around. Works in iPhone Safari and Android.
//
// The engine, three.js and all media are served from this folder, so the site depends on no
// outside service.

import * as THREE from 'three';
import { qrcode } from './vendor/qrcode.mjs';

window.THREE = THREE; // the 8th Wall three.js module looks for a global THREE

const VIDEO_SRC = './assets/poster-540.mp4';
const POSTER_SRC = './assets/poster.jpg';
const TARGET_JSON = './image-targets/poster.json';
const ASPECT = 1080 / 1920;   // poster/video height ÷ width
const CAMERA_HEIGHT = 1.5;    // phone height above the floor at start; makes 1 unit ≈ 1 metre
const START_WIDTH = 1.0;      // poster width on a wall (≈ metres)
const FALLBACK_DISTANCE = 1.5; // used if the wall has too little texture to measure

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
// Show the still poster until the video has frames, so there's never a black flash.
const material = new THREE.MeshBasicMaterial({ map: imageTex, toneMapped: false });
video.addEventListener('playing', () => { material.map = videoTex; material.needsUpdate = true; });

// Runs inside the tap so the browser allows sound later.
function unlockVideo() {
  video.muted = false;
  const p = video.play();
  if (p) p.then(() => video.pause()).catch(() => { video.muted = true; updateSoundButton(); });
  updateSoundButton();
}

// A poster 1 unit wide, facing +Z, optionally with a dark frame behind it.
function makePoster({ frame }) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, ASPECT), material));
  if (frame) {
    const b = 0.03;
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(1 + b * 2, ASPECT + b * 2),
      new THREE.MeshBasicMaterial({ color: 0x15130f })
    );
    back.position.z = -0.004;
    group.add(back);
  }
  return group;
}

// ---------- overlay controls ----------

let sizeHandler = () => {};
function updateSoundButton() { $('btnSound').textContent = video.muted ? '🔇' : '🔊'; }
$('btnSound').onclick = () => { video.muted = !video.muted; updateSoundButton(); };
$('btnExit').onclick = () => { try { XR8.stop(); } catch (_) {} location.reload(); };
$('btnBigger').onclick = () => sizeHandler(1.2);
$('btnSmaller').onclick = () => sizeHandler(1 / 1.2);

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
  $('error').textContent = /NotAllowed|denied|Permission/i.test(msg)
    ? 'Camera or motion access was blocked. Allow it in your browser settings and try again.'
    : msg;
  $('error').hidden = false;
}

// ---------- 8th Wall startup ----------

const xrReady = new Promise((resolve) => {
  if (window.XR8) resolve();
  else window.addEventListener('xrloaded', resolve, { once: true });
});

async function runXR({ worldTracking, imageTargetData = [], allowDesktop, onStart, listeners = [] }) {
  await xrReady;
  if (!XR8.XrController) await XR8.loadChunk('slam');

  XR8.XrController.configure({
    disableWorldTracking: !worldTracking,
    imageTargetData,
    scale: 'responsive',
  });

  const canvas = document.createElement('canvas');
  canvas.id = 'camerafeed';
  stage.appendChild(canvas);

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),   // draws the camera feed
    XR8.Threejs.pipelineModule(),             // three.js scene synced to the camera
    XR8.XrController.pipelineModule(),        // image + world tracking
    XRExtras.FullWindowCanvas.pipelineModule(),
    XRExtras.Loading.pipelineModule(),        // loading screen + permission prompts
    XRExtras.RuntimeError.pipelineModule(),
    {
      name: 'moeckel',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene();
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        camera.position.set(0, CAMERA_HEIGHT, 0);
        XR8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion });
        canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
        onStart({ scene, camera, canvas });
      },
      listeners,
    },
  ]);

  const device = XR8.XrConfig.device();
  XR8.run({ canvas, allowedDevices: allowDesktop ? device.ANY : device.MOBILE_AND_HEADSETS });
}

// ---------- 1. Scan the poster ----------

async function startScan() {
  enterMode('scan');
  hint.textContent = 'Point your camera at the poster';
  const target = await fetch(TARGET_JSON).then((r) => r.json());

  // The engine tracks the centre 4:3 area of the poster (full height). It reports that area as
  // scaledWidth × scaledHeight; the full 16:9 poster is the same height, just wider.
  const anchor = new THREE.Group();
  anchor.visible = false;
  const poster = makePoster({ frame: false });
  anchor.add(poster);

  const show = ({ detail }) => {
    if (detail.name !== target.name) return;
    anchor.position.copy(detail.position);
    anchor.quaternion.copy(detail.rotation);
    anchor.scale.setScalar(detail.scale);
    poster.scale.setScalar(detail.scaledHeight / ASPECT);
    if (!anchor.visible) {
      anchor.visible = true;
      hint.textContent = '';
      video.play();
    }
  };
  const hide = ({ detail }) => {
    if (detail.name !== target.name) return;
    anchor.visible = false;
    video.pause();
    hint.textContent = 'Point your camera at the poster';
  };

  await runXR({
    worldTracking: false,           // pure image tracking: fastest, no motion prompt
    imageTargetData: [target],
    allowDesktop: true,
    onStart: ({ scene }) => scene.add(anchor),
    listeners: [
      { event: 'reality.imagefound', process: show },
      { event: 'reality.imageupdated', process: show },
      { event: 'reality.imagelost', process: hide },
    ],
  });
}

// ---------- 2. Hang it on a wall ----------

// Fit a vertical plane through feature points (top-down line fit). Returns the wall's
// horizontal normal, or null if the points don't look like a wall.
function fitWallNormal(points) {
  if (points.length < 5) return null;
  let mx = 0, mz = 0;
  for (const p of points) { mx += p.x; mz += p.z; }
  mx /= points.length; mz /= points.length;
  let cxx = 0, czz = 0, cxz = 0;
  for (const p of points) {
    const dx = p.x - mx, dz = p.z - mz;
    cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
  }
  cxx /= points.length; czz /= points.length; cxz /= points.length;
  const mid = (cxx + czz) / 2;
  const r = Math.sqrt(((cxx - czz) / 2) ** 2 + cxz ** 2);
  const big = mid + r, small = Math.max(mid - r, 0);
  if (Math.sqrt(big) < 0.04 || small / big > 0.2) return null; // too clustered or not flat
  const theta = 0.5 * Math.atan2(2 * cxz, cxx - czz);
  return new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta));
}

async function startWall() {
  // On iPhone, motion access must be requested inside the tap, before anything async.
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().catch(() => {});
  }
  enterMode('wall');
  hint.textContent = 'Move your phone a little, then tap a wall';

  const poster = makePoster({ frame: true });
  poster.visible = false;
  poster.scale.setScalar(START_WIDTH);
  let onFloor = false;

  sizeHandler = (k) => {
    const s = THREE.MathUtils.clamp(poster.scale.x * k, 0.2, 6);
    if (onFloor) poster.position.y += (ASPECT * (s - poster.scale.x)) / 2;
    poster.scale.setScalar(s);
  };

  const raycaster = new THREE.Raycaster();

  function place(camera, sx, sy) {
    const camPos = camera.position.clone();

    // Sample feature points in a small grid around the tap.
    const pts = [];
    let centre = null;
    for (const dy of [-0.06, -0.03, 0, 0.03, 0.06]) {
      for (const dx of [-0.06, -0.03, 0, 0.03, 0.06]) {
        const x = THREE.MathUtils.clamp(sx + dx, 0, 1), y = THREE.MathUtils.clamp(sy + dy, 0, 1);
        const hit = XR8.XrController.hitTest(x, y, ['FEATURE_POINT'])[0];
        if (!hit) continue;
        const p = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
        const d = p.distanceTo(camPos);
        if (d < 0.2 || d > 8) continue;
        pts.push(p);
        if (dx === 0 && dy === 0) centre = p;
      }
    }

    const toCam = (from) => { const v = camPos.clone().sub(from); v.y = 0; return v.normalize(); };
    let pos, normal;
    onFloor = false;

    if (pts.length) {
      pos = centre || pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
      if (pos.y < 0.15) {
        // Tapped the floor: stand the poster up on that spot, facing you.
        onFloor = true;
        normal = toCam(pos);
        pos.y = (ASPECT * poster.scale.x) / 2;
      } else {
        const wallPts = pts.filter((p) => p.y > 0.15 && p.distanceTo(pos) < 0.6);
        normal = fitWallNormal(wallPts);
        const facing = toCam(pos);
        if (normal && normal.dot(facing) < 0) normal.negate();
        if (!normal || normal.dot(facing) < 0.35) normal = facing; // unreliable fit: face the viewer
      }
    } else {
      // Plain wall with no texture: put it a set distance along the tap direction.
      raycaster.setFromCamera(new THREE.Vector2(sx * 2 - 1, -(sy * 2 - 1)), camera);
      pos = camPos.clone().addScaledVector(raycaster.ray.direction, FALLBACK_DISTANCE);
      normal = toCam(pos);
    }

    poster.position.copy(pos).addScaledVector(normal, 0.01);
    poster.lookAt(poster.position.clone().add(normal));
    poster.visible = true;
    video.play();
    hint.textContent = pts.length ? 'Tap anywhere to move it' : 'Tap again to move it';
  }

  await runXR({
    worldTracking: true,
    onStart: ({ scene, camera, canvas }) => {
      scene.add(poster);
      const onTap = (cx, cy) => place(camera, cx / window.innerWidth, cy / window.innerHeight);
      canvas.addEventListener('touchstart', (e) => {
        e.preventDefault(); // stops the follow-up click from placing it twice
        if (e.touches.length === 1) onTap(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });
      canvas.addEventListener('click', (e) => onTap(e.clientX, e.clientY));
    },
  });
}

// ---------- home screen ----------

$('btnScan').onclick = () => { unlockVideo(); startScan().catch(showError); };
$('btnWall').onclick = () => { unlockVideo(); startWall().catch(showError); };

// On a computer, show a QR code so people can jump to their phone.
if (!matchMedia('(pointer: coarse)').matches) {
  const url = location.href.split('#')[0];
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  $('url').textContent = url;
  $('desktop').hidden = false;
}
if (!window.isSecureContext) {
  $('error').textContent = 'This page must be opened over https:// for the camera to work.';
  $('error').hidden = false;
}
