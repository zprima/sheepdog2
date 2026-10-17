'use strict';
// The dog: moved by direct steering (arrow keys) or by shepherd's commands that work relative to the flock.
const DOG_CFG = { run: 9.5, flank: 8.0, walk: 4.2, steadyMul: 0.5, radius: 0.5, flankMin: 9, flankMax: 30 };

class Dog {
  constructor(x, y) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.heading = -Math.PI / 2;
    this.command = 'STOP';
    this.steady = false;
    this.dirX = 0; this.dirY = 0;
    this.flankR = 14;
    this.stepPhase = 0;
    this.restT = 0;
    // Smoothed 0..1 posture blends for the renderer.
    this.lie = 0; this.crouch = 0; this.gait = 0;
    this.stride = 0; // gait cycle phase in radians
  }

  setCommand(cmd, flock) {
    if (cmd === 'STEADY') { this.steady = !this.steady; return; }
    if ((cmd === 'COMEBYE' || cmd === 'AWAY') && flock && flock.n) {
      this.flankR = M.clamp(Math.hypot(this.x - flock.x, this.y - flock.y), DOG_CFG.flankMin, DOG_CFG.flankMax);
    }
    this.command = cmd;
  }

  setDirect(dx, dy) {
    const l = Math.hypot(dx, dy);
    if (l > 0) { this.dirX = dx / l; this.dirY = dy / l; this.command = 'DIRECT'; }
    else if (this.command === 'DIRECT') this.command = 'STOP';
  }

  update(dt, w) {
    const c = DOG_CFG;
    const flock = w.flock;
    const mul = this.steady ? c.steadyMul : 1;
    let desX = 0, desY = 0;

    const nearestSheep = () => {
      let best = Infinity;
      for (const s of w.sheep) if (!s.penned) best = Math.min(best, Math.hypot(s.x - this.x, s.y - this.y));
      return best;
    };

    switch (this.command) {
      case 'DIRECT':
        desX = this.dirX * c.run * mul; desY = this.dirY * c.run * mul;
        break;
      case 'WALK': {
        if (flock.n) {
          const [ux, uy] = M.norm(flock.x - this.x, flock.y - this.y);
          const dn = nearestSheep();
          const spd = c.walk * mul * (dn < 3 ? M.clamp((dn - 1.2) / 1.8, 0, 1) : 1);
          desX = ux * spd; desY = uy * spd;
        }
        break;
      }
      case 'COMEBYE':
      case 'AWAY': {
        if (flock.n) {
          let rx = this.x - flock.x, ry = this.y - flock.y;
          const r = Math.hypot(rx, ry) || 0.01; rx /= r; ry /= r;
          const cw = this.command === 'COMEBYE';
          const tx = cw ? -ry : ry, ty = cw ? rx : -rx;
          const radial = M.clamp((this.flankR - r) * 0.7, -5, 5);
          const spd = c.flank * mul;
          desX = tx * spd + rx * radial; desY = ty * spd + ry * radial;
        }
        break;
      }
      case 'OUT': {
        if (flock.n) {
          const rx = this.x - flock.x, ry = this.y - flock.y;
          const r = Math.hypot(rx, ry);
          if (r > 28) this.command = 'STOP';
          else { const [ux, uy] = M.norm(rx, ry); desX = ux * c.run * 0.7 * mul; desY = uy * c.run * 0.7 * mul; }
        } else this.command = 'STOP';
        break;
      }
      case 'HOME': {
        const h = w.handler;
        const d = Math.hypot(h.x - this.x, h.y - this.y);
        if (d < 2.2) this.command = 'STOP';
        else { const [ux, uy] = M.norm(h.x - this.x, h.y - this.y); const spd = c.run * 0.8 * Math.min(1, d / 4); desX = ux * spd; desY = uy * spd; }
        break;
      }
      default: break;
    }

    [desX, desY] = steerAroundWalls(desX, desY, this.x, this.y, w.walls, 4, c.radius);
    // The dog copes with rough ground and slopes better than the sheep.
    const gm = Math.pow(w.ground.speedMul(this.x, this.y, desX, desY), 0.6);
    desX *= gm; desY *= gm;
    const k = Math.min(1, dt * 7);
    this.vx += (desX - this.vx) * k;
    this.vy += (desY - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    resolveWalls(this, w.walls, c.radius);
    resolveCircles(this, w.circles, c.radius);
    keepInBounds(this, w.bounds, c.radius);

    const spd = Math.hypot(this.vx, this.vy);
    if (spd > 0.5) this.heading = M.angleLerp(this.heading, Math.atan2(this.vy, this.vx), Math.min(1, dt * 10));
    else if (flock.n && this.command !== 'DIRECT') this.heading = M.angleLerp(this.heading, Math.atan2(flock.y - this.y, flock.x - this.x), Math.min(1, dt * 2));
    this.stepPhase += spd * dt;
    this.restT = spd < 0.3 ? this.restT + dt : 0;
    this.lie += ((this.lying ? 1 : 0) - this.lie) * Math.min(1, dt * 15);
    this.crouch += ((this.command === 'WALK' ? 1 : 0) - this.crouch) * Math.min(1, dt * 4);
    this.gait += (M.clamp(spd / c.run, 0, 1) - this.gait) * Math.min(1, dt * 5);
    // Short quick strides at a trot, long ones at the gallop (~1.2 m to ~2.8 m per cycle).
    this.stride += spd * dt * M.lerp(5.2, 2.2, this.gait);
  }

  get lying() { return this.command === 'STOP' && this.restT > 0; }
}
