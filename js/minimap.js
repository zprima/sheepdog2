'use strict';
// Top-down minimap of the whole field in the bottom-right corner.
class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 210;
    // Phones get a small one tucked beside the zoom buttons.
    this.small = window.matchMedia('(max-width: 720px), (max-height: 500px)');
  }
  draw(game) {
    const map = game.course && game.course.map;
    if (!map) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = this.small.matches ? 96 : 210;
    const scale = this.size / Math.max(map.width, map.height);
    const w = Math.round(map.width * scale), h = Math.round(map.height * scale);
    if (this.canvas.width !== w * dpr) { this.canvas.width = w * dpr; this.canvas.height = h * dpr; this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; }
    const ctx = this.ctx;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    const c = game.course;
    drawFieldPlan(ctx, c, game.mode !== 'pen');

    // Camera view (a rhombus in top-down space).
    const cam = game.renderer.cam;
    const corners = [cam.toWorld(0, 0), cam.toWorld(cam.w, 0), cam.toWorld(cam.w, cam.h), cam.toWorld(0, cam.h)];
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();

    // Entities.
    for (const s of game.sheep) {
      ctx.fillStyle = s.panic > 0.3 ? '#ffb199' : '#ffffff';
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#4ea0ff'; ctx.beginPath(); ctx.arc(game.handler.x, game.handler.y, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(game.dog.x, game.dog.y, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.stroke();
    if (c.wind) this.drawWind(c.wind, dpr);
  }

  // Wind gauge in the top-left corner: an arrow pointing downwind, longer in the gusts, and the speed.
  drawWind(wind, dpr) {
    const ctx = this.ctx, x = 17, y = 17;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
    ctx.translate(x, y); ctx.rotate(wind.angle);
    const L = 5 + wind.strength * 5;
    ctx.strokeStyle = ctx.fillStyle = '#f2f4f0'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L - 2, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L + 1, 0); ctx.lineTo(L - 4, -3.5); ctx.lineTo(L - 4, 3.5); ctx.closePath(); ctx.fill();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 10px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const label = `${Math.round(wind.speed)} m/s`;
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + 15, y - 7, ctx.measureText(label).width + 8, 14);
    ctx.fillStyle = '#f2f4f0'; ctx.fillText(label, x + 19, y);
  }
}

// The field from above: ground, fence, trees and buildings, the course gates, pen and post, and optionally the
// course line. Drawn in world units, so the caller sets the transform. Shared by the minimap and the field cards.
function drawFieldPlan(ctx, c, lines = true) {
  const map = c.map, b = c.bounds;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c.ground.fieldCanvas(), 0, 0, map.width, map.height);
  ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 1.5;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  for (const t of c.props) {
    if (t.x < 0 || t.y < 0 || t.x > map.width || t.y > map.height) continue;
    ctx.fillStyle = PROP_KINDS[t.kind || 'oak'].mini;
    if (t.kind === 'hayrack') ctx.fillRect(t.x - t.len / 2, t.y - 1, t.len, 2);
    else { ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill(); }
  }
  // Course lines.
  if (lines) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c.start.x, c.start.y); ctx.lineTo(c.post.x, c.post.y);
    ctx.lineTo(c.driveGates[0].x, c.driveGates[0].y); ctx.lineTo(c.driveGates[1].x, c.driveGates[1].y); ctx.lineTo(c.pen.mouth.x, c.pen.mouth.y);
    ctx.stroke(); ctx.setLineDash([]);
  }
  // Gates.
  ctx.strokeStyle = '#f2e6b8'; ctx.lineWidth = 2;
  for (const g of [c.fetchGate, ...c.driveGates]) for (const s of g.hurdles) { ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke(); }
  // Pen.
  for (const s of [...c.pen.walls, c.pen.gateSeg()]) { ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke(); }
  // Post.
  ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.arc(c.post.x, c.post.y, 2, 0, Math.PI * 2); ctx.fill();
}
