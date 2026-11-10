// The AR launch is a plain HTML link. This module handles the previews and device handoff.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const seasons = ["Spring", "Summer", "Autumn", "Winter"];
const canonical = "https://wesley-d5.github.io/moeckel-pond-ar/";
const prefersQuiet = matchMedia("(prefers-reduced-motion: reduce)");
const nativeAR = document.createElement("a").relList?.supports?.("ar") === true;
const isAppleMobile =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const stage = $("#stage");
const modal = $("#modal");
const viewer = $("#orbit");
const printArea = $("#paper-art");
let mode = "";
let printPlaying = false;
let modelPlaying = !prefersQuiet.matches;
let modelReady = false;
let modelController;
let modelGeneration = 0;
let season = 0;
let clock = 0;
let frameId = 0;
let lastTick;
let onscreen = true;
let modalKind = "";
let returnFocus;
let toastTimer;
let viewActive = true;
const movie = $("#wall-film");
let wallSession;
let cameraModule;
let cameraMode = "patch";
let cameraLoads = 0;
function hashMode() {
  const requested = location.hash.slice(1).toLowerCase();
  return ["print", "miniature"].includes(requested) ? requested : "wall";
}

function icon(button, name, label) {
  button.querySelector("use").setAttribute("href", "#i-" + name);
  if (label) button.querySelector("span").textContent = label;
}
function notify(message) {
  clearTimeout(toastTimer);
  const output = $("#status");
  output.textContent = message;
  output.classList.add("visible");
  toastTimer = setTimeout(() => output.classList.remove("visible"), 3500);
}
function launchUrl(selected) {
  return canonical + "#" + selected;
}
function modelUrl(selected) {
  return document.querySelector('.native-link[data-mode="' + selected + '"]')
    .href;
}

// A private publishing mirror can require a cookie. Quick Look fetches the public model directly.
if (location.hostname.endsWith(".chatgpt.site")) {
  $$(".native-link").forEach((link) => {
    link.href = new URL(link.getAttribute("href"), canonical);
  });
}
for (const link of $$(".native-link")) {
  link.parentElement.hidden = !nativeAR;
  document.querySelector('[data-phone="' + link.dataset.mode + '"]').hidden =
    nativeAR;
}

for (const link of $$(".native-link")) {
  link.addEventListener("click", () => {
    movie.pause();
    printPlaying = false;
    if (mode === "miniature") {
      modelPlaying = false;
      modelController?.setPlaying(false);
    }
    setPlaybackUI();
    schedule();
  });
}

const slats = [];
for (let i = 0; i < 18; i++) {
  const strip = document.createElement("div");
  strip.className = "slat";
  for (let side = 0; side < 4; side++) {
    const face = document.createElement("div");
    face.className = "slat-face";
    face.style.setProperty("--angle", side * 90 + "deg");
    face.style.backgroundPosition = (i / 17) * 100 + "% 50%";
    face.style.backgroundImage =
      'url("./assets/' + seasons[side].toLowerCase() + '.webp")';
    strip.append(face);
  }
  slats.push(strip);
  $("#slats").append(strip);
}
new ResizeObserver(() => {
  printArea.style.setProperty("--radius", printArea.offsetWidth / 36 + "px");
}).observe(printArea);

