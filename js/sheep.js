'use strict';
// Sheep AI: a small state machine (GRAZE / ALERT / FLEE / REGROUP / PENNED) driven by the
// "pressure" the dog puts on the sheep, layered over boid-style flocking.
const SHEEP_CFG = {
  walk: 1.3, trot: 3.2, run: 6.0, panicRun: 8.2,
  alertR: 28,       // dog this close: sheep lift their heads
  panicR: 4.0,      // dog this close: sheep bolt and scatter
  neighborR: 16,    // flock mates considered for cohesion/alignment
  sepR: 1.8,        // personal space
  handlerR: 8,      // sheep keep away from the handler
  turnRate: 5.5,    // how quickly velocity follows the desired velocity
  radius: 0.55,
};

// A field's flock temperament (map.sheep) as multipliers on SHEEP_CFG, the same for every sheep so
// the flock still moves as one. Kept within a narrow band so the trial's judging thresholds stay fair.
//   wary:     how far off the dog is noticed and how close it can come before they bolt
//   pace:     trot / run / panic speeds (walking and grazing are unchanged)
//   flocking: how strongly they bunch and pull back to the mob
function sheepTemperament(t = {}) {
  const k = (v) => M.clamp(v ?? 1, 0.8, 1.25);
  return { wary: k(t.wary), pace: k(t.pace), flocking: k(t.flocking) };
}

// One word for the field menu. Loose-flocking sheep read as independent; otherwise it's how
// lively they are (wary and pace together). A map can name it outright with sheep.word.
function sheepTemperamentWord(raw) {
  if (raw?.word) return raw.word;
  const t = sheepTemperament(raw);
  if (t.flocking <= 0.92) return 'Independent';
  const lively = (t.wary + t.pace) / 2;
  return lively >= 1.12 ? 'Flighty' : lively >= 1.05 ? 'Lively' : lively > 0.97 ? 'Steady' : lively >= 0.92 ? 'Calm' : 'Placid';
}

class Sheep {
  constructor(id, x, y, temperament) {
    this.id = id;
    this.temper = sheepTemperament(temperament);
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.heading = Math.random() * Math.PI * 2;
    this.state = 'GRAZE';
    this.pressure = 0;
    this.panic = 0;
    this.wanderDir = this.heading;
    this.wanderT = M.rand(1, 3);
    this.grazing = true;
    this.stepPhase = Math.random() * 10;
    this.penned = false;   // locked in behind a closed gate
    this.inPen = false;    // currently standing inside the pen
    this.tint = Math.random();
  }

  // 0..1 how threatened this sheep feels by the dog.
  computePressure(dog) {
    const dx = this.x - dog.x, dy = this.y - dog.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const dogSpd = Math.hypot(dog.vx, dog.vy);
    let approach = 0;
    if (dogSpd > 0.3) approach = M.clamp((dog.vx * -dx + dog.vy * -dy) / (dogSpd * d), -1, 1);
    // A dog coming straight on feels closer; a dog lying still feels further away.
    let de = d - Math.max(0, approach) * dogSpd * 1.2;
    if (dogSpd < 0.3) de += 9;
    else if (dogSpd < 2.5) de += 3;
    const alertR = SHEEP_CFG.alertR * this.temper.wary, panicR = SHEEP_CFG.panicR * this.temper.wary;
    return { d, dx, dy, pressure: M.clamp((alertR - de) / (alertR - panicR), 0, 1) };
  }

