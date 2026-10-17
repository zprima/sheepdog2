'use strict';
// Shared steering and collision helpers for sheep and dog.

// Bend a desired velocity so it slides along nearby walls instead of running into them.
function steerAroundWalls(dx, dy, x, y, walls, look, radius) {
  const spd = Math.hypot(dx, dy);
  if (spd < 0.01) return [dx, dy];
  let ox = dx, oy = dy;
  for (const s of walls) {
    const c = M.closestOnSeg(x, y, s.ax, s.ay, s.bx, s.by);
    let nx = x - c.x, ny = y - c.y;
    const d = Math.hypot(nx, ny);
    if (d > look || d < 1e-6) continue;
    nx /= d; ny /= d;
    const into = ox * nx + oy * ny;
    if (into < 0) {
      const f = M.clamp(1 - Math.max(0, d - radius) / look, 0, 1);
      ox -= nx * into * f;
      oy -= ny * into * f;
      if (d < radius * 2.5) {
        const push = spd * 0.6 * (1 - d / (radius * 2.5));
        ox += nx * push; oy += ny * push;
      }
    }
  }
  const l = Math.hypot(ox, oy);
  if (l > 1e-3) {
    const keep = M.clamp(l / spd, 0.25, 1);
    ox = ox / l * spd * keep; oy = oy / l * spd * keep;
  }
  return [ox, oy];
}

function resolveWalls(e, walls, r) {
  for (const s of walls) {
    const c = M.closestOnSeg(e.x, e.y, s.ax, s.ay, s.bx, s.by);
    let nx = e.x - c.x, ny = e.y - c.y;
    const d = Math.hypot(nx, ny);
    if (d < r) {
      if (d < 1e-6) {
        nx = s.ay - s.by; ny = s.bx - s.ax;
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      } else { nx /= d; ny /= d; }
      e.x = c.x + nx * r; e.y = c.y + ny * r;
      const vn = e.vx * nx + e.vy * ny;
      if (vn < 0) { e.vx -= vn * nx; e.vy -= vn * ny; }
    }
  }
}

function resolveCircles(e, circles, r) {
  for (const c of circles) {
    let nx = e.x - c.x, ny = e.y - c.y;
    const d = Math.hypot(nx, ny), min = r + c.r;
    if (d < min) {
      if (d < 1e-6) { nx = 1; ny = 0; } else { nx /= d; ny /= d; }
      e.x = c.x + nx * min; e.y = c.y + ny * min;
      const vn = e.vx * nx + e.vy * ny;
      if (vn < 0) { e.vx -= vn * nx; e.vy -= vn * ny; }
    }
  }
}

function keepInBounds(e, b, r) {
  if (e.x < b.x + r) { e.x = b.x + r; if (e.vx < 0) e.vx = 0; }
  if (e.y < b.y + r) { e.y = b.y + r; if (e.vy < 0) e.vy = 0; }
  if (e.x > b.x + b.w - r) { e.x = b.x + b.w - r; if (e.vx > 0) e.vx = 0; }
  if (e.y > b.y + b.h - r) { e.y = b.y + b.h - r; if (e.vy > 0) e.vy = 0; }
}

// Push two circular bodies apart (weights decide who moves).
function separateBodies(a, b, ra, rb, wa = 0.5, wb = 0.5) {
  let nx = b.x - a.x, ny = b.y - a.y;
  const d = Math.hypot(nx, ny), min = ra + rb;
  if (d >= min) return;
  if (d < 1e-6) { nx = Math.random() - 0.5; ny = Math.random() - 0.5; }
  const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
  const pen = min - d;
  a.x -= nx * pen * wa; a.y -= ny * pen * wa;
  b.x += nx * pen * wb; b.y += ny * pen * wb;
}
