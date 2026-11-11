import { WallFeatures } from "./features.js";

function rectAt(w, h, x, y) {
  const width = Math.min(w * 0.78, h * 1.28),
    height = (width * 9) / 16;
  return {
    x: Math.max(0, Math.min(w - width, x - width / 2)),
    y: Math.max(0, Math.min(h - height, y - height / 2)),
    w: width,
    h: height,
  };
}
function cssProjection(m, r, sx, sy) {
  const x = r.x,
    y = r.y;
  return (
    "matrix3d(" +
    [
      m[0],
      (m[3] * sy) / sx,
      0,
      m[6] / sx,
      (m[1] * sx) / sy,
      m[4],
      0,
      m[7] / sy,
      0,
      0,
      1,
      0,
      sx * (m[0] * x + m[1] * y + m[2]),
      sy * (m[3] * x + m[4] * y + m[5]),
      0,
      m[6] * x + m[7] * y + m[8],
    ].join(",") +
    ")"
  );
}
export function startPatchWall({ stage, video, onStatus, onError }) {
  let stream,
    stopped = false,
    tracker,
    rect,
    frame = 0,
    lastTime = -Infinity,
    nextDue = 0,
    watchdog = 0,
    showing = false;
  const camera = document.createElement("video"),
    buffer = document.createElement("canvas");
  camera.muted = true;
  camera.autoplay = true;
  camera.playsInline = true;
  camera.setAttribute("playsinline", "");
  camera.setAttribute("aria-hidden", "true");
  camera.className = "wall-lens";
  video.classList.add("wall-film");
  stage.append(camera, video);
  const ctx = buffer.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });
  const hint = "Face a textured wall straight on. Tap the spot for the film.";
  const visible = (value) => {
    if (value === showing) return;
    showing = value;
    video.style.visibility = value ? "visible" : "hidden";
    if (value)
      video.play().catch(() => {
        if (!stopped) {
          video.muted = true;
          video.play().catch(() => {});
        }
      });
    else video.pause();
  };
  const reset = () => {
    rect = null;
    tracker?.reset();
    visible(false);
    onStatus("searching", hint);
  };
  const size = () => {
    const w = stage.clientWidth,
      h = stage.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(1, 560 / Math.max(w, h)),
      width = Math.max(80, Math.round(w * scale)),
      height = Math.max(80, Math.round(h * scale));
    if (
      tracker &&
      Math.abs(width / tracker.w - 1) < 0.03 &&
      Math.abs(height / tracker.h - 1) < 0.03
    )
      return;
    buffer.width = width;
    buffer.height = height;
    tracker = new WallFeatures(width, height);
    reset();
  };
  const renderPose = (h) => {
    const sx = stage.clientWidth / tracker.w,
      sy = stage.clientHeight / tracker.h;
    video.style.width = rect.w * sx + "px";
    video.style.height = rect.h * sy + "px";
    video.style.transform = cssProjection(h, rect, sx, sy);
    visible(true);
    onStatus("placed", "Film anchored to the wall.");
  };
  const place = (x = 0.5, y = 0.5) => {
    if (stopped || !tracker?.hasFrame) return false;
    if (rect) return false;
    const picked = rectAt(tracker.w, tracker.h, x * tracker.w, y * tracker.h);
    if (!tracker.capture(picked)) {
      onStatus(
        "untextured",
        "Choose an area with more detail, such as wood grain, brick or a wall hanging.",
      );
      return false;
    }
    rect = picked;
    renderPose([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    return true;
  };
  const schedule = () => {
    if (stopped) return;
    frame = camera.requestVideoFrameCallback
      ? camera.requestVideoFrameCallback(step)
      : requestAnimationFrame(step);
  };
  const step = (now) => {
    if (stopped) return;
    if (
      now >= nextDue &&
      camera.readyState >= 2 &&
      camera.videoWidth &&
      camera.videoHeight &&
      tracker
    ) {
      lastTime = now;
      nextDue = Math.max(now - 1000 / 24, nextDue) + 1000 / 24;
      const w = buffer.width,
        h = buffer.height,
        sw = camera.videoWidth,
        sh = camera.videoHeight;
      const cover = Math.max(w / sw, h / sh),
        cw = w / cover,
        ch = h / cover;
      try {
        ctx.drawImage(camera, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
        const hmat = tracker.update(ctx.getImageData(0, 0, w, h).data);
        if (rect) {
          if (hmat) renderPose(hmat);
          else {
            visible(false);
            onStatus(
              "lost",
              "Return to the wall detail you chose to recover the film.",
            );
          }
        }
      } catch (error) {
        stop();
        onError(error);
        return;
      }
    }
    schedule();
  };
  const ended = () => {
    if (!stopped) {
      stop();
      onError(new Error("The camera stopped. Open it again to continue."));
    }
  };
  const observer = new ResizeObserver(size);
  function stop() {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    clearInterval(watchdog);
    if (camera.cancelVideoFrameCallback) camera.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    stream?.getTracks().forEach((t) => {
      t.removeEventListener("ended", ended);
      t.stop();
    });
    camera.pause();
    camera.srcObject = null;
    camera.remove();
    video.pause();
    video.style.visibility = "hidden";
    tracker = null;
    buffer.width = buffer.height = 1;
  }
  async function launch() {
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !ctx
    )
      throw new Error("Open this camera in Safari or Chrome over HTTPS.");
    onStatus("loading", "Allow access to the rear camera.");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    if (document.hidden) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Return to the page to reopen the camera.");
    }
    stream.getTracks().forEach((t) => t.addEventListener("ended", ended));
    camera.srcObject = stream;
    await camera.play();
    if (stopped) return;
    size();
    observer.observe(stage);
    schedule();
    watchdog = setInterval(() => {
      if (!stopped && rect && showing && performance.now() - lastTime > 700) {
        visible(false);
        tracker.links = [];
        onStatus("lost", "Keep the camera on the original wall detail.");
      }
    }, 350);
  }
  const ready = launch().catch((e) => {
    if (!stopped) {
      stop();
      onError(e);
    }
    throw e;
  });
  ready.catch(() => {});
  return { ready, place, reset, stop };
}