  update(dt, w) {
    const c = SHEEP_CFG, t = this.temper;
    const trot = c.trot * t.pace, run = c.run * t.pace, panicRun = c.panicRun * t.pace;
    const dog = w.dog;
    const { d, dx, dy, pressure } = this.computePressure(dog);
    const target = this.penned ? 0 : pressure;
    this.pressure += (target - this.pressure) * Math.min(1, dt * 6);

    if (!this.penned && d < c.panicR * t.wary + 0.8) {
      if (this.panic < 0.3) w.events.push({ type: 'panic', sheep: this });
      this.panic = 1;
    }
    this.panic = Math.max(0, this.panic - dt / 1.6);

    // Flock mates. Personal space shrinks as the dog presses: worried sheep pack in shoulder to shoulder.
    const sepRange = c.sepR * 2 * (1 - 0.4 * this.pressure);
    let cx = 0, cy = 0, avx = 0, avy = 0, n = 0, sx = 0, sy = 0, nearest = Infinity;
    for (const o of w.sheep) {
      if (o === this || o.penned !== this.penned) continue;
      const ox = o.x - this.x, oy = o.y - this.y;
      const od = Math.hypot(ox, oy);
      if (od < nearest) nearest = od;
      if (od < c.neighborR) { cx += o.x; cy += o.y; avx += o.vx; avy += o.vy; n++; }
      if (od < sepRange && od > 1e-6) {
        const f = (sepRange - od) / sepRange;
        sx -= ox / od * f; sy -= oy / od * f;
      }
    }
    if (n) { cx /= n; cy /= n; avx /= n; avy /= n; }
    const flock = w.flock;
    const dc = flock.n ? Math.hypot(flock.x - this.x, flock.y - this.y) : 0;

    // State transitions (with a little hysteresis).
    const p = this.pressure;
    if (this.penned) this.state = 'PENNED';
    else if (this.state === 'FLEE' ? p > 0.12 : p > 0.2) this.state = 'FLEE';
    else if (this.state === 'ALERT' ? p > 0.03 : p > 0.06) this.state = 'ALERT';
    else if (flock.n > 1 && (this.state === 'REGROUP' ? dc > 5 : dc > 9)) this.state = 'REGROUP';
    else this.state = 'GRAZE';

    let desX = 0, desY = 0;
    const [ux, uy] = M.norm(dx, dy);                       // away from dog
    // Cohesion target: nearby flock mates, or the whole flock when this sheep has been split off.
    const [tcx, tcy] = n ? M.norm(cx - this.x, cy - this.y) : M.norm(flock.x - this.x, flock.y - this.y);
    const dcn = n ? Math.hypot(cx - this.x, cy - this.y) : dc;
    // Flock mentality: a sheep away from the mob wants back in, even while watching the dog.
    const [fx, fy] = flock.n > 1 ? M.norm(flock.x - this.x, flock.y - this.y) : [0, 0];
    const regroup = flock.n > 1 ? M.clamp((dc - 6) / 8, 0, 1) * t.flocking : 0;
    // Grazing sheep keep a mate within a few metres; a sheep that finds itself alone walks back.
    const lonely = n ? M.clamp((nearest - 2.5) / 3, 0, 1) * t.flocking : 0;

    switch (this.state) {
      case 'GRAZE': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = M.rand(2, 5);
          this.grazing = Math.random() < 0.6;
          // Pick the next bite in roughly the direction the rest are, more so the further out it is.
          let dir = this.heading + M.rand(-1.4, 1.4);
          if (flock.n > 1 && dc > 2) dir = M.angleLerp(dir, Math.atan2(flock.y - this.y, flock.x - this.x), M.clamp((dc - 2) / 5, 0, 0.8));
          this.wanderDir = dir;
        }
        if (!this.grazing) { desX = Math.cos(this.wanderDir) * c.walk; desY = Math.sin(this.wanderDir) * c.walk; }
        if (lonely > 0) { desX += tcx * c.walk * lonely; desY += tcy * c.walk * lonely; }
        if (flock.n > 1 && dc > 5) { const k = c.walk * 0.8 * M.clamp((dc - 5) / 4, 0, 1) * t.flocking; desX += fx * k; desY += fy * k; }
        desX += sx * c.walk; desY += sy * c.walk;
        break;
      }
      case 'REGROUP': {
        const [fx, fy] = M.norm(flock.x - this.x, flock.y - this.y);
        desX = fx * trot + sx * c.walk; desY = fy * trot + sy * c.walk;
        break;
      }
      case 'ALERT': {
        const drift = c.walk * 0.7 * M.clamp((p - 0.08) / 0.12, 0, 1);
        // Heads up, they close ranks: each sheep edges in toward its mates.
        const bunch = c.walk * M.clamp(p / 0.15, 0.4, 1) * M.clamp((dcn - 1.2) / 2.5, 0, 1) * t.flocking;
        desX = ux * drift + tcx * bunch + sx * c.walk * 0.7 + fx * regroup * trot;
        desY = uy * drift + tcy * bunch + sy * c.walk * 0.7 + fy * regroup * trot;
        break;
      }
      case 'FLEE': {
        const q = M.clamp((p - 0.15) / 0.85, 0, 1);
        let speed = M.lerp(c.walk, run, Math.pow(q, 1.2));
        if (this.panic > 0) speed = Math.max(speed, panicRun * this.panic);
        // Run away from the dog as a mob, not each sheep straight out from it: blend this sheep's own
        // escape line with the flock's (centre away from dog), so the edges don't fan out. A sheep the
        // dog is right on top of, or one in a blind panic, trusts its own line more.
        const [gx, gy] = flock.n > 1 ? M.norm(flock.x - dog.x, flock.y - dog.y) : [ux, uy];
        const share = 0.55 * t.flocking * (1 - this.panic * 0.5) * M.clamp((d - 2) / 6, 0.3, 1);
        const [ex, ey] = M.norm(ux * (1 - share) + gx * share, uy * (1 - share) + gy * share);
        // Blend flight with flock cohesion and alignment: threatened sheep bunch up and move as one.
        const wC = (0.7 + 0.5 * (1 - p)) * M.clamp((dcn - 1) / 3, 0, 1) * (1 - this.panic * 0.5) * t.flocking;
        const [alx, aly] = M.norm(avx, avy);
        const wA = 0.55 * t.flocking;
        let bx = ex + tcx * wC + alx * wA + sx * 1.2 + fx * regroup;
        let by = ey + tcy * wC + aly * wA + sy * 1.2 + fy * regroup;
        // Handler pressure.
        const hx = this.x - w.handler.x, hy = this.y - w.handler.y, hd = Math.hypot(hx, hy);
        if (hd < c.handlerR && hd > 1e-6) { const f = (1 - hd / c.handlerR) * 1.4; bx += hx / hd * f; by += hy / hd * f; }
        if (this.panic > 0) { bx += (Math.random() - 0.5) * this.panic * 1.2; by += (Math.random() - 0.5) * this.panic * 1.2; }
        const [nx, ny] = M.norm(bx, by);
        desX = nx * speed; desY = ny * speed;
        break;
      }
      case 'PENNED': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = M.rand(2, 6); this.grazing = Math.random() < 0.7; this.wanderDir = Math.random() * Math.PI * 2; }
        if (!this.grazing) { desX = Math.cos(this.wanderDir) * c.walk * 0.5; desY = Math.sin(this.wanderDir) * c.walk * 0.5; }
        desX += sx * c.walk; desY += sy * c.walk;
        break;
      }
    }

    // Wind pushes loose sheep downwind, harder in the gusts and once they're on the move.
    if (w.wind && !this.penned) {
      const k = this.state === 'FLEE' || this.state === 'REGROUP' ? 0.06 : 0.02;
      desX += w.wind.x * k; desY += w.wind.y * k;
    }

    [desX, desY] = steerAroundWalls(desX, desY, this.x, this.y, w.walls, 5, c.radius);
    // Heather, snow and sand slow the sheep; so does climbing.
    const gm = w.ground.speedMul(this.x, this.y, desX, desY);
    desX *= gm; desY *= gm;
    const k = Math.min(1, dt * c.turnRate * (this.state === 'FLEE' ? 1.3 : 1));
    this.vx += (desX - this.vx) * k;
    this.vy += (desY - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    resolveWalls(this, w.walls, c.radius);
    resolveCircles(this, w.circles, c.radius);
    keepInBounds(this, w.bounds, c.radius);

    const spd = Math.hypot(this.vx, this.vy);
    if (spd > 0.3) this.heading = M.angleLerp(this.heading, Math.atan2(this.vy, this.vx), Math.min(1, dt * 7));
    else if (this.state === 'ALERT') this.heading = M.angleLerp(this.heading, Math.atan2(-dy, -dx), Math.min(1, dt * 3));
    this.stepPhase += spd * dt;
  }
}

// Centre and spread of the sheep still being worked (not yet penned).
function computeFlock(sheep) {
  let x = 0, y = 0, n = 0;
  for (const s of sheep) if (!s.penned) { x += s.x; y += s.y; n++; }
  if (!n) return { x: 0, y: 0, n: 0, spread: 0, maxSpeed: 0 };
  x /= n; y /= n;
  let spread = 0, maxSpeed = 0;
  for (const s of sheep) if (!s.penned) {
    spread = Math.max(spread, Math.hypot(s.x - x, s.y - y));
    maxSpeed = Math.max(maxSpeed, Math.hypot(s.vx, s.vy));
  }
  return { x, y, n, spread, maxSpeed };
}