function showSeason(value) {
  season = value;
  $("#paper-season").textContent = seasons[value];
  printArea.setAttribute(
    "aria-label",
    "Moeckel Pond in " + seasons[value].toLowerCase(),
  );
  if (mode === "print")
    $("#scene-caption").textContent = seasons[value] + " · The living print";
  $$("[data-season]").forEach((button, i) =>
    button.setAttribute("aria-pressed", mode === "print" && i === value),
  );
}
function drawPrint() {
  const phase = Math.floor(clock / 6) % 4;
  const within = clock % 6;
  for (let i = 0; i < slats.length; i++) {
    let t = Math.max(0, Math.min(1, (within - 2.7 - (1.15 * i) / 17) / 1.15));
    t = prefersQuiet.matches ? (within >= 4.2 ? 1 : 0) : t * t * (3 - 2 * t);
    slats[i].style.setProperty("--turn", -90 * (phase + t) + "deg");
  }
  const visible = (phase + (within >= 4.2 ? 1 : 0)) % 4;
  if (visible !== season) showSeason(visible);
}
function canAnimate() {
  return (
    printPlaying &&
    mode === "print" &&
    onscreen &&
    !document.hidden &&
    viewActive &&
    (!modalKind || modalKind === "stage")
  );
}
function tick(now) {
  frameId = 0;
  if (!canAnimate()) {
    lastTick = undefined;
    return;
  }
  if (lastTick !== undefined)
    clock = (clock + Math.min((now - lastTick) / 1000, 0.1)) % 24;
  lastTick = now;
  drawPrint();
  frameId = requestAnimationFrame(tick);
}
function schedule() {
  if (!canAnimate()) {
    cancelAnimationFrame(frameId);
    frameId = 0;
    lastTick = undefined;
  } else if (!frameId) frameId = requestAnimationFrame(tick);
}
function setPlaybackUI() {
  const button = $("#toggle-preview");
  if (mode === "wall") {
    const playing = !movie.paused;
    button.setAttribute("aria-pressed", String(playing));
    icon(
      button,
      playing ? "pause" : "play",
      playing ? "Pause film" : "Play film",
    );
    return;
  }
  if (mode === "miniature" && !modelReady) {
    icon(button, "reset", button.disabled ? "Loading 3D…" : "Load 3D view");
    return;
  }
  const playing = mode === "print" ? printPlaying : modelPlaying;
  button.setAttribute("aria-pressed", String(playing));
  icon(
    button,
    playing ? "pause" : "play",
    playing ? "Pause motion" : mode === "print" ? "Play effect" : "Play motion",
  );
}
function clearModel() {
  ++modelGeneration;
  modelController?.dispose();
  modelController = undefined;
  modelReady = false;
  $("#model-poster").hidden = false;
}
async function mountModel() {
  clearModel();
  const id = modelGeneration;
  $("#toggle-preview").disabled = true;
  $("#reset-view").disabled = true;
  setPlaybackUI();
  try {
    const { mountPreview } = await import("./preview/preview.js");
    if (id !== modelGeneration || mode !== "miniature") return;
    const active = mountPreview({
      container: viewer,
      playing: modelPlaying,
      onReady() {
        if (id !== modelGeneration) return;
        modelReady = true;
        $("#model-poster").hidden = true;
        $("#toggle-preview").disabled = false;
        $("#reset-view").disabled = false;
        $("#figure-hint").textContent = "Drag to turn · pinch to zoom";
        setPlaybackUI();
      },
      onError() {
        if (id !== modelGeneration) return;
        modelReady = false;
        $("#model-poster").hidden = false;
        $("#toggle-preview").disabled = false;
        $("#reset-view").disabled = true;
        $("#figure-hint").textContent =
          "Static preview · AR is available on iPhone";
        setPlaybackUI();
      },
    });
    modelController = active;
    await active.ready;
  } catch {
    if (id !== modelGeneration || mode !== "miniature") return;
    $("#toggle-preview").disabled = false;
    $("#reset-view").disabled = true;
    $("#figure-hint").textContent =
      "Static preview · AR is available on iPhone";
    setPlaybackUI();
  }
}
function selectMode(next, updateHash = true) {
  if (next === mode) return;
  mode = next;
  const isPrint = mode === "print";
  const isModel = mode === "miniature";
  const isWall = mode === "wall";
  if (!isWall) movie.pause();
  $(".section-heading > span").textContent = isPrint
    ? "Select a view of the print"
    : "Jump to a season in the film";
  $("#wall-info").hidden = !isWall;
  $("#wall-frame").hidden = !isWall;
  $("#film-sound").hidden = !isWall;
  $("#choose-wall").setAttribute("aria-pressed", isWall);
  $("#print-info").hidden = !isPrint;
  $("#miniature-info").hidden = !isModel;
  $("#paper").hidden = !isPrint;
  $("#model-frame").hidden = !isModel;
  stage.classList.toggle("model-stage", isModel);
  stage.classList.toggle("framed-stage", isWall);
  $("#choose-print").setAttribute("aria-pressed", isPrint);
  $("#choose-miniature").setAttribute("aria-pressed", isModel);
  $("#preview-label").textContent = isPrint
    ? "Print preview"
    : isModel
      ? "3D preview"
      : "Film preview";
  $("#toggle-preview").disabled = false;
  if (isPrint) {
    clearModel();
    $("#figure-hint").textContent = "Animated print study";
    showSeason(season);
  } else if (isWall) {
    clearModel();
    $("#figure-hint").textContent = "0:41";
    markFilmSeason();
  } else {
    $("#scene-caption").textContent = "Moeckel Pond · The tabletop mill";
    $("#figure-hint").textContent = "Loading the miniature…";
    $("#model-poster").src = "./preview/poster.webp";
    $$("[data-season]").forEach((button) =>
      button.setAttribute("aria-pressed", "false"),
    );
    void mountModel();
  }
  if (updateHash) history.replaceState(null, "", "#" + next);
  setPlaybackUI();
  schedule();
}
const cuePoints = [0, 11, 23, 33];
let pendingCue = null;
function markFilmSeason() {
  if (mode !== "wall") return;
  const position = pendingCue ?? movie.currentTime;
  const selected = cuePoints.reduce(
    (found, cue, i) => (position >= cue ? i : found),
    0,
  );
  $("#scene-caption").textContent = seasons[selected] + " · Original film";
  $$("[data-season]").forEach((button, i) =>
    button.setAttribute("aria-pressed", i === selected),
  );
}
movie.addEventListener("timeupdate", markFilmSeason);
movie.addEventListener("loadedmetadata", () => {
  if (pendingCue !== null) {
    movie.currentTime = pendingCue;
    pendingCue = null;
  }
});
function selectSeason(value) {
  if (mode !== "print") {
    selectMode("wall");
    if (movie.readyState >= 1) {
      movie.currentTime = cuePoints[value];
    } else {
      pendingCue = cuePoints[value];
    }
    markFilmSeason();
    movie.play().catch(() => notify("Tap Play film to start this season."));
    if (stage.getBoundingClientRect().bottom < 40) {
      stage.scrollIntoView({
        block: "center",
        behavior: prefersQuiet.matches ? "auto" : "smooth",
      });
    }
    return;
  }
  printPlaying = false;
  selectMode("print");
  clock = value * 6;
  drawPrint();
  showSeason(value);
  setPlaybackUI();
  schedule();
}
$("#choose-wall").addEventListener("click", () => selectMode("wall"));
$("#choose-print").addEventListener("click", () => selectMode("print"));
$("#choose-miniature").addEventListener("click", () => selectMode("miniature"));
$$("[data-season]").forEach((button) =>
  button.addEventListener("click", () =>
    selectSeason(Number(button.dataset.season)),
  ),
);
$("#toggle-preview").addEventListener("click", () => {
  if (mode === "wall") {
    if (!movie.paused) {
      movie.pause();
      return;
    }

    movie.play().catch(() => notify("The film could not play. Try again."));
    return;
  }
  if (mode === "miniature") {
    if (!modelReady) {
      void mountModel();
      return;
    }
    modelPlaying = !modelPlaying;
    modelController.setPlaying(modelPlaying);
  } else {
    printPlaying = !printPlaying;
    schedule();
  }
  setPlaybackUI();
});
movie.addEventListener("play", setPlaybackUI);
movie.addEventListener("pause", setPlaybackUI);
$("#film-sound").addEventListener("click", () => {
  movie.muted = !movie.muted;
  icon($("#film-sound"), movie.muted ? "muted" : "sound");
  $("#film-sound").setAttribute(
    "aria-label",
    movie.muted ? "Unmute film" : "Mute film",
  );
});
$("#reset-view").addEventListener("click", () => modelController?.resetView());

