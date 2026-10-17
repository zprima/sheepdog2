'use strict';
// Isometric renderer. World (x,y,h) -> screen: sx = (x - y) * zoom, sy = (x + y) * zoom / 2 - h * zoom * 0.9.
// Ground height is added to h, measured from the height under the camera so the followed point stays centred.
class Camera {
  constructor() { this.x = 0; this.y = 0; this.zoom = 16; this.w = 1; this.h = 1; this.ground = null; this.hc = 0; }
  toScreen(wx, wy, h = 0) {
    const g = this.ground;
    return this.project(wx, wy, g && !g.flat ? h + g.height(wx, wy) : h);
  }
  // As toScreen, with h already the absolute height (ground included).
  project(wx, wy, habs) {
    const h = habs - this.hc;
    return [
      (wx - wy - (this.x - this.y)) * this.zoom + this.w / 2,
      (wx + wy - (this.x + this.y)) * this.zoom * 0.5 + this.h / 2 - h * this.zoom * 0.9,
    ];
  }
  toWorld(sx, sy) {
    const u = (sx - this.w / 2) / this.zoom + (this.x - this.y);
    const v = (sy - this.h / 2) / (this.zoom * 0.5) + (this.x + this.y);
    return [(u + v) / 2, (v - u) / 2];
  }
  // World-space bounding box of the viewport.
  worldBounds() {
    const pts = [this.toWorld(0, 0), this.toWorld(this.w, 0), this.toWorld(0, this.h), this.toWorld(this.w, this.h)];
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [x, y] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    return { minx, miny, maxx, maxy };
  }
}

