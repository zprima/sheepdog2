'use strict';
// Keyboard + wheel + touch input. Arrow keys (or the touch stick) steer in screen directions, letters issue commands.
const KEY_CMDS = {
  KeyC: 'COMEBYE', KeyA: 'AWAY', KeyW: 'WALK', Space: 'STOP', KeyL: 'STOP',
  KeyS: 'STEADY', KeyB: 'OUT', KeyT: 'HOME', KeyR: 'RESTART', Escape: 'MENU',
};
// Screen direction -> world direction for the isometric view.
const ARROW_DIRS = {
  ArrowUp: [-1, -1], ArrowDown: [1, 1], ArrowLeft: [-1, 1], ArrowRight: [1, -1],
};
const STICK_RADIUS = 50, STICK_DEAD = 12;

class Input {
  constructor(game) {
    this.game = game;
    this.held = new Set();
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.held.clear(); this.endStick(); });
    window.addEventListener('wheel', (e) => { if (!game.paused) game.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: true });
    this.initTouch(game.renderer.canvas);
  }

  // Touch on the field: one finger is a floating stick that steers the dog, two fingers pinch to zoom.
  initTouch(canvas) {
    this.touches = new Map();
    this.stick = null;
    this.pinch = null;
    this.stickEl = document.getElementById('stick');
    this.knobEl = this.stickEl.firstElementChild;
    // Stop iOS Safari zooming the page on a pinch.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.game.paused) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 1) {
        this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
        this.stickEl.style.left = e.clientX + 'px'; this.stickEl.style.top = e.clientY + 'px';
        this.knobEl.style.transform = '';
        this.stickEl.classList.remove('hidden');
      } else if (this.touches.size === 2) {
        this.endStick();
        this.pinch = { d: this.touchSpread() };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX; t.y = e.clientY;
      if (this.pinch && this.touches.size >= 2) {
        const d = this.touchSpread();
        if (d > 0 && this.pinch.d > 0) this.game.zoomBy(d / this.pinch.d);
        this.pinch.d = d;
      } else if (this.stick && this.stick.id === e.pointerId) {
        let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
        const l = Math.hypot(dx, dy);
        // Drag past the rim and the stick follows the finger.
        if (l > STICK_RADIUS) {
          this.stick.ox += dx / l * (l - STICK_RADIUS); this.stick.oy += dy / l * (l - STICK_RADIUS);
          dx = dx / l * STICK_RADIUS; dy = dy / l * STICK_RADIUS;
          this.stickEl.style.left = this.stick.ox + 'px'; this.stickEl.style.top = this.stick.oy + 'px';
        }
        this.stick.dx = dx; this.stick.dy = dy;
        this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      }
    });
    const up = (e) => {
      if (!this.touches.delete(e.pointerId)) return;
      if (this.stick && this.stick.id === e.pointerId) this.endStick();
      if (this.touches.size < 2) this.pinch = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  touchSpread() {
    const [a, b] = [...this.touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  endStick() {
    this.stick = null;
    if (this.stickEl) this.stickEl.classList.add('hidden');
  }

  onKey(e, down) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (ARROW_DIRS[e.code]) {
      e.preventDefault();
      if (down) this.held.add(e.code); else this.held.delete(e.code);
      return;
    }
    if (!down) return;
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { this.game.zoomBy(1.15); return; }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') { this.game.zoomBy(1 / 1.15); return; }
    if (e.code === 'KeyM') { this.game.ui.toggleMute(); return; }
    const cmd = KEY_CMDS[e.code];
    if (cmd) { e.preventDefault(); this.game.command(cmd); }
  }

  // Combined world-space steering direction, or null when no arrow is held and the stick is centred.
  arrowDir() {
    const s = this.stick;
    if (s && Math.hypot(s.dx, s.dy) > STICK_DEAD) {
      // Screen right is world (1,-1), screen down is world (1,1).
      return M.norm(s.dx + s.dy, s.dy - s.dx);
    }
    let x = 0, y = 0;
    for (const k of this.held) { const d = ARROW_DIRS[k]; x += d[0]; y += d[1]; }
    if (!x && !y) return null;
    return M.norm(x, y);
  }
}
