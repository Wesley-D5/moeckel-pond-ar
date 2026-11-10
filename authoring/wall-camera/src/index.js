import { startPatchWall } from "./patch.js";

export async function supportsNativeWall() {
  try {
    return !!(await navigator.xr?.isSessionSupported("immersive-ar"));
  } catch {
    return false;
  }
}
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}
export function startWall({
  filmUrl,
  posterUrl,
  container = document.body,
  mode = "patch",
  onEnd = () => {},
}) {
  if (!filmUrl) throw new Error("A film URL is required.");
  if (!document.querySelector("link[data-wall-film-style]")) {
    const style = el("link");
    style.rel = "stylesheet";
    style.href = new URL("./wall.css", import.meta.url).href;
    style.dataset.wallFilmStyle = "";
    document.head.append(style);
  }
  const root = el("dialog", "wall-room"),
    stage = el("div", "wall-stage"),
    header = el("div", "wall-header");
  const title = el("span", "wall-id", "Moeckel Pond"),
    closeButton = el("button", "wall-button wall-close", "Close");
  const footer = el("div", "wall-footer"),
    hint = el("p", "wall-hint", "Opening the camera…"),
    controls = el("div", "wall-controls");
  const placeButton = el("button", "wall-button wall-place", "Place film"),
    soundButton = el("button", "wall-button", "Sound off");
  const aim = el("div", "wall-reticle"),
    video = document.createElement("video"),
    aborter = new AbortController();
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.loop = true;
  video.muted = true;
  video.preload = "auto";
  video.src = new URL(filmUrl, document.baseURI).href;
  if (posterUrl) video.poster = new URL(posterUrl, document.baseURI).href;
  root.dataset.route = mode;
  root.dataset.state = "loading";
  root.setAttribute("aria-label", "Moeckel Pond wall film");
  hint.setAttribute("role", "status");
  aim.setAttribute("aria-hidden", "true");
  soundButton.setAttribute("aria-pressed", "false");
  header.append(title, closeButton);
  controls.append(placeButton, soundButton);
  footer.append(hint, controls);
  root.append(stage, aim, header, footer);
  container.append(root);
  root.showModal();
  closeButton.focus();
  let closed = false,
    active = null,
    xrSession = null,
    spawn = 0,
    started = false;
  let state = "loading",
    message = "";
  function status(next, text) {
    if (closed || (next === state && text === message)) return;
    state = next;
    message = text;
    root.dataset.state = next;
    hint.textContent = text;
    const relocate = next === "placed" || next === "lost";
    placeButton.textContent =
      next === "error" && mode === "webxr"
        ? "Use wall texture tracking"
        : relocate
          ? "Move film"
          : "Place film";
    placeButton.disabled =
      next === "loading" ||
      (next === "error" && mode !== "webxr") ||
      (mode === "webxr" && !relocate && !["ready", "error"].includes(next));
    soundButton.hidden = next === "error";
    soundButton.disabled = next !== "placed";
  }
  function failed(error) {
    if (closed) return;
    const text =
      error?.name === "NotAllowedError"
        ? "Camera access was declined. Allow it in browser settings, then reopen this view."
        : error?.name === "NotFoundError"
          ? "No camera was found. Open this experience on your phone."
          : error?.message || "The camera could not open.";
    status("error", text);
  }
  function hidden() {
    if (mode !== "webxr" && document.hidden && started) close();
  }
  function close() {
    if (closed) return;
    closed = true;
    ++spawn;
    aborter.abort();
    active?.stop();
    active = null;
    if (xrSession) {
      xrSession.end().catch(() => {});
      xrSession = null;
    }
    root.removeEventListener("cancel", cancel);
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("pagehide", close);
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (root.open) root.close();
    root.remove();
    onEnd();
  }
  function cancel(e) {
    e.preventDefault();
    close();
  }
  root.addEventListener("cancel", cancel);
  window.addEventListener("pagehide", close);
  document.addEventListener("visibilitychange", hidden);
  closeButton.onclick = close;
  placeButton.onclick = () => {
    if (state === "error" && mode === "webxr") {
      ++spawn;
      active?.stop();
      active = null;
      xrSession?.end().catch(() => {});
      xrSession = null;
      mode = "patch";
      root.dataset.route = mode;
      started = false;
      stage.replaceChildren();
      video.removeAttribute("class");
      video.removeAttribute("style");
      try {
        active = startPatchWall({
          stage,
          video,
          onStatus: status,
          onError: failed,
        });
        active.ready.then(
          () => {
            if (!closed) {
              started = true;
              if (document.hidden) close();
            }
          },
          () => {},
        );
      } catch (error) {
        failed(error);
      }
    } else if (state === "placed" || state === "lost") active?.reset();
    else active?.place();
  };
  soundButton.onclick = () => {
    video.muted = !video.muted;
    if (!video.muted)
      video.play().catch(() => {
        video.muted = true;
      });
  };
  video.onvolumechange = () => {
    soundButton.textContent = video.muted ? "Sound off" : "Sound on";
    soundButton.setAttribute("aria-pressed", String(!video.muted));
  };
  stage.onclick = (e) => {
    if (state === "searching" || state === "ready") {
      const b = stage.getBoundingClientRect();
      active?.place(
        (e.clientX - b.left) / b.width,
        (e.clientY - b.top) / b.height,
      );
    }
  };
  status("loading", "Opening the camera…");
  const playError = () => {
    if (!closed && video.error) {
      active?.stop();
      failed(
        new Error(
          "The film could not load. Check the connection and reopen the wall view.",
        ),
      );
    }
  };
  video.addEventListener("error", playError);
  const ready = (async () => {
    const id = ++spawn;
    if (mode === "webxr") {
      if (!navigator.xr?.requestSession)
        throw new Error("Immersive AR is unavailable in this browser.");
      // Request in the original user gesture, before fetching the optional renderer.
      const result = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test", "dom-overlay"],
        optionalFeatures: ["anchors", "local-floor"],
        domOverlay: { root },
      });
      if (closed || id !== spawn) {
        await result.end();
        return;
      }
      xrSession = result;
      const module = await import("./webxr.js");
      if (closed || id !== spawn) return;
      video.className = "wall-native-film";
      stage.append(video);
      const xr = await module.attachWebXR({
        session: result,
        root,
        stage,
        video,
        onStatus: status,
        onEnd: close,
        signal: aborter.signal,
      });
      if (closed || id !== spawn) {
        xr.stop();
        return;
      }
      active = xr;
    } else {
      active = startPatchWall({
        stage,
        video,
        onStatus: status,
        onError: failed,
      });
      await active.ready;
    }
    if (!closed) {
      started = true;
      if (mode !== "webxr" && document.hidden) close();
    }
  })().catch((e) => {
    if (!closed) {
      if (xrSession) xrSession.end().catch(() => {});
      failed(e);
    }
    throw e;
  });
  ready.catch(() => {});
  return { ready, close };
}