function endDialog() {
  if (modalKind === "stage") $("#showcase").prepend(stage);
  const video = modal.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  $("#modal-body").replaceChildren();
  modal.className = "";
  modalKind = "";
  document.body.style.overflow = "";
  if (mode === "miniature" && modelReady)
    modelController.setPlaying(modelPlaying);
  if (!wallSession) returnFocus?.focus({ preventScroll: true });
  schedule();
}
function closeDialog() {
  if (modal.open) modal.close();
}
function openDialog(kind, trigger) {
  if (modal.open) return;
  returnFocus = trigger;
  modalKind = kind;
  const body = $("#modal-body");
  if (kind === "stage") {
    modal.className = "stage-modal";
    const heading = document.createElement("h2");
    heading.id = "dialog-title";
    heading.className = "sr-only";
    heading.textContent = "Expanded artwork preview";
    body.append(heading, stage);
  } else {
    const template = document.getElementById(kind + "-template");
    body.append(template.content.cloneNode(true));
    if (mode === "miniature" && modelReady) modelController.setPlaying(false);
    movie.pause();
    if (kind === "camera") prepareWallCamera(body);
    if (kind === "film") {
      modal.className = "film-modal";
      const movie = body.querySelector("video");
      movie.play().catch(() => {});
    }
    if (kind === "phone") {
      body.querySelector("#handoff-qr").src = "./assets/phone-" + mode + ".png";
      body.querySelector("#direct-model").href = modelUrl(mode);
      body.querySelector("#direct-model").download =
        mode === "print"
          ? "living-print.usdz"
          : mode === "miniature"
            ? "tabletop-mill.usdz"
            : "wall-film.usdz";
      if (isAppleMobile && !nativeAR) {
        body.querySelector("#dialog-title").textContent =
          "Open this artwork in Safari.";
        body.querySelector("#handoff-copy").textContent =
          "Copy the link and open it in Safari. Then tap the AR button to view the artwork.";
        body.querySelector(".qr-plate").hidden = true;
      }
      body
        .querySelector(".copy-button")
        .addEventListener("click", (event) =>
          copy(launchUrl(mode), body, event.currentTarget),
        );
    }
  }
  document.body.style.overflow = "hidden";
  modal.showModal();
  $("#close-dialog").focus({ preventScroll: true });
  schedule();
}
modal.addEventListener("close", endDialog);
modal.addEventListener("click", (e) => {
  if (e.target !== modal) return;
  const b = modal.getBoundingClientRect();
  if (
    e.clientX < b.left ||
    e.clientX > b.right ||
    e.clientY < b.top ||
    e.clientY > b.bottom
  )
    closeDialog();
});
$("#close-dialog").addEventListener("click", closeDialog);
$("#enlarge").addEventListener("click", (e) =>
  openDialog("stage", e.currentTarget),
);
$$("[data-dialog]").forEach((button) =>
  button.addEventListener("click", (e) =>
    openDialog(button.dataset.dialog, e.currentTarget),
  ),
);
const android = /Android/i.test(navigator.userAgent);
$$("[data-phone]").forEach((button) =>
  button.addEventListener("click", (e) => {
    openDialog(
      mode === "wall" && android ? "camera" : "phone",
      e.currentTarget,
    );
  }),
);
$("#wall-camera").addEventListener("click", (e) =>
  openDialog("camera", e.currentTarget),
);
async function prepareWallCamera(body) {
  const request = ++cameraLoads;
  const launch = body.querySelector(".start-camera");
  const detail = body.querySelector(".camera-detail");
  try {
    const module = await import("./wall/wall.js");
    const xr = await module.supportsNativeWall();
    if (!body.contains(launch) || request !== cameraLoads) return;
    cameraModule = module;
    cameraMode = xr ? "webxr" : "patch";
    detail.textContent = xr
      ? "Move slowly across a well-lit wall. Place the film when the surface is detected."
      : "Face a textured wall straight on. Choose a spot with visible detail for the camera to follow.";
    launch.disabled = false;
    launch.textContent = "Open camera";
    launch.addEventListener(
      "click",
      () => {
        closeDialog();
        try {
          const session = cameraModule.startWall({
            filmUrl: new URL("./assets/poster-540.mp4", document.baseURI).href,
            posterUrl: new URL("./assets/poster.jpg", document.baseURI).href,
            mode: cameraMode,
            container: document.body,
            onEnd: () => {
              wallSession = undefined;
              $("#wall-camera").focus({ preventScroll: true });
            },
          });
          wallSession = session;
          session.ready.catch(() => {});
        } catch (e) {
          notify(e.message || "The camera could not open.");
        }
      },
      { once: true },
    );
  } catch {
    if (!body.contains(launch)) return;
    detail.textContent =
      "The camera player could not load. Close this window, check your connection and try again.";
    launch.textContent = "Camera unavailable";
  }
}

