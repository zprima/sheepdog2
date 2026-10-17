'use strict';
// Small vector / geometry helpers shared by every module.
const M = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  len: (x, y) => Math.hypot(x, y),
  norm(x, y) { const l = Math.hypot(x, y); return l > 1e-9 ? [x / l, y / l] : [0, 0]; },
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  rand: (a, b) => a + Math.random() * (b - a),
  angleLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  },
  // Closest point on segment AB to P.
  closestOnSeg(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const l2 = abx * abx + aby * aby;
    let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { x: ax + abx * t, y: ay + aby * t, t };
  },
  distToSeg(px, py, ax, ay, bx, by) {
    const c = M.closestOnSeg(px, py, ax, ay, bx, by);
    return Math.hypot(px - c.x, py - c.y);
  },
  // Deterministic pseudo-random in [0,1) from two integers.
  hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  },
  pointInRect: (px, py, r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  fmtTime(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  },
};