// Big landmark buildings: depth-sorted from their footprint centre, with a broad ground shadow.
const LANDMARKS = new Set(['barn', 'windmill', 'stones', 'castle', 'flagpole', 'lighthouse', 'chapel', 'temple']);

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = new Camera();
    this.dpr = 1;
    this.flakes = [];
    this.petals = [];
    this.drops = [];
    this.splashes = [];
    this.mist = [];
    this.streaks = [];
    this.wind = null;
    this.lastDraw = performance.now();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cam.w = window.innerWidth; this.cam.h = window.innerHeight;
    this.canvas.width = Math.floor(this.cam.w * this.dpr);
    this.canvas.height = Math.floor(this.cam.h * this.dpr);
  }

  onScreen(sx, sy, margin = 60) {
    return sx > -margin && sy > -margin && sx < this.cam.w + margin && sy < this.cam.h + margin;
  }

  draw(game) {
    const ctx = this.ctx, cam = this.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const now = performance.now(), dt = Math.min(0.1, (now - this.lastDraw) / 1000);
    this.lastDraw = now;
    const terrain = game.course ? game.course.map.terrain || {} : {};
    ctx.fillStyle = terrain.bg || '#3e6e2b';
    ctx.fillRect(0, 0, cam.w, cam.h);
    if (!game.course) return;
    cam.ground = game.course.ground;
    this.wind = game.course.wind;
    cam.hc = cam.ground.height(cam.x, cam.y);

    this.drawGround(game);
    this.drawObjectiveArrow(game);
    this.drawShadows(game);

    // Depth-sorted entities.
    const items = [];
    const push = (depth, fn) => items.push({ depth, fn });
    const c = game.course;

    const fence = c.map.fence || { style: 'rail' };
    for (const seg of c.boundary) this.pushFence(items, seg, 4, fence);
    for (const g of [c.fetchGate, ...c.driveGates]) for (const h of g.hurdles) push(this.segDepth(h), () => this.drawHurdle(h, '#d9c48a', true));
    for (const wll of c.pen.walls) push(this.segDepth(wll), () => this.drawHurdle(wll, '#c9ae74', false));
    const gs = c.pen.gateSeg();
    push(this.segDepth(gs) + 0.3, () => this.drawHurdle(gs, '#e0c27c', false));
    push(c.post.x + c.post.y, () => this.drawPost(c.post));
    for (const t of c.props) {
      const [sx, sy] = cam.toScreen(t.x, t.y);
      if (!this.onScreen(sx, sy, (t.len || t.r * 3) * cam.zoom)) continue;
      push(t.x + t.y + (t.kind === 'rock' || t.kind === 'hayrack' || t.kind === 'torii' || t.kind === 'aqueduct' || t.kind === 'hut' || LANDMARKS.has(t.kind) ? 0 : t.r * 0.5), () => this.drawProp(t));
    }
    push(game.handler.x + game.handler.y, () => this.drawHandler(game.handler, game));
    for (const s of game.sheep) push(s.x + s.y, () => this.drawSheep(s));
    push(game.dog.x + game.dog.y, () => this.drawDog(game.dog));

    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.fn();
    this.drawWhistle(game);
    this.drawWeather(c.map.weather, dt);
    if (this.wind) this.drawWind(this.wind, dt);
  }

  segDepth(s) { return (s.ax + s.ay + s.bx + s.by) / 2; }

  drawGround(game) {
    const ctx = this.ctx, cam = this.cam, c = game.course, map = c.map, gr = c.ground;
    const now = performance.now() / 1000;
    // The smooth, lit ground is pre-rendered in this projection; place it with one scaled draw.
    const iso = gr.iso(), s = cam.zoom / iso.Z;
    const tx = cam.w / 2 - (cam.x - cam.y) * cam.zoom - iso.offU * s;
    const ty = cam.h / 2 - (cam.x + cam.y) * cam.zoom * 0.5 + cam.hc * cam.zoom * 0.9 - iso.offV * s;
    ctx.save();
    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * tx, this.dpr * ty);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(iso.canvas, 0, 0);
    ctx.restore();

    // Close up, scatter crisp marks (tufts, flowers, pebbles...) over it.
    if (cam.zoom >= 11) {
      this.marks = { stroke: new Map(), fill: new Map() };
      const T = 2.5, b = cam.worldBounds(), pad = gr.maxH * 1.2 + T, ext = TERRAIN_MARGIN;
      const i0 = Math.floor(Math.max(-ext, b.minx - pad) / T), i1 = Math.ceil(Math.min(map.width + ext, b.maxx + pad) / T);
      const j0 = Math.floor(Math.max(-ext, b.miny - pad) / T), j1 = Math.ceil(Math.min(map.height + ext, b.maxy + pad) / T);
      // Corner heights row by row, shared between neighbouring tiles.
      let rowA = new Float64Array(i1 - i0 + 1), rowB = new Float64Array(i1 - i0 + 1);
      const fillRow = (row, j) => { for (let i = i0; i <= i1; i++) row[i - i0] = gr.height(i * T, j * T); };
      fillRow(rowA, j0);
      for (let j = j0; j < j1; j++) {
        fillRow(rowB, j + 1);
        for (let i = i0; i < i1; i++) {
          const x0 = i * T, y0 = j * T, k = i - i0;
          const h = [rowA[k], rowA[k + 1], rowB[k + 1], rowB[k]];
          const p0 = cam.project(x0, y0, h[0]), p1 = cam.project(x0 + T, y0, h[1]), p2 = cam.project(x0 + T, y0 + T, h[2]), p3 = cam.project(x0, y0 + T, h[3]);
          if (p1[0] < 0 || p3[0] > cam.w || Math.max(p1[1], p2[1], p3[1]) < 0 || Math.min(p0[1], p1[1], p3[1]) > cam.h) continue;
          const sf = SURFACES[gr.tileSurface(i, j, T)];
          if (sf.detail) this.groundDetail(sf, i, j, x0, y0, T, h, cam.zoom >= 15 ? 14 : 7, now);
        }
        [rowA, rowB] = [rowB, rowA];
      }
      this.flushMarks();
    }
    if (map.terrain && map.terrain.shore) this.drawSurf(game, now);
    // Trodden ground inside the pen.
    const pen = game.course.pen;
    const q = [cam.toScreen(pen.x, pen.y), cam.toScreen(pen.x + pen.w, pen.y), cam.toScreen(pen.x + pen.w, pen.y + pen.h), cam.toScreen(pen.x, pen.y + pen.h)];
    ctx.fillStyle = 'rgba(120,95,55,0.45)';
    ctx.beginPath(); q.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
  }

  // Close-up marks on one ground tile: grass tufts, flowers, pebbles, snow drifts, sand ripples, wave glints or rain rings.
  // Marks are gathered into one path per colour (this.marks) and drawn together by flushMarks().
  groundDetail(sf, i, j, x0, y0, T, h, n, now) {
    const cam = this.cam, z = cam.zoom;
    const path = (map, key) => { let p = map.get(key); if (!p) map.set(key, p = new Path2D()); return p; };
    const stroke = (key) => path(this.marks.stroke, key), fill = (key) => path(this.marks.fill, key);
    const at = (k) => {
      const fx = M.hash2(i * 7 + k, j * 13 + 1), fy = M.hash2(i * 3 + 5, j * 11 + k);
      const hh = (h[0] * (1 - fx) + h[1] * fx) * (1 - fy) + (h[3] * (1 - fx) + h[2] * fx) * fy;
      return cam.project(x0 + fx * T, y0 + fy * T, hh);
    };
    switch (sf.detail) {
      case 'tuft': case 'flower': {
        for (let k = 0; k < n; k++) {
          const [gx, gy] = at(k), v = M.hash2(i + k * 31, j - k), p = stroke(v < 0.55 ? sf.lo : sf.hi);
          const l = z * (0.1 + 0.1 * v);
          p.moveTo(gx, gy); p.lineTo(gx - z * 0.06, gy - l); p.moveTo(gx, gy); p.lineTo(gx + z * 0.015, gy - l * 1.15); p.moveTo(gx, gy); p.lineTo(gx + z * 0.07, gy - l * 0.9);
        }
        if (sf.detail === 'flower') for (let k = 0; k < n; k += 2) {
          const v = M.hash2(i * 5 + k, j * 17 + 3);
          if (v > 0.5) continue;
          const [gx, gy] = at(k + 40), r = Math.max(1, z * 0.055);
          const p = fill(sf.dots[Math.floor(v / 0.5 * sf.dots.length)]);
          p.moveTo(gx + r, gy - z * 0.1); p.arc(gx, gy - z * 0.1, r, 0, Math.PI * 2);
        }
        break;
      }
      case 'pebble':
        for (let k = 0; k < n; k++) {
          const [gx, gy] = at(k), r = z * (0.04 + 0.07 * M.hash2(i + k, j * 3)), p = fill(k % 3 ? sf.ink : sf.hi);
          p.moveTo(gx + r * 1.4, gy); p.ellipse(gx, gy, r * 1.4, r, 0, 0, Math.PI * 2);
        }
        break;
      case 'cobble':   // Roman basalt paving: irregular polygonal blocks with dark joints and a worn shine
        for (let k = 0; k < n; k += 2) {
          const [gx, gy] = at(k), r = z * (0.28 + 0.12 * M.hash2(i * 3 + k, j * 7)), p = stroke(sf.ink), q = fill(sf.hi);
          for (let e = 0; e <= 5; e++) {
            const a = (e % 5) / 5 * Math.PI * 2 + M.hash2(i + k, j + e) * 0.6, w = 0.8 + 0.3 * M.hash2(e, i * 5 + j + k);
            const px = gx + Math.cos(a) * r * w, py = gy + Math.sin(a) * r * w * 0.5;
            e ? p.lineTo(px, py) : p.moveTo(px, py);
          }
          q.moveTo(gx + r * 0.3, gy - r * 0.08); q.ellipse(gx - r * 0.05, gy - r * 0.08, r * 0.35, r * 0.13, 0, 0, Math.PI * 2);
        }
        break;
      case 'drift':
        for (let k = 0; k < n; k += 2) { const [gx, gy] = at(k), p = stroke(sf.ink); p.moveTo(gx - z * 0.35, gy); p.quadraticCurveTo(gx, gy - z * 0.12, gx + z * 0.35, gy); }
        break;
      case 'ripple':
        for (let k = 0; k < n; k += 2) { const [gx, gy] = at(k), p = stroke(sf.ink); p.moveTo(gx - z * 0.3, gy + z * 0.08); p.quadraticCurveTo(gx, gy - z * 0.06, gx + z * 0.3, gy + z * 0.08); }
        break;
      case 'wave':
        for (let k = 0; k < n; k += 2) {
          const a = Math.sin(now * 1.6 + M.hash2(i + k, j) * 12);
          if (a < 0.4) continue;
          const [gx, gy] = at(k), p = stroke(`rgba(230,245,250,${Math.round((a - 0.4) * 10) / 10 * 0.8})`);
          p.moveTo(gx - z * 0.4, gy); p.lineTo(gx + z * 0.4, gy);
        }
        break;
      case 'rings':   // raindrops landing in a puddle: small rings that spread and fade
        for (let k = 0; k < n; k += 2) {
          const t = (now * 0.8 + M.hash2(i * 9 + k, j * 5 - k)) % 1;
          const [gx, gy] = at(k), r = z * (0.05 + 0.3 * t), a = Math.round((1 - t) * 6) / 10;
          if (a <= 0) continue;
          const p = stroke(`rgba(225,235,238,${a})`);
          p.moveTo(gx + r, gy); p.ellipse(gx, gy, r, r * 0.5, 0, 0, Math.PI * 2);
        }
        break;
    }
  }

  flushMarks() {
    const ctx = this.ctx;
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    for (const [style, p] of this.marks.stroke) { ctx.strokeStyle = style; ctx.stroke(p); }
    for (const [style, p] of this.marks.fill) { ctx.fillStyle = style; ctx.fill(p); }
  }

  // Foam where the surf washes up the beach (sea to the east of the field).
  drawSurf(game, now) {
    const ctx = this.ctx, cam = this.cam, map = game.course.map, b = cam.worldBounds();
    const y0 = Math.max(-TERRAIN_MARGIN, Math.floor(b.miny)), y1 = Math.min(map.height + TERRAIN_MARGIN, Math.ceil(b.maxy));
    if (y1 <= y0) return;
    for (const [lag, alpha, w] of [[0, 0.75, 0.22], [1.7, 0.4, 0.14]]) {
      const swash = Math.sin(now * 0.7 - lag) * 1.6 - lag * 0.8;
      ctx.strokeStyle = `rgba(245,250,250,${alpha})`; ctx.lineWidth = Math.max(1.5, cam.zoom * w); ctx.lineCap = 'round';
      ctx.beginPath();
      for (let y = y0; y <= y1; y += 2) {
        const x = map.width + map.terrain.shore + Math.sin(y / 17) * 2.5 + swash + Math.sin(y * 0.4 + now * 1.3) * 0.3;
        const [sx, sy] = cam.toScreen(x, y);
        y === y0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }

  // Where the current phase wants things to go, and what is heading there (the dog on the outrun, the flock after).
  // The last command, shown as a tag rising over the dog (and sound rings at the handler when in view), so
  // commands can be read with the sound off. Fades out over about a second and a half.
  drawWhistle(game) {
    const w = game.lastWhistle;
    if (!w || game.inMenu) return;
    const age = (performance.now() - w.t) / 1000, life = 1.5;
    if (age > life) return;
    const ctx = this.ctx, z = this.cam.zoom, fade = age < 0.12 ? age / 0.12 : 1 - Math.max(0, (age - 0.9) / (life - 0.9));
    ctx.save();
    // Rings spreading from the handler.
    const [hx, hy] = this.cam.toScreen(game.handler.x, game.handler.y, 1.7);
    if (this.onScreen(hx, hy)) {
      ctx.strokeStyle = '#fff6dc'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) {
        const a = age * 1.6 - i * 0.25;
        if (a <= 0 || a >= 1) continue;
        ctx.globalAlpha = (1 - a) * 0.7;
        ctx.beginPath(); ctx.arc(hx, hy, z * (0.4 + a * 1.6), -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
      }
    }
    // Tag over the dog.
    const label = w.cmd === 'STEADY' ? (w.steady ? 'Steady' : 'Steady off') : WHISTLE_LABEL[w.cmd];
    if (label) {
      const [dx, dy] = this.cam.toScreen(game.dog.x, game.dog.y, 1.4 + age * 0.8);
      const text = `\u266A ${label}`;
      ctx.font = '600 13px "Avenir Next", "Segoe UI", system-ui, sans-serif';
      const tw = ctx.measureText(text).width, bw = tw + 16, bh = 22, bx = dx - bw / 2, by = dy - bh - 6;
      ctx.globalAlpha = fade * 0.92;
      ctx.fillStyle = 'rgba(16, 24, 12, 0.85)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 11); ctx.fill();
      ctx.strokeStyle = 'rgba(242, 193, 78, 0.7)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#f2c14e'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(text, dx, by + bh / 2 + 0.5);
    }
    ctx.restore();
  }

  objective(game) {
    const t = game.trial, c = game.course, f = game.flock;
    if (game.inMenu || !t || t.result || t.pasture || !f || !f.n) return null;
    switch (t.phase) {
      case 'OUTRUN': return { from: game.dog, to: f, gap: 2 };
      case 'LIFT': return { from: f, to: c.post, gap: f.spread + 2.5 };
      case 'FETCH': {
        const g = c.fetchGate, past = (f.x - g.x) * g.dir.x + (f.y - g.y) * g.dir.y > 0;
        return { from: f, to: past ? c.post : g, gap: f.spread + 2.5 };
      }
      case 'DRIVE1': return { from: f, to: c.driveGates[0], gap: f.spread + 2.5 };
      case 'DRIVE2': return { from: f, to: c.driveGates[1], gap: f.spread + 2.5 };
      case 'DRIVE3': case 'PEN': return { from: f, to: c.pen.mouth, gap: f.spread + 2.5 };
      default: return null;
    }
  }

  // A faint chevron on the grass just ahead of the flock (or dog), pointing at the objective.
  drawObjectiveArrow(game) {
    const o = this.objective(game);
    if (!o) return;
    const dx = o.to.x - o.from.x, dy = o.to.y - o.from.y, dist = Math.hypot(dx, dy);
    const gap = Math.min(o.gap, 9), L = 1.6;
    const fade = M.clamp((dist - gap - L - 2) / 4, 0, 1);   // fade out on arrival
    if (fade <= 0) return;
    const ux = dx / dist, uy = dy / dist, px = -uy, py = ux;
    const bx = o.from.x + ux * gap, by = o.from.y + uy * gap;
    const tip = this.cam.toScreen(bx + ux * L, by + uy * L);
    const l = this.cam.toScreen(bx + px * L * 0.7, by + py * L * 0.7);
    const r = this.cam.toScreen(bx - px * L * 0.7, by - py * L * 0.7);
    if (!this.onScreen(tip[0], tip[1])) return;
    const ctx = this.ctx, pulse = 0.75 + 0.25 * Math.sin(performance.now() / 450);
    ctx.save();
    ctx.globalAlpha = 0.32 * fade * pulse;
    ctx.strokeStyle = '#f4f1e4'; ctx.lineWidth = Math.max(1.5, this.cam.zoom * 0.16);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(r[0], r[1]); ctx.stroke();
    ctx.restore();
  }

  shadow(x, y, rx, ry) {
    const ctx = this.ctx, [sx, sy] = this.cam.toScreen(x, y);
    if (!this.onScreen(sx, sy)) return;
    ctx.fillStyle = 'rgba(20,40,15,0.35)';
    ctx.beginPath(); ctx.ellipse(sx + rx * 0.3, sy + 1, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  drawShadows(game) {
    const z = this.cam.zoom;
    // A soft band of shade along the boundary fence (sun from the upper left), wider for walls and hedges.
    const ctx = this.ctx, style = (game.course.map.fence || {}).style, solid = style === 'stone' || style === 'hedge';
    ctx.strokeStyle = solid ? 'rgba(20,35,15,0.3)' : 'rgba(20,35,15,0.22)'; ctx.lineWidth = Math.max(2, z * (solid ? 1.1 : 0.45)); ctx.lineCap = 'butt';
    ctx.beginPath();
    for (const seg of game.course.boundary) {
      const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay), n = Math.max(1, Math.round(len / 4)), o = solid ? 0.6 : 0.35;
      for (let k = 0; k <= n; k++) {
        const [sx, sy] = this.cam.toScreen(M.lerp(seg.ax, seg.bx, k / n) + o, M.lerp(seg.ay, seg.by, k / n) + o);
        k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      }
    }
    ctx.stroke();
    // Gates and pen hurdles.
    const c = game.course;
    ctx.strokeStyle = 'rgba(20,35,15,0.25)'; ctx.lineWidth = Math.max(2, z * 0.4); ctx.lineCap = 'round';
    ctx.beginPath();
    for (const h of [...c.fetchGate.hurdles, ...c.driveGates.flatMap(g => g.hurdles), ...c.pen.walls]) {
      const [x0, y0] = this.cam.toScreen(h.ax + 0.3, h.ay + 0.3), [x1, y1] = this.cam.toScreen(h.bx + 0.3, h.by + 0.3);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    for (const s of game.sheep) this.shadow(s.x, s.y, 0.65 * z, 0.3 * z);
    this.shadow(game.dog.x, game.dog.y, 0.55 * z, 0.25 * z);
    this.shadow(game.handler.x, game.handler.y, 0.4 * z, 0.2 * z);
    for (const t of game.course.props) {
      const k = t.kind || 'oak';
      if (k === 'hayrack') { for (let f = -0.5; f <= 0.5; f += 0.25) this.shadow(t.x + t.len * f + 1, t.y + 1, 1.6 * z, 0.8 * z); continue; }
      if (k === 'aqueduct') continue;
      if (k === 'rock') continue;   // drawRock casts its own shadow tight under the stone
      if (k === 'hut') { this.shadow(t.x + 2, t.y + 2, t.r * 1.5 * z, t.r * 0.8 * z); continue; }
      if (k === 'torii') { for (const f of [-0.5, 0.5]) this.shadow(t.x + t.len * f + 0.8, t.y + 0.8, 0.5 * z, 0.25 * z); continue; }
      if (k === 'flagpole') { this.shadow(t.x + 0.3, t.y + 0.3, 0.4 * z, 0.2 * z); continue; }
      if (LANDMARKS.has(k)) { this.shadow(t.x + t.r * 0.4, t.y + t.r * 0.4, t.r * 1.4 * z, t.r * 0.7 * z); continue; }
      const low = k === 'shrub' || k === 'palmetto' || k === 'cactus' || k === 'haystack' || k === 'lantern' || k === 'column' || k === 'shrine';
      const s = k === 'palm' || k === 'birch' ? 0.7 : k === 'cypress' ? 0.45 : k === 'column' || k === 'shrine' ? 0.5 : low ? 0.9 : 1;
      this.shadow(t.x + t.r * 0.4, t.y + t.r * 0.4, t.r * z * s, t.r * z * s * 0.5);
    }
  }

  pushFence(items, seg, spacing, fence) {
    const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
    const n = Math.max(1, Math.round(len / spacing));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const s = { ax: M.lerp(seg.ax, seg.bx, t0), ay: M.lerp(seg.ay, seg.by, t0), bx: M.lerp(seg.ax, seg.bx, t1), by: M.lerp(seg.ay, seg.by, t1) };
      const [sx, sy] = this.cam.toScreen((s.ax + s.bx) / 2, (s.ay + s.by) / 2);
      if (!this.onScreen(sx, sy, 120)) continue;
      items.push({ depth: this.segDepth(s), fn: () => this.drawFenceSeg(s, fence) });
    }
  }

  postAt(x, y, h, w, color) {
    const ctx = this.ctx, z = this.cam.zoom;
    const [sx, sy] = this.cam.toScreen(x, y), [tx, ty] = this.cam.toScreen(x, y, h);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, w * z); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
  }

  rail(ax, ay, bx, by, h, w, color) {
    const ctx = this.ctx, z = this.cam.zoom;
    const [x0, y0] = this.cam.toScreen(ax, ay, h), [x1, y1] = this.cam.toScreen(bx, by, h);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, w * z); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  // A post or rail between two screen points with a dark edge round it and a sunlit upper edge, so fences, gates
  // and the pen read clearly against any ground. `w` is in metres.
  solidLine(p0, p1, w, color) {
    const ctx = this.ctx, lw = Math.max(1.5, w * this.cam.zoom);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(28,20,12,0.6)'; ctx.lineWidth = lw + 2;
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    if (lw >= 2.5) {
      const o = lw * 0.22;
      ctx.strokeStyle = 'rgba(255,245,220,0.3)'; ctx.lineWidth = lw * 0.35;
      ctx.beginPath(); ctx.moveTo(p0[0] - o * 0.5, p0[1] - o); ctx.lineTo(p1[0] - o * 0.5, p1[1] - o); ctx.stroke();
    }
  }

  drawFenceSeg(s, f) {
    const ctx = this.ctx, cam = this.cam, z = cam.zoom;
    const line = (p0, p1, w, color) => this.solidLine(p0, p1, w, color);
    const rail = (h, w, color, a = 0, b = 1) => line(cam.toScreen(M.lerp(s.ax, s.bx, a), M.lerp(s.ay, s.by, a), h), cam.toScreen(M.lerp(s.ax, s.bx, b), M.lerp(s.ay, s.by, b), h), w, color);
    const post = (h, w, color) => line(cam.toScreen(s.ax, s.ay), cam.toScreen(s.ax, s.ay, h), w, color);
    const quad = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); };
    switch (f.style) {
      case 'wire':     // ranch fence: cedar posts, a top board and two strands of barbed wire
        for (const h of [0.4, 0.75]) this.rail(s.ax, s.ay, s.bx, s.by, h, 0.05, 'rgba(40,35,30,0.95)');
        rail(1.1, 0.18, '#9a7854');
        post(1.3, 0.26, f.post);
        break;
      case 'stone': {  // dry-stone dyke: a solid wall with a rough coping, its top seen from above
        const H = 1.2, [dx, dy] = M.norm(s.bx - s.ax, s.by - s.ay);
        let px = -dy * 0.6, py = dx * 0.6;
        if (px + py > 0) { px = -px; py = -py; }      // the top face lies on the far side, away from the camera
        const wall = f.wall || '#7d7b72';
        quad([cam.toScreen(s.ax, s.ay), cam.toScreen(s.bx, s.by), cam.toScreen(s.bx, s.by, H), cam.toScreen(s.ax, s.ay, H)], wall);
        quad([cam.toScreen(s.ax, s.ay, H), cam.toScreen(s.bx, s.by, H), cam.toScreen(s.bx + px, s.by + py, H), cam.toScreen(s.ax + px, s.ay + py, H)], f.cap || '#99978d');
        ctx.fillStyle = 'rgba(40,38,34,0.4)';
        for (let k = 0; k < 8; k++) {
          const t = M.hash2(Math.round(s.ax * 3 + k), Math.round(s.ay * 3)), hh = 0.15 + 0.85 * M.hash2(k, Math.round(s.ax + s.ay));
          const [qx, qy] = cam.toScreen(M.lerp(s.ax, s.bx, t), M.lerp(s.ay, s.by, t), hh);
          ctx.beginPath(); ctx.ellipse(qx, qy, z * 0.24, z * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        }
        // Dark foot and a crisp edge along the top of the face.
        const [f0, f1] = [cam.toScreen(s.ax, s.ay), cam.toScreen(s.bx, s.by)], [t0, t1] = [cam.toScreen(s.ax, s.ay, H), cam.toScreen(s.bx, s.by, H)];
        ctx.lineCap = 'butt';
        ctx.strokeStyle = 'rgba(30,28,24,0.55)'; ctx.lineWidth = Math.max(1.5, z * 0.1);
        ctx.beginPath(); ctx.moveTo(f0[0], f0[1]); ctx.lineTo(f1[0], f1[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,250,235,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.stroke();
        break;
      }
      case 'tyrol': {  // Tyrolean Schrankzaun: upright stakes with split rails laid slanting between them
        const n = 3;
        for (let k = 0; k < n; k++) {
          const a = k / n, b = (k + 1) / n + 0.12;
          line(cam.toScreen(M.lerp(s.ax, s.bx, a), M.lerp(s.ay, s.by, a), 0.1), cam.toScreen(M.lerp(s.ax, s.bx, b), M.lerp(s.ay, s.by, b), 1.3), 0.2, k % 2 ? '#a07a52' : '#8a6741');
        }
        post(1.5, 0.26, '#5e4630');
        this.rail(s.ax, s.ay, s.bx, s.by, 1.3, 0.05, 'rgba(60,45,30,0.85)');   // willow withy binding the tops
        break;
      }
      case 'hedge': {  // hawthorn hedgerow: a solid bank of foliage, lumpy along the top
        const H = 1.1;
        quad([cam.toScreen(s.ax, s.ay), cam.toScreen(s.bx, s.by), cam.toScreen(s.bx, s.by, H), cam.toScreen(s.ax, s.ay, H)], '#22471b');
        const n = 5, lumps = [];
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = M.lerp(s.ax, s.bx, t), y = M.lerp(s.ay, s.by, t);
          const [qx, qy] = cam.toScreen(x, y, H), r = z * (0.85 + 0.25 * M.hash2(Math.round(x * 2), Math.round(y * 2)));
          lumps.push([qx, qy, r]);
        }
        for (const [qx, qy, r] of lumps) this.blob(qx, qy, r, '#2c5a22');
        for (const [qx, qy, r] of lumps) this.blob(qx - r * 0.2, qy - r * 0.3, r * 0.6, '#3b7230');
        break;
      }
      case 'bamboo': { // Japanese bamboo fence: posts with bound nodes and three bamboo rails
        for (const h of [0.35, 0.7, 1.05]) rail(h, 0.17, '#c2b878');
        post(1.3, 0.26, '#8f8a4e');
        for (const h of [0.35, 0.7, 1.05]) {
          const [qx, qy] = cam.toScreen(s.ax, s.ay, h);
          ctx.fillStyle = '#3b2e22'; ctx.fillRect(qx - z * 0.12, qy - z * 0.05, z * 0.24, Math.max(1.5, z * 0.1));
        }
        break;
      }
      default: {       // post and rail
        const r = f.rail || '#8a6844';
        for (const h of [0.4, 0.75, 1.1]) rail(h, 0.17, r);
        post(1.3, 0.26, f.post || '#5a4028');
      }
    }
  }

  // Gate and pen hurdles: two posts and three rails, the gate ones with a flag.
  drawHurdle(s, color, flag) {
    const ctx = this.ctx, z = this.cam.zoom, cam = this.cam, dark = '#7a5f36';
    const post = (x, y, h, w, col) => this.solidLine(cam.toScreen(x, y), cam.toScreen(x, y, h), w, col);
    post(s.ax, s.ay, 1.1, 0.22, dark);
    for (const h of [0.35, 0.68, 1.0]) this.solidLine(cam.toScreen(s.ax, s.ay, h), cam.toScreen(s.bx, s.by, h), 0.15, color);
    post(s.bx, s.by, 1.1, 0.22, dark);
    if (flag) {
      post(s.ax, s.ay, 1.9, 0.08, '#3a2c1c');
      const [fx, fy] = cam.toScreen(s.ax, s.ay, 1.9);
      ctx.fillStyle = '#e0442c'; ctx.strokeStyle = 'rgba(60,15,8,0.7)'; ctx.lineWidth = 1; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + z * 0.7, fy + z * 0.2); ctx.lineTo(fx, fy + z * 0.42); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  drawPost(p) {
    const ctx = this.ctx, z = this.cam.zoom;
    this.solidLine(this.cam.toScreen(p.x, p.y), this.cam.toScreen(p.x, p.y, 1.6), 0.14, '#e8e2d2');
    const [fx, fy] = this.cam.toScreen(p.x, p.y, 1.6);
    ctx.fillStyle = '#f2c14e'; ctx.strokeStyle = 'rgba(90,60,10,0.7)'; ctx.lineWidth = 1; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + z * 0.65, fy + z * 0.2); ctx.lineTo(fx, fy + z * 0.42); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  drawProp(t) {
    switch (t.kind) {
      case 'spruce': return this.drawSpruce(t);
      case 'pine': return this.drawPine(t);
      case 'birch': return this.drawBirch(t);
      case 'mesquite': return this.drawMesquite(t);
      case 'palm': return this.drawPalm(t);
      case 'palmetto': return this.drawPalmetto(t);
      case 'shrub': return this.drawShrub(t);
      case 'cactus': return this.drawCactus(t);
      case 'rock': return this.drawRock(t);
      case 'haystack': return this.drawHaystack(t);
      case 'hayrack': return this.drawHayrack(t);
      case 'sakura': return this.drawSakura(t);
      case 'lantern': return this.drawLantern(t);
      case 'torii': return this.drawTorii(t);
      case 'stonepine': return this.drawStonePine(t);
      case 'cypress': return this.drawCypress(t);
      case 'olive': return this.drawOlive(t);
      case 'column': return this.drawColumn(t);
      case 'aqueduct': return this.drawAqueduct(t);
      case 'larch': return this.drawLarch(t);
      case 'hut': return this.drawHut(t);
      case 'shrine': return this.drawShrine(t);
      case 'barn': return this.drawBarn(t);
      case 'windmill': return this.drawWindmill(t);
      case 'stones': return this.drawStones(t);
      case 'castle': return this.drawCastle(t);
      case 'flagpole': return this.drawFlagpole(t);
      case 'lighthouse': return this.drawLighthouse(t);
      case 'chapel': return this.drawChapel(t);
      case 'temple': return this.drawTemple(t);
      default: return this.drawTree(t);
    }
  }

  poly(pts, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color; ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
  }

  blob(x, y, r, color) { const ctx = this.ctx; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  drawTree(t) {
    const ctx = this.ctx, z = this.cam.zoom;
    this.postAt(t.x, t.y, t.r * 0.9, 0.28, '#5b4027');
    const [cx, cy] = this.cam.toScreen(t.x, t.y, t.r * 1.2);
    const r = t.r * z * 0.9;
    const blobs = [[0, 0, 1], [-0.5, 0.25, 0.7], [0.5, 0.2, 0.75], [0, -0.45, 0.65]];
    for (const [ox, oy, k] of blobs) this.blob(cx + ox * r, cy + oy * r, r * k, k > 0.9 ? '#2f6b2a' : '#3b7f33');
    ctx.fillStyle = 'rgba(140,210,110,0.35)';
    ctx.beginPath(); ctx.arc(cx - r * 0.25, cy - r * 0.35, r * 0.4, 0, Math.PI * 2); ctx.fill();
  }

  // Norway spruce: stacked tiers, optionally with snow on the boughs.
  drawSpruce(t) {
    const ctx = this.ctx, z = this.cam.zoom;
    this.postAt(t.x, t.y, t.r * 0.7, 0.22, '#4a3420');
    for (let k = 0; k < 4; k++) {
      const h = t.r * (0.45 + k * 0.62), w = t.r * z * (0.95 - k * 0.2), top = t.r * (k === 3 ? 1.2 : 0.95);
      const [bx, by] = this.cam.toScreen(t.x, t.y, h), [ax, ay] = this.cam.toScreen(t.x, t.y, h + top);
      ctx.fillStyle = k % 2 ? '#2c5e33' : '#24502c';
      ctx.beginPath(); ctx.moveTo(bx - w, by + w * 0.18); ctx.lineTo(ax, ay); ctx.lineTo(bx + w, by + w * 0.18); ctx.quadraticCurveTo(bx, by + w * 0.4, bx - w, by + w * 0.18); ctx.fill();
      ctx.fillStyle = 'rgba(120,180,110,0.18)';
      ctx.beginPath(); ctx.moveTo(bx - w, by + w * 0.18); ctx.lineTo(ax, ay); ctx.lineTo(bx - w * 0.2, by + w * 0.3); ctx.fill();
      if (t.snow) {
        ctx.fillStyle = 'rgba(240,245,250,0.9)';
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(M.lerp(ax, bx - w, 0.4), M.lerp(ay, by, 0.4)); ctx.lineTo(ax, M.lerp(ay, by, 0.3)); ctx.lineTo(M.lerp(ax, bx + w, 0.4), M.lerp(ay, by, 0.4)); ctx.fill();
      }
    }
  }

  // Scots pine: tall bare orange trunk, flat dark crown.
  drawPine(t) {
    const z = this.cam.zoom, lean = (t.seed - 0.5) * 0.6;
    this.postAt(t.x, t.y, t.r * 2.0, 0.24, '#9a5a34');
    const [px, py] = this.cam.toScreen(t.x, t.y, t.r * 2.1), r = t.r * z * 0.95;
    const [wx, wy] = this.sway(t, t.r * 2.1), cx = px + wx, cy = py + wy;
    const blobs = [[0, 0, 1, '#264d2c'], [-0.9 + lean, 0.15, 0.7, '#2d5a32'], [0.9 + lean, 0.1, 0.75, '#2d5a32'], [0.2 + lean, -0.4, 0.7, '#386b3a']];
    for (const [ox, oy, k, col] of blobs) {
      const ctx = this.ctx; ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(cx + ox * r, cy + oy * r, r * k * 1.2, r * k * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Silver birch: white trunk with black marks, light airy crown (golden in autumn).
  drawBirch(t) {
    const ctx = this.ctx, z = this.cam.zoom;
    this.postAt(t.x, t.y, t.r * 1.9, 0.16, '#ece8de');
    for (let k = 0; k < 4; k++) {
      const [mx, my] = this.cam.toScreen(t.x, t.y, t.r * (0.3 + k * 0.38));
      ctx.fillStyle = '#2a2622'; ctx.fillRect(mx - z * 0.08, my, z * 0.1, Math.max(1, z * 0.05));
    }
    const autumn = t.tint === 'autumn';
    const [cx, cy] = this.cam.toScreen(t.x, t.y, t.r * 2.0), r = t.r * z * 0.6;
    const cols = autumn ? ['#c9a63a', '#dcbc4c', '#e8cf6a'] : ['#7aa54c', '#8fb85a', '#a7c86a'];
    const blobs = [[0, 0.2, 1, 0], [-0.6, 0.5, 0.65, 1], [0.6, 0.45, 0.7, 1], [0, -0.45, 0.75, 1], [-0.2, -0.1, 0.45, 2]];
    for (const [ox, oy, k, c] of blobs) this.blob(cx + ox * r, cy + oy * r, r * k, cols[c]);
  }

  // Honey mesquite: crooked low trunk, wide, thin grey-green crown.
  drawMesquite(t) {
    const ctx = this.ctx, z = this.cam.zoom;
    const [bx, by] = this.cam.toScreen(t.x, t.y), [mx, my] = this.cam.toScreen(t.x, t.y, t.r * 0.45);
    ctx.strokeStyle = '#5a4532'; ctx.lineWidth = Math.max(1.5, z * 0.22); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(mx + z * 0.2, my);
    ctx.moveTo(mx + z * 0.2, my); ctx.lineTo(mx - t.r * z * 0.5, my - t.r * z * 0.35);
    ctx.moveTo(mx + z * 0.2, my); ctx.lineTo(mx + t.r * z * 0.6, my - t.r * z * 0.3); ctx.stroke();
    const [cx, cy] = this.cam.toScreen(t.x, t.y, t.r * 0.95), r = t.r * z * 0.75;
    const blobs = [[0, 0, 1, '#6b7d42'], [-0.7, 0.15, 0.6, '#7d8f4e'], [0.75, 0.1, 0.65, '#7d8f4e'], [0.1, -0.25, 0.55, '#8fa05c']];
    for (const [ox, oy, k, col] of blobs) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(cx + ox * r, cy + oy * r, r * k * 1.25, r * k * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Cabbage palm: curved ringed trunk and a head of drooping fronds.
  drawPalm(t) {
    const ctx = this.ctx, z = this.cam.zoom, lean = (t.seed - 0.5) * 2.2;
    const [bx, by] = this.cam.toScreen(t.x, t.y), [tx0, ty] = this.cam.toScreen(t.x, t.y, t.r * 2.6), tx = tx0 + lean * z;
    ctx.strokeStyle = '#8a7350'; ctx.lineWidth = Math.max(2, z * 0.3); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + lean * z * 0.1, (by + ty) / 2, tx, ty); ctx.stroke();
    ctx.lineWidth = Math.max(1.5, z * 0.16);
    const L = t.r * z * 0.95;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + t.seed * 3, ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.45 + L * 0.35;
      ctx.strokeStyle = k % 2 ? '#3f7f35' : '#4f9440';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + Math.cos(a) * L * 0.6, ty + Math.sin(a) * L * 0.3 - L * 0.35, ex, ey); ctx.stroke();
    }
    this.blob(tx, ty, z * 0.25, '#6a5a3a');
  }

  // Saw palmetto: a low clump of spiky fans.
  drawPalmetto(t) {
    const ctx = this.ctx, z = this.cam.zoom;
    const [cx, cy] = this.cam.toScreen(t.x, t.y, 0.15), L = t.r * z;
    ctx.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI * (0.1 + 0.8 * (k / 6)) + (t.seed - 0.5) * 0.4, ex = cx + Math.cos(a) * L, ey = cy + Math.sin(a) * L * 0.75;
      ctx.strokeStyle = k % 2 ? '#5d8a3e' : '#4e7a34'; ctx.lineWidth = Math.max(1, z * 0.07);
      ctx.beginPath();
      for (let f = -2; f <= 2; f++) { ctx.moveTo(cx, cy); ctx.lineTo(ex + f * z * 0.12 * Math.sin(a), ey - f * z * 0.12 * Math.cos(a)); }
      ctx.stroke();
    }
  }

  // Low bush (gorse, broom): a few blobs, optionally flecked with flowers.
  drawShrub(t) {
    const z = this.cam.zoom, [cx, cy] = this.cam.toScreen(t.x, t.y, t.r * 0.5), r = t.r * z * 0.6;
    const leaf = t.leaf || '#4b6a2c';
    for (const [ox, oy, k] of [[-0.6, 0.2, 0.8], [0.6, 0.25, 0.8], [0, -0.2, 1]]) this.blob(cx + ox * r, cy + oy * r, r * k, leaf);
    this.blob(cx - r * 0.2, cy - r * 0.4, r * 0.45, 'rgba(255,255,255,0.12)');
    if (t.flower) for (let k = 0; k < 7; k++) this.blob(cx + (M.hash2(k, t.x | 0) - 0.5) * r * 2, cy + (M.hash2(t.y | 0, k) - 0.6) * r * 1.4, Math.max(1, z * 0.07), t.flower);
  }

  // Prickly pear: flat oval pads, a few red fruit.
  drawCactus(t) {
    const ctx = this.ctx, z = this.cam.zoom, [bx, by] = this.cam.toScreen(t.x, t.y), r = t.r * z * 0.4;
    const pads = [[0, -0.9, 0], [-0.9, -1.5, -0.5], [0.85, -1.6, 0.45], [0, -2.3, 0.1]];
    for (const [ox, oy, a] of pads) {
      ctx.fillStyle = '#5f8c40'; ctx.strokeStyle = '#4a7232'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(bx + ox * r, by + oy * r, r * 0.65, r * 0.95, a, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const [ox, oy] of [[-0.9, -2.4], [0.85, -2.5], [0.1, -3.2]]) this.blob(bx + ox * r, by + oy * r, Math.max(1, r * 0.18), '#b8435a');
  }

  // Boulder: a lumpy grey mound with a lit top.
  drawRock(t) {
    const ctx = this.ctx, z = this.cam.zoom, [bx, by] = this.cam.toScreen(t.x, t.y), r = t.r * z;
    // Shadow cast away from the sun (upper left), so the stone sits on the ground rather than on top of it.
    ctx.fillStyle = 'rgba(20,30,15,0.22)';
    ctx.beginPath(); ctx.ellipse(bx + r * 0.1, by + r * 0.24, r * 0.92, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    const body = () => {
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI + (k / 8) * Math.PI, w = 0.8 + 0.35 * M.hash2(k, Math.round(t.seed * 1000));
        const x = bx + Math.cos(a) * r * w, y = by + r * 0.1 + Math.sin(a) * r * 0.75 * w;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.quadraticCurveTo(bx, by + r * 0.45, bx - r * 0.9, by + r * 0.1);
    };
    body();
    ctx.fillStyle = '#7c7d77'; ctx.fill();
    ctx.strokeStyle = 'rgba(40,40,38,0.55)'; ctx.lineWidth = Math.max(0.6, r * 0.06); ctx.stroke();
    // Darker shaded flank on the side away from the sun.
    ctx.save(); body(); ctx.clip();
    ctx.fillStyle = 'rgba(45,45,42,0.35)';
    ctx.beginPath(); ctx.ellipse(bx + r * 0.55, by + r * 0.15, r * 0.7, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#a9aaa2';
    ctx.beginPath(); ctx.ellipse(bx - r * 0.15, by - r * 0.35, r * 0.5, r * 0.25, -0.15, 0, Math.PI * 2); ctx.fill();
  }

  // Haystack: a tall rounded stack round a pole.
  drawHaystack(t) {
    const ctx = this.ctx, z = this.cam.zoom, [bx, by] = this.cam.toScreen(t.x, t.y), r = t.r * z;
    const [, ty] = this.cam.toScreen(t.x, t.y, t.r * 1.9);
    this.postAt(t.x, t.y, t.r * 2.4, 0.07, '#5a4a32');
    ctx.fillStyle = '#c4a052';
    ctx.beginPath(); ctx.moveTo(bx - r, by); ctx.bezierCurveTo(bx - r * 1.05, by - r * 0.9, bx - r * 0.45, ty, bx, ty);
    ctx.bezierCurveTo(bx + r * 0.45, ty, bx + r * 1.05, by - r * 0.9, bx + r, by); ctx.quadraticCurveTo(bx, by + r * 0.4, bx - r, by); ctx.fill();
    ctx.strokeStyle = 'rgba(120,90,40,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < 4; k++) { const y = M.lerp(by, ty, k / 4), w = r * Math.sqrt(1 - (k / 4.4) ** 2); ctx.moveTo(bx - w, y); ctx.quadraticCurveTo(bx, y + r * 0.15, bx + w, y); }
    ctx.stroke();
    if (t.snow) { ctx.fillStyle = 'rgba(240,245,250,0.92)'; ctx.beginPath(); ctx.ellipse(bx, ty + r * 0.25, r * 0.5, r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); }
  }

  // Slovenian kozolec: a wooden hayrack with slats and a shingled roof, lying along the x axis.
  drawHayrack(t) {
    const ctx = this.ctx, z = this.cam.zoom, ax = t.x - t.len / 2, bx = t.x + t.len / 2, H = t.h || 3.4, hay = H * 0.53;
    for (let k = 0; k <= 3; k++) this.postAt(M.lerp(ax, bx, k / 3), t.y, H, 0.22, '#5e4128');
    for (let h = 0.5; h < H - 0.3; h += 0.42) this.rail(ax, t.y, bx, t.y, h, 0.07, '#8a6a42');
    // Hay drying on the lower slats.
    const q = [this.cam.toScreen(ax + 0.3, t.y, 0.5), this.cam.toScreen(bx - 0.3, t.y, 0.5), this.cam.toScreen(bx - 0.3, t.y, hay), this.cam.toScreen(ax + 0.3, t.y, hay)];
    ctx.fillStyle = 'rgba(205,180,95,0.85)';
    ctx.beginPath(); q.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
    const roof = [this.cam.toScreen(ax - 0.6, t.y + 1.1, H), this.cam.toScreen(bx + 0.6, t.y + 1.1, H), this.cam.toScreen(bx + 0.6, t.y, H + 0.9), this.cam.toScreen(ax - 0.6, t.y, H + 0.9)];
    ctx.fillStyle = '#5a3f2a';
    ctx.beginPath(); roof.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
    const back = [roof[3], roof[2], this.cam.toScreen(bx + 0.6, t.y - 1.1, H), this.cam.toScreen(ax - 0.6, t.y - 1.1, H)];
    ctx.fillStyle = '#6e4e34';
    ctx.beginPath(); back.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
    this.rail(ax - 0.6, t.y, bx + 0.6, t.y, H + 0.9, 0.08, '#3e2a1a');
  }

  // Cherry tree: a dark, crooked trunk forking into a wide, lumpy cloud of blossom (pale Somei-Yoshino, or deep pink).
  drawSakura(t) {
    const ctx = this.ctx, z = this.cam.zoom, lean = (t.seed - 0.5) * 0.9, sd = Math.round(t.seed * 1000);
    const [bx, by] = this.cam.toScreen(t.x, t.y), [fx0, fy] = this.cam.toScreen(t.x, t.y, t.r * 0.5), fx = fx0 + lean * z * 0.4;
    const [cx0, cy] = this.cam.toScreen(t.x, t.y, t.r * 1.05), cx = cx0 + lean * z, r = t.r * z;
    ctx.strokeStyle = '#3e2c28'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, z * 0.38);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx - lean * z * 0.3, (by + fy) / 2, fx, fy); ctx.stroke();
    ctx.lineWidth = Math.max(1.5, z * 0.22);
    ctx.beginPath();
    for (const [ex, ey] of [[-0.75, 0.15], [0.8, 0.1], [0.05, -0.3]]) { ctx.moveTo(fx, fy); ctx.quadraticCurveTo(M.lerp(fx, cx + ex * r, 0.3), M.lerp(fy, cy + ey * r, 0.7), cx + ex * r, cy + ey * r); }
    ctx.stroke();
    const deep = t.tint === 'deep';
    const cols = deep ? ['#c46e95', '#dc8aae', '#e9a5c1', '#f5c8da'] : ['#d69fb6', '#ecbdcf', '#f5d2df', '#fdecf2'];
    // Lumps from the shaded underside up to the sunlit top (sun from the upper left), jittered per tree.
    const lumps = [
      [0, 0.2, 0.75, 0], [-0.8, 0.22, 0.5, 0], [0.85, 0.18, 0.52, 0], [-0.35, 0.3, 0.45, 0], [0.4, 0.3, 0.45, 0],
      [-0.6, -0.02, 0.52, 1], [0.6, -0.05, 0.55, 1], [0, -0.1, 0.65, 1], [-1.05, 0.02, 0.32, 1], [1.05, 0, 0.3, 1],
      [-0.35, -0.35, 0.45, 2], [0.3, -0.32, 0.42, 2], [-0.75, -0.2, 0.3, 2],
      [-0.4, -0.5, 0.26, 3], [0.05, -0.48, 0.24, 3], [-0.75, -0.3, 0.16, 3],
    ];
    for (let k = 0; k < lumps.length; k++) {
      const [ox, oy, s, c] = lumps[k], jx = (M.hash2(k, sd) - 0.5) * 0.18, jy = (M.hash2(sd, k) - 0.5) * 0.12;
      ctx.fillStyle = cols[c];
      ctx.beginPath(); ctx.ellipse(cx + (ox + jx) * r, cy + (oy + jy) * r * 0.8, r * s * 0.95, r * s * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Branch tips poking through, and a few petals falling under the crown.
    ctx.fillStyle = '#4a3530';
    for (let k = 0; k < 4; k++) ctx.fillRect(cx + (M.hash2(k + 9, sd) - 0.5) * r * 1.6, cy + (M.hash2(sd, k + 9) - 0.2) * r * 0.4, Math.max(1, z * 0.1), Math.max(1, z * 0.1));
    ctx.fillStyle = cols[3];
    for (let k = 0; k < 6; k++) {
      const px = cx + (M.hash2(k, sd + 1) - 0.5) * r * 2.2, py = cy + r * 0.5 + M.hash2(sd + 1, k) * (by - cy - r * 0.5);
      ctx.fillRect(px, py, Math.max(1, z * 0.09), Math.max(1, z * 0.06));
    }
  }

  // Stone lantern (ishi-dōrō): footing, post, light box with a glowing window, wide roof and finial.
  drawLantern(t) {
    const ctx = this.ctx, z = this.cam.zoom, s = t.r;
    const [bx, by] = this.cam.toScreen(t.x, t.y);
    const at = (h) => this.cam.toScreen(t.x, t.y, h)[1];
    const slab = (y0, y1, w, col) => { ctx.fillStyle = col; ctx.fillRect(bx - w * z, y1, w * 2 * z, y0 - y1); };
    slab(by, at(s * 0.35), s * 0.55, '#8e8c84');
    slab(at(s * 0.35), at(s * 1.3), s * 0.2, '#a3a199');
    slab(at(s * 1.3), at(s * 1.45), s * 0.45, '#8e8c84');
    slab(at(s * 1.45), at(s * 2.0), s * 0.34, '#a3a199');
    ctx.fillStyle = '#f3cf7a'; ctx.fillRect(bx - s * 0.14 * z, at(s * 1.9), s * 0.28 * z, at(s * 1.55) - at(s * 1.9));
    const ry = at(s * 2.0), rt = at(s * 2.35), w = s * 0.75 * z;
    ctx.fillStyle = '#7c7a73';
    ctx.beginPath(); ctx.moveTo(bx - w, ry + z * 0.05); ctx.quadraticCurveTo(bx - w * 0.4, ry - z * 0.05, bx, rt); ctx.quadraticCurveTo(bx + w * 0.4, ry - z * 0.05, bx + w, ry + z * 0.05); ctx.closePath(); ctx.fill();
    this.blob(bx, rt - s * 0.08 * z, Math.max(1, s * 0.13 * z), '#8e8c84');
  }

  // Torii: two vermilion pillars, a tie beam (nuki) and a black-capped top beam (kasagi) curving up at the ends.
  drawTorii(t) {
    const ctx = this.ctx, z = this.cam.zoom, ax = t.x - t.len / 2, bx = t.x + t.len / 2, H = 5.2;
    for (const x of [ax, bx]) { this.postAt(x, t.y, H, 0.42, '#c8402c'); this.postAt(x, t.y, 0.35, 0.55, '#2a2420'); }
    this.rail(ax - 0.7, t.y, bx + 0.7, t.y, H - 1.1, 0.3, '#c8402c');
    const [lx, ly] = this.cam.toScreen(ax - 1.4, t.y, H + 0.55), [rx, ry] = this.cam.toScreen(bx + 1.4, t.y, H + 0.55);
    const [mx, my] = this.cam.toScreen(t.x, t.y, H + 0.1);
    for (const [w, col, dh] of [[0.42, '#c8402c', 0], [0.2, '#2a2420', 0.3]]) {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, w * z); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(lx, ly - dh * z); ctx.quadraticCurveTo(mx, my + (my - (ly + ry) / 2) * 0.6 - dh * z, rx, ry - dh * z); ctx.stroke();
    }
    this.postAt(t.x, t.y, H, 0.22, '#c8402c');
  }

  // Italian stone pine (pino domestico): a tall, bare, leaning trunk under a flat, wide umbrella crown.
  drawStonePine(t) {
    const ctx = this.ctx, z = this.cam.zoom, lean = (t.seed - 0.5) * 1.4, H = t.r * 2.3;
    const [bx, by] = this.cam.toScreen(t.x, t.y), [px, py] = this.cam.toScreen(t.x, t.y, H);
    const [wx, wy] = this.sway(t, H), cx = px + lean * z + wx, cy = py + wy, r = t.r * z;
    ctx.strokeStyle = '#7a5640'; ctx.lineWidth = Math.max(2, z * 0.26); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + lean * z * 0.1, (by + cy) / 2, cx, cy + r * 0.12);
    // Short forks up into the canopy.
    ctx.moveTo(cx, cy + r * 0.12); ctx.lineTo(cx - r * 0.45, cy + r * 0.02); ctx.moveTo(cx, cy + r * 0.12); ctx.lineTo(cx + r * 0.5, cy); ctx.stroke();
    const lumps = [[0, 0.06, 1.25, 0.32, '#2c4d2a'], [-0.75, 0, 0.6, 0.26, '#35592f'], [0.75, -0.02, 0.62, 0.26, '#35592f'], [-0.25, -0.12, 0.7, 0.24, '#406a37'], [0.3, -0.14, 0.55, 0.2, '#4b783f']];
    for (const [ox, oy, kx, ky, col] of lumps) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(cx + ox * r, cy + oy * r, r * kx, r * ky, 0, 0, Math.PI * 2); ctx.fill(); }
  }

  // Italian cypress: a tall, narrow, dark-green flame.
  drawCypress(t) {
    const ctx = this.ctx, z = this.cam.zoom, H = t.r * 5;
    const [bx, by] = this.cam.toScreen(t.x, t.y, t.r * 0.25), [tx0, ty] = this.cam.toScreen(t.x, t.y, H), [wx] = this.sway(t, H), tx = tx0 + wx;
    const w = t.r * z * 0.42, my = M.lerp(by, ty, 0.35);
    this.postAt(t.x, t.y, t.r * 0.3, 0.14, '#4b3626');
    ctx.fillStyle = '#20402a';
    ctx.beginPath(); ctx.moveTo(bx, by + w * 0.2); ctx.quadraticCurveTo(bx - w * 1.1, my, tx, ty); ctx.quadraticCurveTo(bx + w * 1.1, my, bx, by + w * 0.2); ctx.fill();
    ctx.fillStyle = 'rgba(110,160,90,0.22)';
    ctx.beginPath(); ctx.moveTo(bx - w * 0.2, by); ctx.quadraticCurveTo(bx - w * 0.95, my, tx, ty); ctx.quadraticCurveTo(bx - w * 0.2, my, bx - w * 0.2, by); ctx.fill();
  }

  // Olive: a gnarled, split grey trunk and a loose silvery crown.
  drawOlive(t) {
    const ctx = this.ctx, z = this.cam.zoom, sd = Math.round(t.seed * 1000);
    const [bx, by] = this.cam.toScreen(t.x, t.y), [mx, my] = this.cam.toScreen(t.x, t.y, t.r * 0.55);
    ctx.strokeStyle = '#6f675c'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, z * 0.2);
    ctx.beginPath();
    for (const s of [-1, 1]) { ctx.moveTo(bx + s * z * 0.12, by); ctx.quadraticCurveTo(bx + s * z * 0.35, (by + my) / 2, mx + s * t.r * z * 0.3, my); }
    ctx.stroke();
    const [cx, cy] = this.cam.toScreen(t.x, t.y, t.r * 1.0), r = t.r * z * 0.72;
    const lumps = [[0, 0.1, 1, '#5b6a45'], [-0.7, 0.2, 0.6, '#6b7a52'], [0.7, 0.15, 0.62, '#6b7a52'], [-0.25, -0.3, 0.55, '#86956c'], [0.35, -0.2, 0.45, '#9aa682']];
    for (let k = 0; k < lumps.length; k++) {
      const [ox, oy, s, col] = lumps[k], jx = (M.hash2(k, sd) - 0.5) * 0.2;
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(cx + (ox + jx) * r, cy + oy * r, r * s * 1.05, r * s * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // A ruined marble column: base, fluted shaft broken off at a slant, and a drum fallen beside it.
  drawColumn(t) {
    const ctx = this.ctx, z = this.cam.zoom, s = t.r, sd = t.seed;
    const [bx, by] = this.cam.toScreen(t.x, t.y), at = (h) => this.cam.toScreen(t.x, t.y, h)[1];
    const H = s * (1.6 + sd * 2.6), w = s * 0.42 * z;
    // Fallen drum, lying on the far side so the standing shaft is drawn over it.
    const [dx, dy] = this.cam.toScreen(t.x + s * 0.9, t.y - s * 0.9, s * 0.3);
    ctx.fillStyle = '#cfc8b8'; ctx.beginPath(); ctx.ellipse(dx, dy, w * 1.1, w * 0.6, 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e4ddcd'; ctx.beginPath(); ctx.ellipse(dx + w * 0.75, dy - w * 0.2, w * 0.4, w * 0.55, 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#bfb8a8'; ctx.fillRect(bx - w * 1.5, at(s * 0.35), w * 3, by - at(s * 0.35));
    ctx.fillStyle = '#d6cfbf'; ctx.fillRect(bx - w * 1.5, at(s * 0.35) - Math.max(1, z * 0.06), w * 3, Math.max(1, z * 0.08));
    const top = at(H), slant = w * (sd - 0.5) * 1.6;
    ctx.fillStyle = '#e8e2d4';
    ctx.beginPath(); ctx.moveTo(bx - w, at(s * 0.35)); ctx.lineTo(bx - w, top + slant); ctx.lineTo(bx + w, top - slant); ctx.lineTo(bx + w, at(s * 0.35)); ctx.fill();
    ctx.fillStyle = 'rgba(120,110,95,0.35)';
    ctx.fillRect(bx + w * 0.35, top - slant * 0.4, w * 0.65, at(s * 0.35) - top + slant * 0.4);
    ctx.strokeStyle = 'rgba(140,130,115,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); for (const f of [-0.5, 0, 0.5]) { ctx.moveTo(bx + f * w, at(s * 0.35)); ctx.lineTo(bx + f * w, top - slant * f + Math.abs(slant) * 0.6); } ctx.stroke();
  }

  // A run of Roman aqueduct arches in brick and tufa, lying along the x axis (outside the field).
  drawAqueduct(t) {
    const ctx = this.ctx, z = this.cam.zoom, ax = t.x - t.len / 2, bx = t.x + t.len / 2, H = t.h || 9, n = t.arches;
    const P = (x, h) => this.cam.toScreen(x, t.y, h);
    const quad = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); };
    // Top of the channel, seen from above, then the long front face.
    const top = [P(ax, H), P(bx, H), this.cam.toScreen(bx, t.y - 1.6, H), this.cam.toScreen(ax, t.y - 1.6, H)];
    quad(top, '#c9a77c');
    quad([P(ax, 0), P(bx, 0), P(bx, H), P(ax, H)], '#b5764f');
    // Arches cut through the face: the far side of each opening shows the sky-lit ground behind, darkened.
    const span = t.len / n, pier = span * 0.28, spring = H * 0.55;
    ctx.fillStyle = 'rgba(40,30,20,0.55)';
    for (let k = 0; k < n; k++) {
      if (t.ruin && M.hash2(k, Math.round(t.seed * 100)) < 0.25) continue;
      const x0 = ax + k * span + pier / 2, x1 = x0 + span - pier, xm = (x0 + x1) / 2;
      // A round arch: two quarter-circle curves from the springing up to the crown.
      const half = (x1 - x0) / 2, [l0, l1] = P(x0, 0), [r0, r1] = P(x1, 0), [ls0, ls1] = P(x0, spring), [rs0, rs1] = P(x1, spring);
      const [cl0, cl1] = P(x0, spring + half), [cr0, cr1] = P(x1, spring + half), [c0, c1] = P(xm, spring + half);
      ctx.beginPath(); ctx.moveTo(l0, l1); ctx.lineTo(ls0, ls1); ctx.quadraticCurveTo(cl0, cl1, c0, c1);
      ctx.quadraticCurveTo(cr0, cr1, rs0, rs1); ctx.lineTo(r0, r1); ctx.closePath(); ctx.fill();
    }
    // Courses of tufa blocks and the cornice under the channel.
    this.rail(ax, t.y, bx, t.y, H - 0.4, 0.3, '#d2b089');
    this.rail(ax, t.y, bx, t.y, H * 0.82, 0.06, 'rgba(90,50,30,0.4)');
    // A broken end: the last stretch crumbles away.
    if (t.ruin) quad([P(bx - 0.1, H), P(bx + 0.4, H * 0.7), P(bx + 0.2, H * 0.4), P(bx - 0.1, H * 0.45)], '#a96d48');
  }

  // European larch: a slim, open cone of soft, pale needles (gold in autumn).
  drawLarch(t) {
    const ctx = this.ctx, z = this.cam.zoom, gold = t.tint === 'autumn';
    this.postAt(t.x, t.y, t.r * 2.6, 0.16, '#6e4a32');
    const cols = gold ? ['#c5952e', '#d9ac3e'] : ['#5d8f3c', '#6fa246'];
    for (let k = 0; k < 5; k++) {
      const h = t.r * (0.5 + k * 0.5), w = t.r * z * (0.85 - k * 0.15), top = t.r * 0.75;
      const [bx, by] = this.cam.toScreen(t.x, t.y, h), [ax, ay] = this.cam.toScreen(t.x, t.y, h + top), [sx] = this.sway(t, h + top);
      ctx.fillStyle = cols[k % 2];
      ctx.beginPath(); ctx.moveTo(bx - w, by + w * 0.12); ctx.quadraticCurveTo(bx - w * 0.3, by - w * 0.1, ax + sx, ay); ctx.quadraticCurveTo(bx + w * 0.3, by - w * 0.1, bx + w, by + w * 0.12);
      ctx.quadraticCurveTo(bx, by + w * 0.32, bx - w, by + w * 0.12); ctx.fill();
    }
  }

  // Log hut on a stone footing with a low, overhanging roof. Tyrolean Almhütte by default (dark logs, red shutters,
  // stones on the shingles); paint 'falu' makes a Finnish mökki: falu-red boards with white trim and a plain roof.
  drawHut(t) {
    const ctx = this.ctx, w = t.r, d = t.r * 0.8, Hw = 3, Hr = 5, falu = t.paint === 'falu';
    const P = (dx, dy, h) => this.cam.toScreen(t.x + dx, t.y + dy, h);
    const quad = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); };
    // Visible walls are the south (+y) and east (+x) faces.
    quad([P(-w, d, 0), P(w, d, 0), P(w, d, 0.8), P(-w, d, 0.8)], '#8e8a80');
    quad([P(w, d, 0), P(w, -d, 0), P(w, -d, 0.8), P(w, d, 0.8)], '#7b776e');
    quad([P(-w, d, 0.8), P(w, d, 0.8), P(w, d, Hw), P(-w, d, Hw)], falu ? '#9b2d24' : '#7a5234');
    quad([P(w, d, 0.8), P(w, -d, 0.8), P(w, -d, Hw), P(w, 0, Hr), P(w, d, Hw)], falu ? '#82251e' : '#6a452b');
    if (falu) {
      // Vertical boards, white corner boards.
      for (let f = -0.8; f < 1; f += 0.2) { const [x0, y0] = P(w * f, d, 0.8), [x1, y1] = P(w * f, d, Hw); ctx.strokeStyle = 'rgba(60,15,10,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
      for (const [x, y] of [[-w, d], [w, d], [w, -d]]) this.postAt(t.x + x, t.y + y, Hw, 0.14, '#efeae0');
    } else for (let h = 1.1; h < Hw; h += 0.32) this.rail(t.x - w, t.y + d, t.x + w, t.y + d, h, 0.035, 'rgba(45,28,16,0.5)');
    // Door and a small window (red shutters, or a white frame).
    quad([P(-w * 0.55, d, 0.8), P(-w * 0.2, d, 0.8), P(-w * 0.2, d, 2.3), P(-w * 0.55, d, 2.3)], falu ? '#efeae0' : '#3e2818');
    if (falu) quad([P(-w * 0.5, d, 0.85), P(-w * 0.25, d, 0.85), P(-w * 0.25, d, 2.2), P(-w * 0.5, d, 2.2)], '#5b3b26');
    if (falu) quad([P(w * 0.15, d, 1.4), P(w * 0.6, d, 1.4), P(w * 0.6, d, 2.3), P(w * 0.15, d, 2.3)], '#efeae0');
    quad([P(w * 0.2, d, 1.5), P(w * 0.55, d, 1.5), P(w * 0.55, d, 2.2), P(w * 0.2, d, 2.2)], '#2b3640');
    if (!falu) for (const [a, b] of [[0.08, 0.2], [0.55, 0.67]]) quad([P(w * a, d, 1.5), P(w * b, d, 1.5), P(w * b, d, 2.2), P(w * a, d, 2.2)], '#a8322a');
    // Roof: ridge runs along x; the south slope faces the camera.
    const o = 0.7;
    quad([P(-w - o, d + o, Hw - 0.2), P(w + o, d + o, Hw - 0.2), P(w + o, 0, Hr), P(-w - o, 0, Hr)], falu ? '#3f3c3c' : '#5c5550');
    for (let k = 1; k < 5; k++) this.rail(t.x - w - o, t.y + (d + o) * k / 5, t.x + w + o, t.y + (d + o) * k / 5, Hr - (Hr - Hw + 0.2) * k / 5, 0.04, 'rgba(30,26,24,0.45)');
    this.rail(t.x - w - o, t.y, t.x + w + o, t.y, Hr, 0.12, falu ? '#2c2a2a' : '#3d3632');
    if (falu) { this.postAt(t.x + w * 0.5, t.y - 0.3, Hr + 0.9, 0.35, '#7b776e'); return; }   // chimney
    for (let k = 0; k < 6; k++) {
      const fx = (M.hash2(k, 3) - 0.5) * 2 * w, fy = 0.25 + M.hash2(5, k) * 0.55;
      const [sx, sy] = P(fx, (d + o) * fy, Hr - (Hr - Hw + 0.2) * fy);
      this.blob(sx, sy - 1, Math.max(1, this.cam.zoom * 0.2), '#9d9a92');
    }
  }

  // Marterl: a wooden wayside shrine on a post, with a little pitched roof over a painted panel.
  drawShrine(t) {
    const ctx = this.ctx, z = this.cam.zoom, s = t.r;
    this.postAt(t.x, t.y, s * 1.6, 0.14, '#5a3f28');
    const [bx, by] = this.cam.toScreen(t.x, t.y, s * 1.6), [, ty] = this.cam.toScreen(t.x, t.y, s * 2.35), w = s * 0.42 * z;
    ctx.fillStyle = '#6e4c30'; ctx.fillRect(bx - w, ty, w * 2, by - ty);
    ctx.fillStyle = '#e9dcb8'; ctx.fillRect(bx - w * 0.7, ty + (by - ty) * 0.15, w * 1.4, (by - ty) * 0.7);
    ctx.fillStyle = '#3a5f9a'; ctx.fillRect(bx - w * 0.5, ty + (by - ty) * 0.25, w, (by - ty) * 0.3);
    ctx.strokeStyle = '#8a2c22'; ctx.lineWidth = Math.max(1, z * 0.05);
    ctx.beginPath(); ctx.moveTo(bx, ty + (by - ty) * 0.25); ctx.lineTo(bx, ty + (by - ty) * 0.8); ctx.moveTo(bx - w * 0.3, ty + (by - ty) * 0.42); ctx.lineTo(bx + w * 0.3, ty + (by - ty) * 0.42); ctx.stroke();
    ctx.fillStyle = '#4a3020';
    ctx.beginPath(); ctx.moveTo(bx - w * 1.5, ty + z * 0.1); ctx.lineTo(bx, ty - w * 1.1); ctx.lineTo(bx + w * 1.5, ty + z * 0.1); ctx.closePath(); ctx.fill();
  }

  // Landmarks: one big, recognisable building per map, set beyond the top fence behind the sheep.

  // Red gambrel barn with white trim and cross-braced doors (Hollow Meadow).
  drawBarn(t) {
    const w = t.r, d = t.r * 0.7, Hw = 3.6, Hk = 6, Hr = 7.4, o = 0.4;
    const P = (dx, dy, h) => this.cam.toScreen(t.x + dx, t.y + dy, h);
    const white = '#efe9dc';
    this.poly([P(-w, d, 0), P(w, d, 0), P(w, d, Hw), P(-w, d, Hw)], '#a8382c');
    // East gable end: the gambrel profile.
    this.poly([P(w, d, 0), P(w, -d, 0), P(w, -d, Hw), P(w, -d * 0.55, Hk), P(w, 0, Hr), P(w, d * 0.55, Hk), P(w, d, Hw)], '#8e2e24');
    // Vertical boards on the long wall.
    this.ctx.strokeStyle = 'rgba(60,15,10,0.3)'; this.ctx.lineWidth = 1; this.ctx.beginPath();
    for (let f = -0.9; f < 1; f += 0.15) { const [x0, y0] = P(w * f, d, 0), [, y1] = P(w * f, d, Hw); this.ctx.moveTo(x0, y0); this.ctx.lineTo(x0, y1); }
    this.ctx.stroke();
    // Big sliding door with a white X, and a hayloft door up in the gable.
    const door = (pts) => { this.poly(pts, '#922f25'); this.solidLine(pts[0], pts[2], 0.14, white); this.solidLine(pts[1], pts[3], 0.14, white); this.ctx.strokeStyle = white; this.ctx.lineWidth = Math.max(1, this.cam.zoom * 0.14); this.ctx.beginPath(); pts.forEach((p, k) => (k ? this.ctx.lineTo(p[0], p[1]) : this.ctx.moveTo(p[0], p[1]))); this.ctx.closePath(); this.ctx.stroke(); };
    door([P(-w * 0.35, d, 0), P(w * 0.35, d, 0), P(w * 0.35, d, Hw * 0.8), P(-w * 0.35, d, Hw * 0.8)]);
    door([P(w, d * 0.35, Hw + 0.2), P(w, -d * 0.35, Hw + 0.2), P(w, -d * 0.35, Hk - 0.4), P(w, d * 0.35, Hk - 0.4)]);
    // Roof: steep lower slope, then the shallow upper slope, both facing the camera.
    this.poly([P(-w - o, d + o, Hw - 0.1), P(w + o, d + o, Hw - 0.1), P(w + o, d * 0.55, Hk), P(-w - o, d * 0.55, Hk)], '#4b4a4c');
    this.poly([P(-w - o, d * 0.55, Hk), P(w + o, d * 0.55, Hk), P(w + o, 0, Hr), P(-w - o, 0, Hr)], '#5d5c5e');
    // White trim along the eaves, the knee and the gable edges.
    for (const [a, b] of [[[d + o, Hw - 0.1], [d * 0.55, Hk]], [[d * 0.55, Hk], [0, Hr]]]) this.solidLine(P(w + o, a[0], a[1]), P(w + o, b[0], b[1]), 0.18, white);
    this.solidLine(P(-w - o, d + o, Hw - 0.1), P(w + o, d + o, Hw - 0.1), 0.16, white);
    this.rail(t.x - w - o, t.y, t.x + w + o, t.y, Hr, 0.14, '#3a393b');
    // A cupola on the ridge.
    const c = 0.55;
    this.poly([P(-c, c, Hr - 0.3), P(c, c, Hr - 0.3), P(c, c, Hr + 1), P(-c, c, Hr + 1)], white);
    this.poly([P(c, c, Hr - 0.3), P(c, -c, Hr - 0.3), P(c, -c, Hr + 1), P(c, c, Hr + 1)], '#d8d2c4');
    this.poly([P(-c * 0.5, c, Hr + 0.2), P(c * 0.5, c, Hr + 0.2), P(c * 0.5, c, Hr + 0.8), P(-c * 0.5, c, Hr + 0.8)], '#3a3335');
    this.poly([P(-c - 0.2, c + 0.2, Hr + 1), P(c + 0.2, c + 0.2, Hr + 1), P(c + 0.2, -c - 0.2, Hr + 1), P(0, 0, Hr + 1.8)], '#4b4a4c');
  }

  // Aermotor-style windpump on a steel lattice tower, with a stock tank beside it (Texas).
  drawWindmill(t) {
    const ctx = this.ctx, z = this.cam.zoom, H = 10, b = 1.4, a = 0.3;
    const P = (dx, dy, h) => this.cam.toScreen(t.x + dx, t.y + dy, h);
    const steel = '#5c5f5c';
    // Tail vane trails away from the camera, so draw it first.
    const hub = P(0.5, 0.5, H + 0.6), tail = P(-2.6, -2.6, H + 0.9);
    this.solidLine(hub, tail, 0.12, steel);
    this.poly([P(-1.8, -1.8, H + 0.3), P(-3, -3, H + 0.3), P(-3, -3, H + 1.7), P(-1.8, -1.8, H + 1.3)], '#7d807b');
    // Four legs tapering to the head, with girts and cross braces.
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    ctx.strokeStyle = steel; ctx.lineCap = 'round';
    for (const [sx, sy] of legs) { const p0 = P(sx * b, sy * b, 0), p1 = P(sx * a, sy * a, H); ctx.lineWidth = Math.max(1.5, z * 0.12); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); }
    ctx.lineWidth = Math.max(1, z * 0.05);
    ctx.beginPath();
    const lv = [0, 2.5, 5, 7.5, H];
    const at = (k, sx, sy) => { const f = lv[k] / H, s = b + (a - b) * f; return P(sx * s, sy * s, lv[k]); };
    for (let k = 1; k < lv.length; k++) for (let e = 0; e < 4; e++) {
      const [x0, y0] = legs[e], [x1, y1] = legs[(e + 1) % 4], p = at(k, x0, y0), q = at(k, x1, y1), r = at(k - 1, x0, y0), s = at(k - 1, x1, y1);
      ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.moveTo(r[0], r[1]); ctx.lineTo(q[0], q[1]); ctx.moveTo(p[0], p[1]); ctx.lineTo(s[0], s[1]);
    }
    ctx.stroke();
    // The wheel: a ring of curved steel sails facing the camera, turning in the breeze.
    const R = 2.1 * z, spin = performance.now() / 1000 * 1.6;
    for (let k = 0; k < 18; k++) {
      const ang = spin + (k / 18) * Math.PI * 2, c = Math.cos(ang), s2 = Math.sin(ang);
      ctx.strokeStyle = k % 2 ? '#9a9d98' : '#7a7d78'; ctx.lineWidth = Math.max(1.5, z * 0.28);
      ctx.beginPath(); ctx.moveTo(hub[0] + c * R * 0.32, hub[1] + s2 * R * 0.32); ctx.lineTo(hub[0] + c * R, hub[1] + s2 * R); ctx.stroke();
    }
    ctx.strokeStyle = '#4c4f4c'; ctx.lineWidth = Math.max(1, z * 0.07);
    ctx.beginPath(); ctx.arc(hub[0], hub[1], R, 0, Math.PI * 2); ctx.moveTo(hub[0] + R * 0.32, hub[1]); ctx.arc(hub[0], hub[1], R * 0.32, 0, Math.PI * 2); ctx.stroke();
    this.blob(hub[0], hub[1], Math.max(2, z * 0.3), '#5d605d');
    // Galvanised stock tank.
    const [tx, ty] = P(3.2, 2.2, 0), [, tt] = P(3.2, 2.2, 0.9), rx = 1.7 * z * 1.41, ry = 1.7 * z * 0.71;
    ctx.fillStyle = '#8e918c'; ctx.beginPath(); ctx.ellipse(tx, ty, rx, ry, 0, 0, Math.PI); ctx.lineTo(tx - rx, tt); ctx.ellipse(tx, tt, rx, ry, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a9aca6'; ctx.beginPath(); ctx.ellipse(tx, tt, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4f7d8c'; ctx.beginPath(); ctx.ellipse(tx, tt + 1, rx * 0.88, ry * 0.85, 0, 0, Math.PI * 2); ctx.fill();
  }

  // A Stonehenge-like ring: sarsens capped with lintels round a horseshoe of tall trilithons (England).
  drawStones(t) {
    const ctx = this.ctx, z = this.cam.zoom, sd = Math.round(t.seed * 1000), R = t.r * 0.85;
    const stone = (x, y, h, w, col) => {
      const [bx, by] = this.cam.toScreen(x, y), [, ty] = this.cam.toScreen(x, y, h), pw = w * z;
      ctx.fillStyle = col; ctx.fillRect(bx - pw / 2, ty, pw, by - ty);
      ctx.fillStyle = 'rgba(40,38,32,0.28)'; ctx.fillRect(bx + pw * 0.15, ty, pw * 0.35, by - ty);
      ctx.fillStyle = 'rgba(255,255,240,0.18)'; ctx.fillRect(bx - pw / 2, ty, pw * 0.2, by - ty);
    };
    const lintel = (p, q, h) => this.poly([this.cam.toScreen(p.x, p.y, h), this.cam.toScreen(q.x, q.y, h), this.cam.toScreen(q.x, q.y, h + 0.7), this.cam.toScreen(p.x, p.y, h + 0.7)], '#a3a196');
    const items = [];
    // Outer circle: some stones have fallen, and only some lintels survive.
    const N = 16, ring = [];
    for (let k = 0; k < N; k++) {
      const ang = (k / N) * Math.PI * 2, x = t.x + Math.cos(ang) * R, y = t.y + Math.sin(ang) * R;
      ring.push(M.hash2(k, sd) < 0.2 ? null : { x, y });
    }
    for (let k = 0; k < N; k++) {
      const p = ring[k], q = ring[(k + 1) % N];
      if (p) items.push({ d: p.x + p.y, fn: () => stone(p.x, p.y, 3.4, 1.25, '#9c9a90') });
      if (p && q && M.hash2(sd, k) < 0.6) items.push({ d: (p.x + p.y + q.x + q.y) / 2 + 0.01, fn: () => lintel(p, q, 3.4) });
    }
    // Inner horseshoe of trilithons, open toward the north-east.
    for (const ang of [1.6, 2.5, 3.4, 4.3, 0.7]) {
      const c = { x: t.x + Math.cos(ang) * R * 0.5, y: t.y + Math.sin(ang) * R * 0.5 }, ux = -Math.sin(ang) * 0.6, uy = Math.cos(ang) * 0.6;
      const p = { x: c.x - ux, y: c.y - uy }, q = { x: c.x + ux, y: c.y + uy };
      items.push({ d: c.x + c.y, fn: () => { stone(p.x, p.y, 4.6, 1.3, '#8f8d84'); stone(q.x, q.y, 4.6, 1.3, '#8f8d84'); lintel(p, q, 4.6); } });
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.fn();
    // A fallen sarsen lying in the grass.
    const [fx, fy] = this.cam.toScreen(t.x + R + 1.5, t.y + 1.8, 0.3);
    ctx.fillStyle = '#9c9a90'; ctx.beginPath(); ctx.ellipse(fx, fy, 1.6 * z, 0.5 * z, 0.2, 0, Math.PI * 2); ctx.fill();
  }

  // Ruined Scottish tower house: harled stone, a corbelled round turret with a slate cone, and a broken curtain wall.
  drawCastle(t) {
    const ctx = this.ctx, z = this.cam.zoom, w = 2.6, d = 2.2, H = 11;
    const P = (dx, dy, h) => this.cam.toScreen(t.x + dx, t.y + dy, h);
    // Broken curtain wall running west from the tower.
    const wall = [3, 2.6, 3.2, 1.4, 0.8, 2.2, 1.6];
    const pts = [P(-w - 7, d - 0.6, 0)];
    wall.forEach((h, k) => { pts.push(P(-w - 7 + k * (7 / (wall.length - 1)), d - 0.6, h)); });
    pts.push(P(-w, d - 0.6, 0));
    this.poly(pts, '#7f7c73');
    // Tower: south face, east face, and the open roofless top.
    this.poly([P(-w, -d, H), P(w, -d, H), P(w, d, H), P(-w, d, H)], '#4a4740');
    this.poly([P(-w, d, 0), P(w, d, 0), P(w, d, H), P(-w, d, H)], '#8a877e');
    this.poly([P(w, d, 0), P(w, -d, 0), P(w, -d, H), P(w, d, H)], '#6f6c64');
    ctx.strokeStyle = 'rgba(50,46,40,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let h = 1.4; h < H; h += 1.4) { const a = P(-w, d, h), b = P(w, d, h), c = P(w, -d, h); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); }
    ctx.stroke();
    // Windows and a doorway.
    const hole = (fx, h0, h1, side) => {
      const ww = 0.25;
      const q = side ? [P(w, fx - ww, h0), P(w, fx + ww, h0), P(w, fx + ww, h1), P(w, fx - ww, h1)] : [P(fx - ww, d, h0), P(fx + ww, d, h0), P(fx + ww, d, h1), P(fx - ww, d, h1)];
      this.poly(q, '#24221e');
    };
    hole(-1.2, 0, 2.2, false);
    for (const [f, h] of [[0.9, 3.5], [-0.8, 6.2], [0.9, 8.2]]) hole(f, h, h + 1.1, false);
    for (const [f, h] of [[0.6, 4.5], [-0.8, 7.5]]) hole(f, h, h + 1, true);
    // Crenellated parapet on the two visible sides, partly fallen.
    for (let k = 0; k < 7; k++) if (M.hash2(k, 7) > 0.2) this.poly([P(-w + k * 0.8, d, H), P(-w + k * 0.8 + 0.45, d, H), P(-w + k * 0.8 + 0.45, d, H + 0.7), P(-w + k * 0.8, d, H + 0.7)], '#8a877e');
    for (let k = 0; k < 5; k++) if (M.hash2(3, k) > 0.35) this.poly([P(w, d - k * 0.9, H), P(w, d - k * 0.9 - 0.45, H), P(w, d - k * 0.9 - 0.45, H + 0.7), P(w, d - k * 0.9, H + 0.7)], '#6f6c64');
    // Round turret corbelled out from the south-east corner, with a conical slate roof.
    const [cx, cb] = P(w + 0.5, d + 0.5, H - 3.5), [, ct] = P(w + 0.5, d + 0.5, H + 1), [, cr] = P(w + 0.5, d + 0.5, H + 4.2), rr = 1.2 * z * 1.2;
    ctx.fillStyle = '#9a978d';
    ctx.beginPath(); ctx.moveTo(cx - rr, ct); ctx.lineTo(cx - rr, cb - rr * 0.2); ctx.quadraticCurveTo(cx, cb + rr * 1.4, cx + rr, cb - rr * 0.2); ctx.lineTo(cx + rr, ct); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(40,36,30,0.25)'; ctx.fillRect(cx + rr * 0.2, ct, rr * 0.8, cb - ct);
    ctx.fillStyle = '#24221e'; ctx.fillRect(cx - rr * 0.15, M.lerp(ct, cb, 0.35), rr * 0.3, (cb - ct) * 0.25);
    ctx.fillStyle = '#4d5359';
    ctx.beginPath(); ctx.moveTo(cx - rr * 1.15, ct + rr * 0.15); ctx.lineTo(cx, cr); ctx.lineTo(cx + rr * 1.15, ct + rr * 0.15); ctx.quadraticCurveTo(cx, ct + rr * 0.6, cx - rr * 1.15, ct + rr * 0.15); ctx.fill();
    ctx.fillStyle = 'rgba(200,210,220,0.18)';
    ctx.beginPath(); ctx.moveTo(cx - rr * 0.9, ct + rr * 0.2); ctx.lineTo(cx, cr); ctx.lineTo(cx - rr * 0.3, ct + rr * 0.4); ctx.fill();
  }

  // A tall white flagpole flying the Finnish flag, as at every summer cottage (Finland).
  drawFlagpole(t) {
    const ctx = this.ctx, z = this.cam.zoom, H = 11, now = performance.now() / 1000;
    this.postAt(t.x, t.y, H, 0.16, '#f2f0ea');
    const [px, py] = this.cam.toScreen(t.x, t.y, H - 0.2);
    this.blob(px, py - z * 0.2, Math.max(1.5, z * 0.2), '#d9b44a');
    // The flag ripples out to the side; (u, v) run along and down it.
    const L = 3.6 * z, Hf = 2.2 * z * 0.9;
    const F = (u, v) => [px + u * L * (1 - 0.06 * Math.sin(now * 3 + u * 4) ** 2), py + v * Hf + Math.sin(now * 4 - u * 6) * u * z * 0.35 + u * z * 0.25];
    const patch = (u0, u1, v0, v1, col) => {
      const pts = [];
      for (let k = 0; k <= 6; k++) pts.push(F(M.lerp(u0, u1, k / 6), v0));
      for (let k = 6; k >= 0; k--) pts.push(F(M.lerp(u0, u1, k / 6), v1));
      this.poly(pts, col);
    };
    patch(0, 1, 0, 1, '#f7f7f4');
    patch(0, 1, 4 / 11, 7 / 11, '#1f4fa0');
    patch(5 / 18, 8 / 18, 0, 1, '#1f4fa0');
    // A little shading in the folds.
    for (let k = 0; k < 4; k++) { const u = (k + 0.5) / 4; if (Math.sin(now * 4 - u * 6) > 0.3) patch(u - 0.06, u + 0.06, 0, 1, 'rgba(0,0,0,0.08)'); }
  }

  // St. Augustine-style lighthouse: a tapering tower in a black-and-white spiral, red lantern room on top (Florida).
  drawLighthouse(t) {
    const ctx = this.ctx, z = this.cam.zoom, H = 16, now = performance.now() / 1000;
    const [bx, by] = this.cam.toScreen(t.x, t.y, 1.2), [, ty] = this.cam.toScreen(t.x, t.y, H), rb = 1.6 * z * 1.2, rt = 1.05 * z * 1.2;
    // Brick footing.
    const [, fb] = this.cam.toScreen(t.x, t.y), rf = 2.3 * z * 1.2;
    ctx.fillStyle = '#a8503a'; ctx.beginPath(); ctx.ellipse(bx, fb, rf, rf * 0.5, 0, 0, Math.PI); ctx.lineTo(bx - rf, by); ctx.ellipse(bx, by, rf, rf * 0.5, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c0644c'; ctx.beginPath(); ctx.ellipse(bx, by, rf, rf * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    // Tower body with diagonal bands clipped to it.
    const tower = () => { ctx.beginPath(); ctx.moveTo(bx - rb, by); ctx.lineTo(bx - rt, ty); ctx.lineTo(bx + rt, ty); ctx.lineTo(bx + rb, by); ctx.quadraticCurveTo(bx, by + rb * 0.5, bx - rb, by); ctx.closePath(); };
    ctx.save();
    tower(); ctx.fillStyle = '#f3f0e8'; ctx.fill(); ctx.clip();
    const period = (by - ty) / 4.5, slant = rb * 0.9;
    ctx.fillStyle = '#1e1e1e';
    for (let y = by + period; y > ty - period * 2; y -= period) {
      ctx.beginPath(); ctx.moveTo(bx - rb, y); ctx.lineTo(bx + rb, y - slant); ctx.lineTo(bx + rb, y - slant - period * 0.5); ctx.lineTo(bx - rb, y - period * 0.5); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(bx + rb * 0.25, ty, rb, by - ty + rb);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(bx - rb, ty, rb * 0.35, by - ty + rb);
    ctx.restore();
    // Gallery, lantern room and cap.
    const [, gy] = this.cam.toScreen(t.x, t.y, H + 0.3), [, ly] = this.cam.toScreen(t.x, t.y, H + 2), [, cy] = this.cam.toScreen(t.x, t.y, H + 3.2), rg = rt * 1.35, rl = rt * 0.75;
    ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.ellipse(bx, gy, rg, rg * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,236,160,0.9)'; ctx.fillRect(bx - rl, ly, rl * 2, gy - ly);
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = Math.max(1, z * 0.08);
    ctx.beginPath(); for (const f of [-0.5, 0, 0.5]) { ctx.moveTo(bx + f * rl * 2, ly); ctx.lineTo(bx + f * rl * 2, gy); } ctx.stroke();
    ctx.fillStyle = '#b8322a'; ctx.beginPath(); ctx.moveTo(bx - rl * 1.2, ly); ctx.quadraticCurveTo(bx - rl * 0.6, cy, bx, cy); ctx.quadraticCurveTo(bx + rl * 0.6, cy, bx + rl * 1.2, ly); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = Math.max(1, z * 0.1);
    ctx.beginPath(); ctx.moveTo(bx, cy); ctx.lineTo(bx, cy - z * 0.6); ctx.stroke();
    // The light pulses as the lens turns.
    const glow = Math.max(0, Math.sin(now * 1.3)) ** 6;
    if (glow > 0.02) {
      const gr = ctx.createRadialGradient(bx, (ly + gy) / 2, 0, bx, (ly + gy) / 2, z * 4);
      gr.addColorStop(0, `rgba(255,240,180,${0.6 * glow})`); gr.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(bx, (ly + gy) / 2, z * 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Tyrolean chapel: whitewashed nave under a shingle roof, and a bell tower with a green copper onion dome (Austria).
  drawChapel(t) {
    const ctx = this.ctx, z = this.cam.zoom, w = 2.4, d = 1.8, Hw = 3.4, Hr = 5.6, o = 0.4;
    const P = (dx, dy, h) => this.cam.toScreen(t.x + dx, t.y + dy, h);
    const lime = '#efe9da', limeS = '#d6cfbd', shingle = '#5c4434';
    // Nave, west of the tower.
    this.poly([P(-w, d, 0), P(w, d, 0), P(w, d, Hw), P(-w, d, Hw)], lime);
    this.poly([P(w, d, 0), P(w, -d, 0), P(w, -d, Hw), P(w, 0, Hr), P(w, d, Hw)], limeS);
    this.poly([P(-w - o, d + o, Hw - 0.1), P(w + o, d + o, Hw - 0.1), P(w + o, 0, Hr), P(-w - o, 0, Hr)], shingle);
    this.rail(t.x - w - o, t.y, t.x + w, t.y, Hr, 0.1, '#3f2e22');
    // Tall arched windows along the nave.
    for (const f of [-0.6, 0]) {
      const [x0, y0] = P(w * f - 0.3, d, 1.2), [x1] = P(w * f + 0.3, d, 1.2), [, y1] = P(w * f, d, 2.7);
      ctx.fillStyle = '#3a4048'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.quadraticCurveTo((x0 + x1) / 2, y1 - z * 0.6, x1, y1); ctx.lineTo(x1, y0); ctx.closePath(); ctx.fill();
    }
    // Bell tower at the east end.
    const s = 1.2, tx = w + s, H = 9;
    const T = (dx, dy, h) => P(tx + dx, dy, h);
    this.poly([T(-s, s, 0), T(s, s, 0), T(s, s, H), T(-s, s, H)], lime);
    this.poly([T(s, s, 0), T(s, -s, 0), T(s, -s, H), T(s, s, H)], limeS);
    // Corner quoins painted in ochre, a clock face, and the belfry openings.
    for (const [x, y] of [[-s, s], [s, s], [s, -s]]) { const a = T(x, y, 0), b = T(x, y, H); this.solidLine(a, b, 0.18, '#d9b25e'); }
    const [kx, ky] = T(0, s, H - 3.2);
    this.blob(kx, ky, z * 0.55, '#2d3a4a'); this.blob(kx, ky, z * 0.42, '#f3efe4');
    ctx.strokeStyle = '#2d3a4a'; ctx.lineWidth = Math.max(1, z * 0.06);
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx, ky - z * 0.32); ctx.moveTo(kx, ky); ctx.lineTo(kx + z * 0.22, ky + z * 0.08); ctx.stroke();
    for (const [face, f] of [[0, 0], [1, 0]]) {
      const q = face ? [T(s, 0.35, H - 1.9), T(s, -0.35, H - 1.9), T(s, -0.35, H - 0.6), T(s, 0.35, H - 0.6)] : [T(-0.35, s, H - 1.9), T(0.35, s, H - 1.9), T(0.35, s, H - 0.6), T(-0.35, s, H - 0.6)];
      this.poly(q, '#2a241f');
    }
    // Onion dome: a swelling bulb, a narrow lantern, a small second bulb and a gilt cross.
    const [ox, oy] = T(0, 0, H), sw = s * z * 1.75, bh = 2.8 * z * 0.9;
    const bulb = (cx, base, rw, rh, col, hi) => {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(cx - rw * 0.75, base);
      ctx.bezierCurveTo(cx - rw * 1.35, base - rh * 0.35, cx - rw * 0.5, base - rh * 0.7, cx, base - rh);
      ctx.bezierCurveTo(cx + rw * 0.5, base - rh * 0.7, cx + rw * 1.35, base - rh * 0.35, cx + rw * 0.75, base);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = hi;
      ctx.beginPath(); ctx.ellipse(cx - rw * 0.35, base - rh * 0.4, rw * 0.2, rh * 0.2, -0.3, 0, Math.PI * 2); ctx.fill();
    };
    this.poly([T(-s - 0.15, s + 0.15, H), T(s + 0.15, s + 0.15, H), T(s + 0.15, -s - 0.15, H), T(s, -s, H + 0.4), T(-s, s, H + 0.4)], '#3f6f5a');
    bulb(ox, oy - z * 0.3, sw, bh, '#4f8a6e', 'rgba(200,240,220,0.35)');
    const ny = oy - z * 0.3 - bh;
    ctx.fillStyle = '#3f6f5a'; ctx.fillRect(ox - sw * 0.18, ny - z * 0.9, sw * 0.36, z * 0.95);
    bulb(ox, ny - z * 0.85, sw * 0.32, z * 0.8, '#4f8a6e', 'rgba(200,240,220,0.35)');
    const cyy = ny - z * 1.65;
    ctx.strokeStyle = '#d9b44a'; ctx.lineWidth = Math.max(1, z * 0.09);
    ctx.beginPath(); ctx.moveTo(ox, cyy); ctx.lineTo(ox, cyy - z * 1.1); ctx.moveTo(ox - z * 0.3, cyy - z * 0.75); ctx.lineTo(ox + z * 0.3, cyy - z * 0.75); ctx.stroke();
  }

  // Roman temple on a high podium: a columned portico under a pediment, a few columns long fallen (Italy).
  drawTemple(t) {
    const ctx = this.ctx, z = this.cam.zoom, w = 3.2, d = 4.6, Hp = 1.3, Hc = 6.2, He = 7, Hr = 8.6, sd = Math.round(t.seed * 100);
    const P = (dx, dy, h) => this.cam.toScreen(t.x + dx, t.y + dy, h);
    const marble = '#e8e2d4', shade = '#cbc3b0', dark = '#a59d8a';
    // Podium, with a flight of steps up the front.
    this.poly([P(-w - 0.3, d + 0.3, 0), P(w + 0.3, d + 0.3, 0), P(w + 0.3, d + 0.3, Hp), P(-w - 0.3, d + 0.3, Hp)], shade);
    this.poly([P(w + 0.3, d + 0.3, 0), P(w + 0.3, -d - 0.3, 0), P(w + 0.3, -d - 0.3, Hp), P(w + 0.3, d + 0.3, Hp)], dark);
    this.poly([P(-w - 0.3, -d - 0.3, Hp), P(w + 0.3, -d - 0.3, Hp), P(w + 0.3, d + 0.3, Hp), P(-w - 0.3, d + 0.3, Hp)], '#d8d1c0');
    for (let k = 0; k < 5; k++) {
      const y = d + 0.3 + (k + 1) * 0.45, h = Hp - (k + 1) * (Hp / 5);
      this.poly([P(-w + 0.6, y, 0), P(w - 0.6, y, 0), P(w - 0.6, y, h), P(-w + 0.6, y, h)], k % 2 ? marble : shade);
      this.poly([P(-w + 0.6, y - 0.45, h), P(w - 0.6, y - 0.45, h), P(w - 0.6, y, h), P(-w + 0.6, y, h)], '#f0ebe0');
    }
    // The cella: a solid stone hall behind the columns.
    const cw = w - 1, cd0 = -d + 0.6, cd1 = d - 2;
    this.poly([P(-cw, cd1, Hp), P(cw, cd1, Hp), P(cw, cd1, Hc), P(-cw, cd1, Hc)], '#d6cfbd');
    this.poly([P(cw, cd1, Hp), P(cw, cd0, Hp), P(cw, cd0, Hc), P(cw, cd1, Hc)], '#bdb5a1');
    this.poly([P(-cw * 0.35, cd1, Hp), P(cw * 0.35, cd1, Hp), P(cw * 0.35, cd1, Hc - 1.2), P(-cw * 0.35, cd1, Hc - 1.2)], '#4a4236');
    // Columns: down the east flank from the back, then across the front. A few are missing.
    const column = (x, y, k) => {
      if (M.hash2(k, sd) < 0.14) { const [bx, by] = P(x, y, Hp); ctx.fillStyle = shade; ctx.fillRect(bx - z * 0.32, by - z * 0.45, z * 0.64, z * 0.45); return; }
      const [bx, by] = P(x, y, Hp), [, ty] = P(x, y, Hc), cw2 = z * 0.3;
      ctx.fillStyle = marble; ctx.fillRect(bx - cw2, ty, cw2 * 2, by - ty);
      ctx.fillStyle = 'rgba(90,80,60,0.28)'; ctx.fillRect(bx + cw2 * 0.2, ty, cw2 * 0.8, by - ty);
      ctx.strokeStyle = 'rgba(120,110,90,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx - cw2 * 0.4, ty); ctx.lineTo(bx - cw2 * 0.4, by); ctx.stroke();
      ctx.fillStyle = '#f2ede2'; ctx.fillRect(bx - cw2 * 1.35, ty - z * 0.1, cw2 * 2.7, z * 0.35);
      ctx.fillStyle = shade; ctx.fillRect(bx - cw2 * 1.25, by - z * 0.2, cw2 * 2.5, z * 0.2);
    };
    const nf = 7;
    for (let k = 0; k < nf; k++) column(w, -d + 0.3 + k * ((2 * d - 0.6) / (nf - 1)), k + 10);
    for (let k = 0; k < 6; k++) column(-w + 0.3 + k * ((2 * w - 0.6) / 5), d, k);
    // Entablature on the two visible sides.
    this.poly([P(-w, d, Hc), P(w, d, Hc), P(w, d, He), P(-w, d, He)], '#ddd6c5');
    this.poly([P(w, d, Hc), P(w, -d, Hc), P(w, -d, He), P(w, d, He)], '#bdb5a1');
    this.rail(t.x - w, t.y + d, t.x + w, t.y + d, Hc + 0.35, 0.05, 'rgba(120,110,90,0.5)');
    // Terracotta roof, ridge running front to back, and the pediment facing the field.
    this.poly([P(w + 0.25, d + 0.2, He), P(w + 0.25, -d - 0.2, He), P(0, -d - 0.2, Hr), P(0, d + 0.2, Hr)], '#b3654a');
    for (let k = 1; k < 8; k++) { const f = k / 8; this.solidLine(P(w * f, d + 0.2, Hr - (Hr - He) * f), P(w * f, -d - 0.2, Hr - (Hr - He) * f), 0.03, 'rgba(110,50,30,0.6)'); }
    this.poly([P(-w - 0.25, d + 0.2, He), P(w + 0.25, d + 0.2, He), P(0, d + 0.2, Hr)], '#ece6d8');
    this.poly([P(-w + 0.5, d + 0.2, He + 0.25), P(w - 0.5, d + 0.2, He + 0.25), P(0, d + 0.2, Hr - 0.35)], '#d3cbb8');
    this.solidLine(P(-w - 0.25, d + 0.2, He), P(0, d + 0.2, Hr), 0.12, '#f2ede2');
    this.solidLine(P(0, d + 0.2, Hr), P(w + 0.25, d + 0.2, He), 0.12, '#f2ede2');
  }

  // Screen-space weather drawn over the field.
  drawWeather(kind, dt) {
    const ctx = this.ctx, cam = this.cam;
    if (kind === 'snow') {
      const want = Math.round(cam.w * cam.h / 9000);
      while (this.flakes.length < want) this.flakes.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, v: M.rand(25, 70), r: M.rand(1, 2.6), p: Math.random() * 6 });
      if (this.flakes.length > want) this.flakes.length = want;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const f of this.flakes) {
        f.y += f.v * dt; f.p += dt; f.x += Math.sin(f.p) * 12 * dt + 8 * dt;
        if (f.y > cam.h + 4) { f.y = -4; f.x = Math.random() * cam.w; }
        if (f.x > cam.w + 4) f.x = -4;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
    } else if (kind === 'mist') {
      while (this.mist.length < 7) this.mist.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, r: M.rand(0.25, 0.5), v: M.rand(6, 16) });
      // Banks of mist roll along with the wind when there is one.
      const [wx, wy] = this.wind ? M.norm(...this.off(this.wind.x, this.wind.y)) : [1, 0];
      const ws = this.wind ? 0.6 + this.wind.speed * 0.25 : 1;
      for (const m of this.mist) {
        m.x += wx * m.v * ws * dt; m.y += wy * m.v * ws * dt;
        const R = m.r * Math.max(cam.w, cam.h);
        if (m.x - R > cam.w || m.x + R < 0 || m.y - R > cam.h || m.y + R < 0) {
          // Re-enter on the upwind side.
          if (Math.abs(wx) > Math.abs(wy)) { m.x = wx > 0 ? -R : cam.w + R; m.y = Math.random() * cam.h; }
          else { m.y = wy > 0 ? -R : cam.h + R; m.x = Math.random() * cam.w; }
        }
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, R);
        g.addColorStop(0, 'rgba(225,230,232,0.08)'); g.addColorStop(1, 'rgba(225,230,232,0)');
        ctx.fillStyle = g; ctx.fillRect(m.x - R, m.y - R, R * 2, R * 2);
      }
    } else if (kind === 'petals') {
      // Cherry petals fluttering down on a light breeze, turning as they fall.
      const want = Math.round(cam.w * cam.h / 22000);
      while (this.petals.length < want) this.petals.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, v: M.rand(18, 40), r: M.rand(2, 3.6), p: Math.random() * 6, s: M.rand(1.5, 3.5) });
      if (this.petals.length > want) this.petals.length = want;
      for (const f of this.petals) {
        f.y += f.v * dt; f.p += dt * f.s; f.x += Math.sin(f.p * 0.7) * 22 * dt + 14 * dt;
        if (f.y > cam.h + 6) { f.y = -6; f.x = Math.random() * cam.w; }
        if (f.x > cam.w + 6) f.x = -6;
        const turn = Math.cos(f.p);
        ctx.fillStyle = turn > 0 ? 'rgba(250,214,226,0.9)' : 'rgba(236,170,194,0.9)';
        ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r, Math.max(0.4, f.r * 0.55 * Math.abs(turn)), f.p * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    } else if (kind === 'rain') {
      // Light drizzle: a grey cast over the field, thin slanting streaks and little rings where they land.
      ctx.fillStyle = 'rgba(70,85,100,0.13)'; ctx.fillRect(0, 0, cam.w, cam.h);
      const want = Math.round(cam.w * cam.h / 7000);
      const drop = (top) => ({ x: Math.random() * (cam.w + 80) - 40, y: top ? -M.rand(0, 40) : Math.random() * cam.h, v: M.rand(520, 700), len: M.rand(9, 16), land: M.rand(0.15, 1.05) * cam.h });
      while (this.drops.length < want) this.drops.push(drop(false));
      if (this.drops.length > want) this.drops.length = want;
      const slant = 0.18;
      ctx.strokeStyle = 'rgba(205,218,230,0.38)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        d.y += d.v * dt; d.x += d.v * slant * dt;
        if (d.y > d.land) {
          if (this.splashes.length < 120) this.splashes.push({ x: d.x, y: d.land, t: 0 });
          this.drops[i] = drop(true);
          continue;
        }
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * slant, d.y - d.len);
      }
      ctx.stroke();
      for (let i = this.splashes.length - 1; i >= 0; i--) {
        const sp = this.splashes[i];
        sp.t += dt;
        if (sp.t > 0.35) { this.splashes.splice(i, 1); continue; }
        const k = sp.t / 0.35, r = 1 + k * 4.5;
        ctx.strokeStyle = `rgba(215,228,238,${0.45 * (1 - k)})`;
        ctx.beginPath(); ctx.ellipse(sp.x, sp.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (kind === 'haze') {
      const g = ctx.createLinearGradient(0, 0, 0, cam.h);
      g.addColorStop(0, 'rgba(255,225,170,0.22)'); g.addColorStop(0.6, 'rgba(255,225,170,0.05)'); g.addColorStop(1, 'rgba(255,225,170,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, cam.w, cam.h);
    }
  }

  // Wisps of blown air streaking across the screen downwind: more, longer and faster in the gusts.
  drawWind(wind, dt) {
    const ctx = this.ctx, cam = this.cam;
    const [vx, vy] = this.off(wind.x, wind.y);                 // screen px/s at this zoom
    const sp = Math.hypot(vx, vy), [ux, uy] = sp > 1e-6 ? [vx / sp, vy / sp] : [1, 0];
    const want = Math.round(cam.w * cam.h / 26000 * (0.3 + wind.strength));
    while (this.streaks.length < want) {
      this.streaks.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, age: 0, life: M.rand(0.8, 1.8), len: M.rand(0.5, 1), wob: Math.random() * 6, v: M.rand(0.8, 1.3) });
    }
    ctx.lineCap = 'round';
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.age += dt;
      s.x += vx * s.v * dt; s.y += vy * s.v * dt;
      if (s.age > s.life) {
        if (this.streaks.length > want) { this.streaks.splice(i, 1); continue; }
        Object.assign(s, { x: Math.random() * cam.w, y: Math.random() * cam.h, age: 0, life: M.rand(0.8, 1.8) });
      }
      const f = s.age / s.life, a = Math.sin(f * Math.PI) * (0.1 + wind.strength * 0.22);
      const L = (30 + sp * 0.35) * s.len, bend = Math.sin(s.wob + s.age * 3) * L * 0.12;
      const nx = -uy, ny = ux;
      ctx.strokeStyle = `rgba(235,240,240,${a.toFixed(3)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.x - ux * L, s.y - uy * L);
      ctx.quadraticCurveTo(s.x - ux * L * 0.5 + nx * bend, s.y - uy * L * 0.5 + ny * bend, s.x, s.y);
      ctx.stroke();
    }
  }

  // Screen-pixel lean of a tree crown in the wind, rocking with the gusts.
  sway(t, height) {
    if (!this.wind) return [0, 0];
    const w = this.wind, k = 0.012 * height * (0.75 + 0.25 * Math.sin(w.t * 2.3 + t.seed * 20));
    return this.off(w.x * k, w.y * k);
  }

  // Project a world-space offset (relative to an entity) to screen pixels.
  off(ox, oy) { const z = this.cam.zoom; return [(ox - oy) * z, (ox + oy) * z * 0.5]; }

  drawSheep(s) {
    const ctx = this.ctx, z = this.cam.zoom;
    const [sx, sy] = this.cam.toScreen(s.x, s.y);
    if (!this.onScreen(sx, sy)) return;
    const hx = Math.cos(s.heading), hy = Math.sin(s.heading);
    const [ex, ey] = this.off(hx, hy);
    const ang = Math.atan2(ey, ex), fore = Math.hypot(ex, ey) / z;
    const moving = Math.hypot(s.vx, s.vy) > 0.3;
    const bodyY = sy - 0.5 * z;

    // Legs.
    ctx.strokeStyle = '#2d2724'; ctx.lineWidth = Math.max(1, z * 0.07); ctx.lineCap = 'round';
    ctx.beginPath();
    const legs = [[0.32, 0.18], [0.32, -0.18], [-0.32, 0.18], [-0.32, -0.18]];
    legs.forEach(([lx, ly], i) => {
      const wx = lx * hx - ly * hy, wy = lx * hy + ly * hx;
      const [ox, oy] = this.off(wx, wy);
      const swing = moving ? Math.sin(s.stepPhase * 2.4 + i * Math.PI) * 0.14 * z : 0;
      ctx.moveTo(sx + ox, bodyY + oy + z * 0.1); ctx.lineTo(sx + ox + swing * Math.cos(ang), sy + oy);
    });
    ctx.stroke();

    // Body.
    ctx.save(); ctx.translate(sx, bodyY); ctx.rotate(ang);
    ctx.fillStyle = s.fleece; ctx.strokeStyle = '#b5a888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, 0.62 * z * fore, 0.36 * z, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.ellipse(-0.05 * z, -0.1 * z, 0.4 * z * fore, 0.16 * z, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Head (black-faced).
    const [hdx, hdy] = this.off(hx * 0.68, hy * 0.68);
    const hX = sx + hdx, hY = bodyY + hdy - 0.05 * z;
    ctx.fillStyle = '#2b2522';
    ctx.beginPath(); ctx.ellipse(hX, hY, 0.21 * z, 0.19 * z, ang, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hX - Math.sin(ang) * 0.2 * z, hY - 0.08 * z, 0.09 * z, 0.05 * z, ang, 0, Math.PI * 2);
    ctx.ellipse(hX + Math.sin(ang) * 0.2 * z, hY - 0.08 * z, 0.09 * z, 0.05 * z, ang, 0, Math.PI * 2); ctx.fill();
    if (s.state === 'ALERT' || s.state === 'FLEE') {
      ctx.fillStyle = s.panic > 0.3 ? '#ff6b4a' : '#f2c14e';
      ctx.beginPath(); ctx.arc(sx, bodyY - 0.9 * z, Math.max(1.5, z * 0.08), 0, Math.PI * 2); ctx.fill();
    }
  }

  // Border collie skeleton in the dog's own frame: [forward, side, height] in metres.
  // Returns keypoints blended between standing/running, stalking and lying poses.
  dogPose(d) {
    const L = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    const run = d.gait, lie = d.lie, cr = d.crouch * (1 - lie);
    const gal = M.clamp((run - 0.5) / 0.3, 0, 1);              // trot -> gallop
    const amp = M.clamp(Math.hypot(d.vx, d.vy) / 1.2, 0, 1);    // legs still when standing
    const p = d.stride;
    const bob = amp * (0.015 + 0.025 * gal) * Math.sin(2 * p);
    const flex = amp * gal * 0.045 * Math.sin(p);
    const low = 0.15 * cr;

    const k = {};
    k.hip = [-0.28 + flex, 0, 0.45 + bob - low * 0.5];
    k.chest = [0.22 - flex, 0, 0.44 + bob - low];
    // Head carriage: up and alert standing, low and reaching when running, dropped below the back when stalking.
    const hr = run * 0.8 * (1 - cr);
    k.neck = L(L([0.36, 0, 0.58], [0.42, 0, 0.5], hr), [0.42, 0, 0.36], cr);
    k.head = L(L([0.48, 0, 0.68], [0.58, 0, 0.52], hr), [0.56, 0, 0.36], cr);
    k.nose = L(L([0.67, 0, 0.62], [0.77, 0, 0.47], hr), [0.75, 0, 0.3], cr);
    const sway = amp * 0.08 * Math.sin(p * 0.5);
    k.tail = [[-0.42 + flex, 0, 0.46 + bob - low * 0.5], L([-0.6, 0, 0.3], [-0.68, sway, 0.36], run), L([-0.72, 0, 0.2], [-0.88, sway * 1.6, 0.3], run)];
    k.tail[1][2] -= low; k.tail[2][2] -= low;

    // Legs: trot pairs diagonals, gallop pairs fronts and hinds a beat apart.
    const offs = { FL: 0, FR: Math.PI - (Math.PI - 0.5) * gal, HL: Math.PI, HR: Math.PI * (1 - gal) + (Math.PI + 0.5) * gal };
    const stride = (0.1 + 0.14 * run) * amp, lift = (0.05 + 0.07 * run) * amp;
    k.legs = [];
    for (const [id, f0, side] of [['FL', 0.22, 1], ['FR', 0.22, -1], ['HL', -0.28, 1], ['HR', -0.28, -1]]) {
      const ph = p + offs[id], fore = id[0] === 'F';
      const ff = f0 + Math.sin(ph) * stride * (fore ? 1 : 0.9), fh = Math.max(0, Math.cos(ph)) * lift, s = side * 0.09;
      const top = fore ? [k.chest[0] - 0.01, s, k.chest[2] - 0.06] : [k.hip[0], s, k.hip[2] - 0.04];
      let pts = fore
        ? [top, [L(top, [ff, s, fh], 0.5)[0] - 0.03 - fh * 0.6, s, top[2] * 0.48 + fh], [ff, s, fh]]
        : [top, [top[0] + 0.07 + (ff - f0) * 0.4, s, top[2] - 0.17], [ff - 0.07 - fh * 0.3, s, 0.13 + fh], [ff, s, fh]];
      // Lying: forelegs stretched out in front, hind legs tucked under the flank.
      const lp = fore
        ? [[0.24, s, 0.14], [0.4, s, 0.05], [0.58, s * 0.9, 0.02]]
        : [[-0.3, s * 1.2, 0.2], [-0.12, s * 1.6, 0.13], [-0.36, s * 1.5, 0.05], [-0.17, s * 1.4, 0.02]];
      pts = pts.map((q, i) => L(q, lp[i], lie));
      k.legs.push({ pts, side, fore });
    }

    if (lie > 0) {
      const lp = {
        hip: [-0.3, 0, 0.2], chest: [0.24, 0, 0.21], neck: [0.37, 0, 0.36], head: [0.48, 0, 0.47], nose: [0.67, 0, 0.42],
      };
      for (const n in lp) k[n] = L(k[n], lp[n], lie);
      const lt = [[-0.43, 0, 0.2], [-0.62, 0.06, 0.05], [-0.78, 0.18, 0.03]];
      k.tail = k.tail.map((q, i) => L(q, lt[i], lie));
    }
    return k;
  }

  drawDog(d) {
    const ctx = this.ctx, z = this.cam.zoom, S = 1.1;
    const [sx, sy] = this.cam.toScreen(d.x, d.y);
    if (!this.onScreen(sx, sy)) return;
    const hx = Math.cos(d.heading), hy = Math.sin(d.heading);
    const k = this.dogPose(d);

    // Project a local [f, s, h] point; depth runs along the view ray (x + y + 1.11h).
    const P = ([f, s, h]) => {
      const wx = (f * hx - s * hy) * S, wy = (f * hy + s * hx) * S, wh = h * S;
      return { x: sx + (wx - wy) * z, y: sy + (wx + wy) * z * 0.5 - wh * z * 0.9, d: wx + wy + 1.11 * wh };
    };
    const add = (a, b) => a.map((v, i) => v + b[i]);
    const BLACK = '#1d1918', FAR = '#131010', SHINE = '#2f2928', WHITE = '#f2efe8', WHITE_FAR = '#cfc9bc';
    // How much the dog's +side faces the camera (the camera looks down the -x,-y diagonal), -1..1.
    const facing = (hx - hy) * Math.SQRT1_2;
    const fine = z >= 14;

    const prims = [];
    const push = (pr) => (prims.push(pr), pr);
    const ball = (q, r, color, bias = 0) => { const a = P(q); return push({ d: a.d + bias, fn: () => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(0.8, r * S * z), 0, Math.PI * 2); ctx.fill(); } }); };
    const line = (pts, w, color, bias = 0) => {
      const a = pts.map(P);
      return push({ d: a.reduce((s, q) => s + q.d, 0) / a.length + bias, fn: () => {
        ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, w * S * z); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); a.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
      } });
    };
    const poly = (pts, color, bias = 0) => {
      const a = pts.map(P);
      return push({ d: a.reduce((s, q) => s + q.d, 0) / a.length + bias, fn: () => {
        ctx.fillStyle = color; ctx.beginPath(); a.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill();
      } });
    };
    // Draw a marking straight after the part it belongs to, so the two always sort together.
    const attach = (part, mark) => {
      prims.splice(prims.indexOf(mark), 1);
      const fn = part.fn; part.fn = () => { fn(); mark.fn(); };
      return part;
    };

    // Legs: dark upper, thinner lower, white socks.
    for (const lg of k.legs) {
      // Bias keeps near legs over the body and far legs under it, fading out when seen head-on.
      const near = lg.side * facing, far = near < -0.3, col = far ? FAR : BLACK, n = lg.pts.length, b = near * 0.25;
      line(lg.pts.slice(0, 2), 0.1, col, b);
      line(lg.pts.slice(1), 0.06, col, b);
      line([lg.pts[n - 1], add(lg.pts[n - 1], [0, 0, 0.07])], 0.05, far ? WHITE_FAR : WHITE, b + 0.01);
    }

    // Body: a capsule from hips to chest, a deeper chest, a shine along the back.
    const back = (q) => add(q, [0, 0, 0.11]);
    line([k.hip, k.chest], 0.34, BLACK);
    ball(add(k.hip, [-0.02, 0, 0.01]), 0.17, BLACK);
    const chest = ball(add(k.chest, [0.02, 0, -0.04]), 0.19, BLACK);
    line([back(k.hip), back(add(k.chest, [-0.06, 0, 0]))], 0.1, SHINE, 0.02);
    // White bib and full collar.
    line([add(k.chest, [0.1, 0, -0.06]), add(k.chest, [0.12, 0, 0.06])], 0.17, WHITE, 0.01);
    // The collar wraps the neck, so it shows over the shoulders from behind as well as from the front.
    const collar = attach(line([k.chest, k.neck], 0.2, BLACK), ball(k.neck, 0.125, WHITE));
    collar.d = Math.max(collar.d, P(k.neck).d, chest.d + 0.01);

    // Tail with the white tip.
    attach(line(k.tail, 0.085, BLACK), ball(k.tail[2], 0.05, WHITE));

    // Head: skull, white muzzle and blaze, black nose, semi-pricked ears.
    const [hf, , hh] = k.head;
    const dir = M.norm(k.nose[0] - hf, k.nose[2] - hh);
    const skull = ball(k.head, 0.12, BLACK);
    skull.d = Math.max(skull.d, collar.d + 0.005);
    line([add(k.head, [dir[0] * 0.07, 0, dir[1] * 0.07 - 0.015]), add(k.nose, [-dir[0] * 0.02, 0, -0.01])], 0.09, WHITE, 0.02);
    ball(k.nose, 0.035, '#0e0c0c', 0.03);
    if (fine) line([add(k.head, [0.0, 0, 0.11]), add(k.head, [0.09, 0, 0.05])], 0.035, WHITE, 0.03);
    for (const s of [1, -1]) {
      const base = [hf - 0.03, s * 0.05, hh + 0.08];
      poly([base, [hf - 0.07, s * 0.11, hh + 0.04], [hf - 0.05, s * 0.11, hh + 0.17]], s * facing < -0.3 ? FAR : BLACK, 0.01);
    }

    prims.sort((a, b) => a.d - b.d);
    for (const pr of prims) pr.fn();
  }

  drawHandler(h, game) {
    const ctx = this.ctx, z = this.cam.zoom;
    const [sx, sy] = this.cam.toScreen(h.x, h.y);
    if (!this.onScreen(sx, sy)) return;
    const legH = 0.8 * z, bodyH = 0.75 * z, w = 0.42 * z;
    const swing = h.moving ? Math.sin(h.stepPhase * 3) * 0.12 * z : 0;
    ctx.strokeStyle = '#3b3a44'; ctx.lineWidth = Math.max(2, z * 0.12); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx - w * 0.25, sy - legH); ctx.lineTo(sx - w * 0.25 + swing, sy);
    ctx.moveTo(sx + w * 0.25, sy - legH); ctx.lineTo(sx + w * 0.25 - swing, sy); ctx.stroke();
    ctx.fillStyle = '#5f7a3a';
    ctx.beginPath(); ctx.roundRect(sx - w / 2, sy - legH - bodyH, w, bodyH + 0.05 * z, z * 0.1); ctx.fill();
    ctx.fillStyle = '#e8bf9a';
    ctx.beginPath(); ctx.arc(sx, sy - legH - bodyH - 0.2 * z, 0.2 * z, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a3b2b';
    ctx.beginPath(); ctx.ellipse(sx, sy - legH - bodyH - 0.34 * z, 0.3 * z, 0.09 * z, 0, 0, Math.PI * 2); ctx.fill();
    // Crook.
    const cx = sx + w * 0.75, top = sy - legH - bodyH - 0.5 * z;
    ctx.strokeStyle = '#8a6a3c'; ctx.lineWidth = Math.max(1.5, z * 0.06);
    ctx.beginPath(); ctx.moveTo(cx, sy); ctx.lineTo(cx, top); ctx.arc(cx - 0.12 * z, top, 0.12 * z, 0, Math.PI, true); ctx.stroke();
    // Rope to the pen gate when standing at the pen.
    const pen = game.course.pen;
    if (h.holdingGate && !h.moving) {
      const g = pen.gateSeg();
      const [gx, gy] = this.cam.toScreen(g.bx, g.by, 0.9);
      ctx.strokeStyle = '#e9ddb8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx - w * 0.5, sy - legH - bodyH * 0.6); ctx.lineTo(gx, gy); ctx.stroke();
    }
  }
}

const WHISTLE_LABEL = { COMEBYE: 'Come bye', AWAY: 'Away', WALK: 'Walk up', STOP: 'Lie down', OUT: 'Get out', HOME: "That'll do" };