async function copy(url, container, button) {
  try {
    await navigator.clipboard.writeText(url);
    if (button && modal.open) button.textContent = "Link copied";
    else notify("Artwork link copied");
  } catch {
    if (!modal.open) openDialog("phone", $("#share"));
    const parent = container || $("#modal-body");
    let field = parent.querySelector(".manual-link");
    if (!field) {
      field = document.createElement("input");
      field.className = "manual-link";
      field.readOnly = true;
      field.setAttribute("aria-label", "Link to this artwork");
      parent.append(field);
    }
    field.value = url;
    field.focus();
    field.select();
  }
}
$("#share").addEventListener("click", async () => {
  const url = launchUrl(mode);
  if (navigator.share) {
    try {
      await navigator.share({ title: "Moeckel Pond", url });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  await copy(url);
});
new IntersectionObserver((entries) => {
  onscreen = entries[0].isIntersecting;
  schedule();
}).observe(stage);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) movie.pause();
  schedule();
});
window.addEventListener("pagehide", () => {
  viewActive = false;
  wallSession?.close();
  movie.pause();
  clearModel();
  schedule();
});
window.addEventListener("pageshow", (e) => {
  viewActive = true;
  if (e.persisted && mode === "miniature") void mountModel();
  schedule();
});
function followLocation() {
  selectMode(hashMode(), false);
  if (location.hash === "#original-film" && !modal.open && !wallSession) {
    openDialog("camera", $("#wall-camera"));
  }
}
window.addEventListener("hashchange", followLocation);
followLocation();
