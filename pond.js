import { startWall, supportsNativeWall } from "./wall/wall.js";

const byId = (id) => document.getElementById(id);
const canonical = new URL("https://wesley-d5.github.io/moeckel-pond-ar/");
const wallModel = "./models/moeckel-wall-film-whole.usdz";
const millModel = "./models/moeckel-mill.usdz";
const millGLB = "./preview/mill-study.glb";
const phone =
  /Android|iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 0 && matchMedia("(pointer:coarse)").matches);
const android = /Android/i.test(navigator.userAgent);
const quickLook = byId("native-launch").relList?.supports?.("ar") === true;
// The high-quality web route needs no Apple shader support. The optional native movie
// uses MaterialX, introduced in Quick Look on iOS/iPadOS 18.
const appleVersion =
  navigator.userAgent.match(/(?:iPhone OS |CPU OS )(\d+)/) ||
  navigator.userAgent.match(/Version\/(\d+)/);
const nativeFilm =
  quickLook && (!appleVersion || Number(appleVersion[1]) >= 18);
const cameraPolicy = document.permissionsPolicy || document.featurePolicy;
const cameraAllowed = Boolean(
  navigator.mediaDevices?.getUserMedia &&
    window.isSecureContext &&
    (!cameraPolicy?.allowsFeature || cameraPolicy.allowsFeature("camera")),
);

let experience = "";
let immersive = false;
let player;
let modelView;
let previewGeneration = 0;

function publicAsset(path) {
  const base = location.hostname.endsWith(".chatgpt.site")
    ? canonical
    : new URL("./", location.href);
  return new URL(path, base).href;
}

function directAppleLaunch() {
  if (!quickLook) return false;
  return (
    experience === "miniature" ||
    (nativeFilm && (location.hash === "#apple-wall" || !cameraAllowed))
  );
}

function configureLaunch() {
  const native = directAppleLaunch();
  byId("native-button").hidden = !native;
  byId("launch").hidden = native;
  const miniature = experience === "miniature";
  const text = miniature ? "Place miniature" : "Place on wall";
  byId("native-launch").href = publicAsset(miniature ? millModel : wallModel);
  byId("native-launch").setAttribute("aria-label", text);
  byId("native-image").src = miniature
    ? "./preview/mill-study.webp"
    : "./assets/poster.jpg";
  byId("launch-label").textContent = text;
  byId("native-label").textContent = text;
}

function releasePreview() {
  ++previewGeneration;
  modelView?.dispose();
  modelView = undefined;
  byId("model-poster").hidden = false;
}

async function showMiniature() {
  const generation = previewGeneration;
  try {
    const { mountPreview } = await import("./preview/preview.js");
    if (generation !== previewGeneration) return;
    modelView = mountPreview({
      container: byId("orbit"),
      modelUrl: new URL(millGLB, document.baseURI).href,
      playing: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      onReady() {
        if (generation !== previewGeneration) return;
        byId("model-poster").hidden = true;
        byId("piece-detail").textContent = "Drag to turn the mill.";
      },
      onError() {
        if (generation !== previewGeneration) return;
        byId("model-poster").hidden = false;
        byId("piece-detail").textContent = "A tabletop model of Moeckel Pond.";
      },
    });
    await modelView.ready;
  } catch {
    if (generation === previewGeneration) byId("model-poster").hidden = false;
  }
}

function select(next, updateAddress = true) {
  if (next !== experience) {
    releasePreview();
    experience = next;
    const miniature = next === "miniature";
    byId("select-wall").setAttribute("aria-pressed", String(!miniature));
    byId("select-miniature").setAttribute("aria-pressed", String(miniature));
    byId("film-picture").hidden = miniature;
    byId("model-picture").hidden = !miniature;
    byId("stage").classList.toggle("show-miniature", miniature);
    byId("piece-title").textContent = miniature
      ? "The miniature"
      : "The wall film";
    byId("piece-detail").textContent = miniature
      ? "A tabletop model of Moeckel Pond."
      : "41 seconds · Original soundtrack";
    byId("error").hidden = true;
    if (miniature) {
      byId("model-poster").src = "./preview/mill-study.webp";
      void showMiniature();
    }
  }
  if (updateAddress) history.replaceState(null, "", "#" + next);
  configureLaunch();
}

function readLocation() {
  select(location.hash.startsWith("#miniature") ? "miniature" : "wall", false);
  if (location.hash === "#miniature-view") {
    showError(
      "AR placement needs a compatible model viewer. You can turn the miniature here.",
    );
  }
}

function showError(message) {
  byId("error").textContent = message;
  byId("error").hidden = false;
}

function handoff() {
  const miniature = experience === "miniature";
  byId("handoff-title").textContent = miniature
    ? "Place the miniature"
    : "Place on wall";
  byId("handoff-detail").textContent = miniature
    ? "Scan with your phone camera to place the mill on a table."
    : "Scan with your phone camera to place the film in your room.";
  byId("qr").src = miniature
    ? "./assets/phone-miniature.png"
    : "./assets/phone-wall.png";
  byId("handoff").showModal();
  byId("dismiss").focus();
}

function placeWallFilm() {
  if (player) return;
  try {
    // Call synchronously inside the tap so WebXR keeps its user activation.
    player = startWall({
      filmUrl: new URL("./assets/poster-540.mp4", document.baseURI).href,
      posterUrl: new URL("./assets/poster.jpg", document.baseURI).href,
      nativeFallback: nativeFilm ? publicAsset(wallModel) : undefined,
      mode: immersive ? "webxr" : "patch",
      onEnd() {
        player = undefined;
        byId("launch").focus({ preventScroll: true });
      },
    });
    player.ready.catch(() => {}); // The camera dialog displays the actionable error.
  } catch (error) {
    player = undefined;
    showError(
      error.message ||
        "Camera access is unavailable. Open this artwork in your phone’s browser.",
    );
  }
}

function placeAndroidMiniature() {
  const fallback = new URL(canonical);
  fallback.hash = "miniature-view";
  const model = encodeURIComponent(publicAsset(millGLB));
  location.href =
    "intent://arvr.google.com/scene-viewer/1.0?mode=ar_only&file=" +
    model +
    "#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=" +
    encodeURIComponent(fallback.href) +
    ";end;";
}

byId("launch").addEventListener("click", () => {
  byId("error").hidden = true;
  if (experience === "miniature" && android) return placeAndroidMiniature();
  if (
    experience === "wall" &&
    (phone || immersive || location.hash === "#original-film")
  ) {
    if (cameraAllowed || immersive) return placeWallFilm();
    showError(
      "Open this page in Safari or Chrome on your phone to use the camera.",
    );
    return;
  }
  handoff();
});
byId("select-wall").addEventListener("click", () => select("wall"));
byId("select-miniature").addEventListener("click", () => select("miniature"));
byId("dismiss").addEventListener("click", () => byId("handoff").close());
byId("handoff").addEventListener("close", () =>
  byId("launch").focus({ preventScroll: true }),
);
window.addEventListener("hashchange", readLocation);
window.addEventListener("pagehide", () => {
  player?.close();
  releasePreview();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && experience === "miniature") void showMiniature();
});
void supportsNativeWall().then((value) => {
  immersive = value;
});
readLocation();
