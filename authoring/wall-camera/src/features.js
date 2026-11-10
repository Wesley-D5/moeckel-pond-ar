import cv from "jsfeat";

const byte = cv.U8_t | cv.C1_t;
const model = new cv.motion_model.homography2d();
const settings = new cv.ransac_params_t(4, 2.6, 0.48, 0.995);
const radius = Array.from({ length: 16 }, (_, i) =>
  Math.round(Math.sqrt(225 - i * i)),
);

function orientation(image, x, y) {
  let dx = 0,
    dy = 0;
  for (let j = -15; j <= 15; j++) {
    const reach = radius[Math.abs(j)],
      row = (y + j) * image.cols + x;
    for (let i = -reach; i <= reach; i++) {
      const intensity = image.data[row + i];
      dx += i * intensity;
      dy += j * intensity;
    }
  }
  return Math.atan2(dy, dx);
}
function bits(n) {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
const inside = (p, r) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const corners = (r) => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];
function distributed(points, r, minSpan) {
  if (!points.length) return false;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    mask = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    mask |=
      1 << ((p.x > r.x + r.w / 2 ? 1 : 0) + (p.y > r.y + r.h / 2 ? 2 : 0));
  }
  return (
    bits(mask) >= 3 &&
    maxX - minX >= r.w * minSpan &&
    maxY - minY >= r.h * minSpan
  );
}
export function project(h, p) {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}
function geometryOK(q, r, w, h) {
  if (
    !q.every(
      (p) =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Math.abs(p.x) < w * 4 &&
        Math.abs(p.y) < h * 4,
    )
  )
    return false;
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4],
      c = q[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < 8) return false;
  }
  const area =
    Math.abs(
      q.reduce(
        (s, p, i) => s + p.x * q[(i + 1) % 4].y - p.y * q[(i + 1) % 4].x,
        0,
      ),
    ) / 2;
  if (area < r.w * r.h * 0.13 || area > r.w * r.h * 6) return false;
  const lengths = q.map((p, i) =>
    Math.hypot(p.x - q[(i + 1) % 4].x, p.y - q[(i + 1) % 4].y),
  );
  return (
    lengths[0] / lengths[2] > 0.34 &&
    lengths[0] / lengths[2] < 2.95 &&
    lengths[1] / lengths[3] > 0.34 &&
    lengths[1] / lengths[3] < 2.95
  );
}
function pyramid(w, h) {
  const p = new cv.pyramid_t(3);
  p.allocate(w, h, byte);
  return p;
}
export class WallFeatures {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.last = pyramid(w, h);
    this.next = pyramid(w, h);
    this.smooth = new cv.matrix_t(w, h, byte);
    this.pool = Array.from(
      { length: Math.ceil((w * h) / 3) },
      () => new cv.keypoint_t(),
    );
    this.desc = new cv.matrix_t(32, 480, byte);
    this.mask = new cv.matrix_t(1, 480, byte);
    this.matrix = new cv.matrix_t(3, 3, cv.F32_t | cv.C1_t);
    this.hasFrame = false;
    this.reset();
  }
  reset() {
    this.template = null;
    this.links = [];
    this.frameNumber = 0;
    this.pose = null;
  }
  describe(pyramid, region, limit) {
    const image = this.smooth;
    cv.imgproc.gaussian_blur(pyramid.data[0], image, 3);
    cv.yape06.laplacian_threshold = 20;
    cv.yape06.min_eigen_value_threshold = 12;
    const count = cv.yape06.detect(image, this.pool, 18);
    const chosen = this.pool
      .slice(0, count)
      .filter((p) => inside(p, region))
      .sort((a, b) => b.score - a.score);
    const grid = new Uint16Array(48),
      points = [];
    const perCell = Math.max(5, Math.ceil(limit / 24));
    for (const p of chosen) {
      const u = Math.min(7, Math.floor(((p.x - region.x) / region.w) * 8)),
        v = Math.min(5, Math.floor(((p.y - region.y) / region.h) * 6));
      if (grid[v * 8 + u]++ >= perCell) continue;
      p.angle = orientation(image, p.x, p.y);
      points.push(p);
      if (points.length === limit) break;
    }
    if (points.length) cv.orb.describe(image, points, points.length, this.desc);
    const bytes = new Uint8Array(points.length * 32);
    bytes.set(this.desc.data.subarray(0, bytes.length));
    return {
      points: points.map((p) => ({ x: p.x, y: p.y })),
      words: new Uint32Array(bytes.buffer),
    };
  }
  capture(r) {
    if (!this.hasFrame) return false;
    const region = {
      x: Math.max(0, r.x - r.w * 0.1),
      y: Math.max(0, r.y - r.h * 0.28),
      w: Math.min(this.w, r.w * 1.2),
      h: Math.min(this.h, r.h * 1.56),
    };
    region.w = Math.min(region.w, this.w - region.x);
    region.h = Math.min(region.h, this.h - region.y);
    const ref = this.describe(this.last, region, 240);
    if (ref.points.length < 26 || !distributed(ref.points, region, 0.5))
      return false;
    this.template = { ...ref, r, region };
    this.links = ref.points.map((p, i) => ({ id: i, ...p }));
    this.pose = corners(r);
    this.frameNumber = 0;
    return true;
  }
  match() {
    const ref = this.template;
    const current = this.describe(
      this.next,
      { x: 0, y: 0, w: this.w, h: this.h },
      440,
    );
    const links = [],
      used = new Set();
    for (let i = 0; i < ref.points.length; i++) {
      let best = 257,
        second = 257,
        index = -1;
      for (let j = 0; j < current.points.length; j++) {
        let d = 0;
        for (let k = 0; k < 8; k++)
          d += bits(ref.words[i * 8 + k] ^ current.words[j * 8 + k]);
        if (d < best) {
          second = best;
          best = d;
          index = j;
        } else if (d < second) second = d;
      }
      if (best < 64 && best < second * 0.78)
        links.push({ id: i, ...current.points[index], index, d: best });
    }
    links.sort((a, b) => a.d - b.d);
    return links.filter((p) => !used.has(p.index) && used.add(p.index));
  }
  flow() {
    const n = this.links.length;
    if (n < 12) return [];
    const a = new Float32Array(n * 2),
      b = new Float32Array(n * 2),
      back = new Float32Array(n * 2);
    const ok = new Uint8Array(n),
      again = new Uint8Array(n);
    this.links.forEach((p, i) => {
      a[i * 2] = p.x;
      a[i * 2 + 1] = p.y;
    });
    cv.optical_flow_lk.track(
      this.last,
      this.next,
      a,
      b,
      n,
      15,
      16,
      ok,
      0.015,
      0.0001,
    );
    cv.optical_flow_lk.track(
      this.next,
      this.last,
      b,
      back,
      n,
      15,
      16,
      again,
      0.015,
      0.0001,
    );
    const out = [];
    for (let i = 0; i < n; i++) {
      if (
        !ok[i] ||
        !again[i] ||
        Math.hypot(back[i * 2] - a[i * 2], back[i * 2 + 1] - a[i * 2 + 1]) >
          1.35
      )
        continue;
      out.push({ id: this.links[i].id, x: b[i * 2], y: b[i * 2 + 1] });
    }
    return out;
  }
  fit(matches) {
    if (matches.length < 12) return null;
    const ref = this.template,
      src = matches.map((p) => ref.points[p.id]);
    if (
      !cv.motion_estimator.ransac(
        settings,
        model,
        src,
        matches,
        matches.length,
        this.matrix,
        this.mask,
        350,
      )
    )
      return null;
    const links = matches.filter((p, i) => this.mask.data[i]);
    if (links.length < 12 || links.length / matches.length < 0.55) return null;
    const base = links.map((p) => ref.points[p.id]);
    if (
      !distributed(base, ref.region, 0.32) ||
      !model.run(base, links, this.matrix, links.length)
    )
      return null;
    const h = this.matrix.data;
    const errors = links
      .map((p, i) => {
        const v = project(h, base[i]);
        return Math.hypot(p.x - v.x, p.y - v.y);
      })
      .sort((a, b) => a - b);
    if (errors[errors.length >> 1] > 1.7) return null;
    const q = corners(ref.r).map((p) => project(h, p));
    return geometryOK(q, ref.r, this.w, this.h) ? { q, links } : null;
  }
  update(rgba) {
    cv.imgproc.grayscale(rgba, this.w, this.h, this.next.data[0]);
    this.next.build(this.next.data[0], true);
    const ref = this.template;
    let h = null;
    if (ref) {
      this.frameNumber++;
      // Keep original keypoint identities through short optical-flow updates.
      // Periodic matches to the original camera patch reject drift and recover after occlusion.
      let fit = null;
      const refresh = !this.links.length || this.frameNumber % 6 === 0;
      if (refresh) fit = this.fit(this.match());
      if (!fit && this.links.length) fit = this.fit(this.flow());
      if (!fit && !refresh) fit = this.fit(this.match());
      if (fit) {
        this.links = fit.links;
        this.pose = fit.q;
        h = Array.from(this.matrix.data.subarray(0, 9));
      } else {
        this.links = [];
        this.pose = null;
      }
    }
    [this.last, this.next] = [this.next, this.last];
    this.hasFrame = true;
    return h;
  }
}
