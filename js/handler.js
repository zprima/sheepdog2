'use strict';
// The handler stands at the post and walks to the pen gate for the pen.
class Handler {
  constructor(x, y) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.tx = x; this.ty = y;
    this.heading = -Math.PI / 2;
    this.stepPhase = 0;
    this.holdingGate = false;
  }
  goTo(x, y) { this.tx = x; this.ty = y; }
  update(dt, lookAt) {
    const dx = this.tx - this.x, dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.2) {
      const spd = Math.min(1.9, d * 2);
      this.vx = dx / d * spd; this.vy = dy / d * spd;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.heading = Math.atan2(dy, dx);
      this.stepPhase += spd * dt;
    } else {
      this.vx = this.vy = 0;
      if (lookAt) this.heading = M.angleLerp(this.heading, Math.atan2(lookAt.y - this.y, lookAt.x - this.x), Math.min(1, dt * 2));
    }
  }
  get moving() { return Math.hypot(this.vx, this.vy) > 0.1; }
}
