'use strict';
// Trial phases and scoring, modelled on ISDS National-style rules without the shed:
// Outrun 20, Lift 10, Fetch 20, Drive 30, Pen 10 = 90 points. Judges deduct from the maximum.
const TRIAL_PHASES = ['OUTRUN', 'LIFT', 'FETCH', 'DRIVE1', 'DRIVE2', 'DRIVE3', 'PEN', 'DONE'];
const POINTS = { OUTRUN: 20, LIFT: 10, FETCH: 20, DRIVE: 30, PEN: 10 };
const PHASE_CAT = { OUTRUN: 'OUTRUN', LIFT: 'LIFT', FETCH: 'FETCH', DRIVE1: 'DRIVE', DRIVE2: 'DRIVE', DRIVE3: 'DRIVE', PEN: 'PEN' };
const PHASE_INFO = {
  OUTRUN: { title: 'Outrun', hint: 'Send the dog wide around the sheep to the far side. Do not cross the course or run tight.' },
  LIFT:   { title: 'Lift', hint: 'Walk up quietly and start the sheep moving toward the post.' },
  FETCH:  { title: 'Fetch', hint: 'Bring the sheep in a straight line through the fetch gate to the post.' },
  DRIVE1: { title: 'Drive away', hint: 'Drive the sheep from the post through the first drive gate.' },
  DRIVE2: { title: 'Cross drive', hint: 'Drive straight across the field through the second gate.' },
  DRIVE3: { title: 'Drive to pen', hint: 'Bring the sheep in a straight line toward the pen mouth.' },
  PEN:    { title: 'Pen', hint: 'Put all the sheep in the pen. The gate closes once every sheep is inside.' },
  DONE:   { title: 'Finished', hint: '' },
};
const CAT_LABEL = { OUTRUN: 'Outrun', LIFT: 'Lift', FETCH: 'Fetch', DRIVE: 'Drive', PEN: 'Pen' };
// Practice drills: one slice of the course, judged the same way, reset and repeated.
// best: 'time' ranks completed runs by clock, 'score' by points.
const DRILLS = {
  pen:    { name: 'Pen training', phases: ['PEN', 'DONE'], best: 'time', autoStart: true },
  outrun: { name: 'Outrun & lift', phases: ['OUTRUN', 'LIFT', 'DONE'], best: 'score' },
  fetch:  { name: 'Fetch training', phases: ['FETCH', 'DONE'], best: 'score' },
  drive:  { name: 'Drive training', phases: ['DRIVE1', 'DRIVE2', 'DRIVE3', 'DONE'], best: 'score' },
};
const MODE_NAMES = { trial: 'Trial competition', free: 'Untimed trial', pasture: 'Pasture' };
const PASTURE_SHEEP = 50;                  // per mob; pasture sets out two
const PASTURE_LOOSE = { flocking: 0.6, space: 1.6 };   // pasture sheep keep further apart and drift off more
for (const [k, d] of Object.entries(DRILLS)) MODE_NAMES[k] = d.name;

class Trial {
  constructor(course, mode) {
    this.course = course;
    this.mode = mode;                       // 'trial' | 'free' | 'pasture' | a DRILLS key
    this.pasture = mode === 'pasture';      // open field: nothing is judged or timed
    this.drill = DRILLS[mode] || null;
    this.phases = this.drill ? this.drill.phases : TRIAL_PHASES;
    this.phaseIdx = 0;
    this.phase = this.phases[0];
    this.started = false;
    this.time = 0;
    this.phaseTime = 0;
    this.timeLimit = mode === 'trial' ? course.map.timeLimit : Infinity;
    this.deductions = { OUTRUN: 0, LIFT: 0, FETCH: 0, DRIVE: 0, PEN: 0 };
    this.reached = new Set([PHASE_CAT[this.phase]]);
    this.notes = new Map();                 // "cat|reason" -> {cat, reason, pts}
    this.gateTrack = null;
    this.outrun = { side: 0, crossed: false, stopT: 0, tightNoted: false, startFlock: null, disturbed: false };
    this.pen = { closing: false, closeT: 0, closed: false };
    this.liftPoint = null;
    this.panicCooldown = 0;
    this.result = null;
    this.unfinished = null;                 // the section still being worked when a run was retired or timed out
    this.onPhase = null;                    // callback(phase)
    this.toast = null;                      // callback(text)
    this.enterPhase();
  }

  get info() { return PHASE_INFO[this.phase]; }
  get category() { return PHASE_CAT[this.phase]; }
  get timeLeft() { return this.timeLimit - this.time; }

  deduct(cat, pts, reason) {
    if (pts <= 0 || !cat) return;
    const room = POINTS[cat] - this.deductions[cat];
    const applied = Math.min(room, pts);
    if (applied <= 0) return;
    this.deductions[cat] += applied;
    const key = `${cat}|${reason || 'Other faults'}`;
    const n = this.notes.get(key) || { cat, reason: reason || 'Other faults', pts: 0 };
    n.pts += applied;
    this.notes.set(key, n);
  }

  // A section scores what's left after deductions, once reached; one left unfinished at the end scores nothing.
  score(cat) { return this.reached.has(cat) && cat !== this.unfinished ? POINTS[cat] - this.deductions[cat] : 0; }
  // The most this run can still score: everything not yet deducted.
  possible() { return this.categories.reduce((t, c) => t + POINTS[c] - this.deductions[c], 0); }
  total() { let t = 0; for (const c of Object.keys(POINTS)) t += this.score(c); return t; }
  // Categories this run is judged on, in course order, and what they are worth together.
  get categories() { return Object.keys(POINTS).filter(c => this.phases.some(p => PHASE_CAT[p] === c)); }
  get maxPoints() { return this.categories.reduce((t, c) => t + POINTS[c], 0); }

  start() { if (!this.started) { this.started = true; } }

  advance() {
    this.phaseIdx++;
    this.phase = this.phases[this.phaseIdx];
    this.phaseTime = 0;
    this.enterPhase();
    if (this.phase === 'DONE') { this.finish('COMPLETE'); return; }
    if (this.onPhase) this.onPhase(this.phase);
  }

  enterPhase() {
    const cat = PHASE_CAT[this.phase];
    if (cat) this.reached.add(cat);
    const c = this.course;
    if (this.phase === 'FETCH') this.beginGate(c.fetchGate);
    else if (this.phase === 'DRIVE1') this.beginGate(c.driveGates[0]);
    else if (this.phase === 'DRIVE2') this.beginGate(c.driveGates[1]);
    else this.gateTrack = null;
  }

  finish(outcome) {
    if (this.result) return;
    if (outcome !== 'COMPLETE') this.unfinished = PHASE_CAT[this.phase] || null;
    this.phase = 'DONE';
    this.result = { outcome, total: this.total(), time: this.time };
    if (this.onPhase) this.onPhase('DONE');
  }

  // --- gates -------------------------------------------------------------
  beginGate(gate) { this.gateTrack = { gate, prev: new Map(), result: new Map() }; }

  trackGate(sheep) {
    const t = this.gateTrack; if (!t) return;
    const g = t.gate;
    for (const s of sheep) {
      const rx = s.x - g.x, ry = s.y - g.y;
      const along = rx * g.dir.x + ry * g.dir.y;
      const prev = t.prev.has(s.id) ? t.prev.get(s.id) : along;
      if (prev <= 0 && along > 0 && !t.result.has(s.id)) {
        const lat = Math.abs(rx * g.perp.x + ry * g.perp.y);
        t.result.set(s.id, lat < g.width / 2);
      }
      t.prev.set(s.id, along);
    }
  }

  resolveGate(cat, perSheep, sheep, label) {
    const t = this.gateTrack; if (!t) return;
    let missed = 0;
    for (const s of sheep) if (t.result.get(s.id) !== true) missed++;
    if (missed) {
      this.deduct(cat, missed * perSheep, `Sheep missed the ${label}`);
      if (this.toast) this.toast(`${missed} sheep missed the ${label}`);
    } else if (this.toast) this.toast(`Through the ${label}`);
    this.gateTrack = null;
  }

  // Penalise the flock wandering off the straight line between two points.
  lineDeduct(cat, leg, flock, dt, rate, tol = 5) {
    const off = M.distToSeg(flock.x, flock.y, leg.a.x, leg.a.y, leg.b.x, leg.b.y);
    if (off > tol) this.deduct(cat, (off - tol) * rate * dt, 'Off line');
  }

  onPanic() {
    if (this.panicCooldown > 0) return;
    this.panicCooldown = 1.2;
    const cat = this.category;
    const pts = { OUTRUN: 1, LIFT: 1.5, FETCH: 1, DRIVE: 1, PEN: 0.5 }[cat] || 0;
    this.deduct(cat, pts, 'Dog too close, sheep panicked');
  }

  // --- main update -------------------------------------------------------
  update(dt, w) {
    if (this.result || !this.started || this.pasture) return;
    this.time += dt;
    this.phaseTime += dt;
    this.panicCooldown = Math.max(0, this.panicCooldown - dt);
    if (this.time >= this.timeLimit) { this.finish('TIME'); return; }

    for (const e of w.events) if (e.type === 'panic') this.onPanic();

    const c = this.course, flock = w.flock, dog = w.dog, post = c.post;
    const cat = this.category;
    if (!flock.n) return;

    // General flock-keeping: scattered sheep cost points in every working phase.
    if (cat && cat !== 'PEN' && flock.spread > 12) this.deduct(cat, (flock.spread - 12) * 0.03 * dt, 'Sheep scattered');

    switch (this.phase) {
      case 'OUTRUN': {
        const o = this.outrun;
        if (!o.startFlock) o.startFlock = { x: flock.x, y: flock.y };
        const rel = { x: dog.x - post.x, y: dog.y - post.y };
        const along = rel.x * c.axis.x + rel.y * c.axis.y;
        const lateral = rel.x * c.axisPerp.x + rel.y * c.axisPerp.y;
        const flockAlong = (flock.x - post.x) * c.axis.x + (flock.y - post.y) * c.axis.y;
        const dDog = Math.hypot(dog.x - flock.x, dog.y - flock.y);
        const behind = (dog.x - flock.x) * c.axis.x + (dog.y - flock.y) * c.axis.y > 3;

        if (along > 8 && along < flockAlong - 6) {
          if (o.side === 0 && Math.abs(lateral) > 4) o.side = Math.sign(lateral);
          else if (o.side !== 0 && !o.crossed && Math.sign(lateral) === -o.side && Math.abs(lateral) > 3) {
            o.crossed = true;
            this.deduct('OUTRUN', 6, 'Crossed the course');
            if (this.toast) this.toast('Crossed course on the outrun');
          }
        }
        const spd = Math.hypot(dog.vx, dog.vy);
        if (spd < 0.8 && along > 5) { o.stopT += dt; if (o.stopT > 1) this.deduct('OUTRUN', dt * 0.6, 'Stopped on the outrun'); }
        else o.stopT = 0;
        if (!behind && dDog < 15) this.deduct('OUTRUN', dt * 0.7, 'Ran tight to the sheep');
        if (this.phaseTime > 75) this.deduct('OUTRUN', dt * 0.1, 'Slow outrun');
        if (!o.disturbed && Math.hypot(flock.x - o.startFlock.x, flock.y - o.startFlock.y) > 6) {
          o.disturbed = true; this.deduct('OUTRUN', 2, 'Sheep moved before the lift');
        }
        if (behind && dDog < 22) {
          this.liftPoint = { x: flock.x, y: flock.y };
          this.liftDogDist = dDog;
          this.advance();
        }
        break;
      }
      case 'LIFT': {
        if (this.phaseTime < 0.05 && this.liftDogDist < 6) this.deduct('LIFT', 2, 'Lift too tight');
        if (flock.maxSpeed > 5.5) this.deduct('LIFT', dt * 1.2, 'Sheep rushed at the lift');
        if (this.phaseTime > 25) this.deduct('LIFT', dt * 0.1, 'Slow lift');
        const moved = Math.hypot(flock.x - this.liftPoint.x, flock.y - this.liftPoint.y);
        if (moved > 8) { c.legs.FETCH = { a: this.liftPoint, b: post }; this.advance(); }
        break;
      }
      case 'FETCH': {
        this.lineDeduct('FETCH', c.legs.FETCH, flock, dt, 0.02);
        this.trackGate(w.sheep);
        // The fetch ends at the handler's feet: the flock drawn level with (or round behind) the post.
        const rel = { x: flock.x - post.x, y: flock.y - post.y };
        const along = rel.x * c.axis.x + rel.y * c.axis.y;
        const lateral = Math.abs(rel.x * c.axisPerp.x + rel.y * c.axisPerp.y);
        if ((along < 1 && lateral < 8) || Math.hypot(rel.x, rel.y) < 5) {
          this.resolveGate('FETCH', 2, w.sheep, 'fetch gate');
          this.advance();
        }
        break;
      }
      case 'DRIVE1':
      case 'DRIVE2': {
        const gate = this.phase === 'DRIVE1' ? c.driveGates[0] : c.driveGates[1];
        this.lineDeduct('DRIVE', c.legs[this.phase], flock, dt, 0.015);
        this.trackGate(w.sheep);
        const along = (flock.x - gate.x) * gate.dir.x + (flock.y - gate.y) * gate.dir.y;
        if (along > 5) {
          this.resolveGate('DRIVE', 2.5, w.sheep, this.phase === 'DRIVE1' ? 'first drive gate' : 'cross-drive gate');
          this.advance();
        }
        break;
      }
      case 'DRIVE3': {
        this.lineDeduct('DRIVE', c.legs.DRIVE3, flock, dt, 0.015);
        if (Math.hypot(flock.x - c.pen.mouth.x, flock.y - c.pen.mouth.y) < 13) this.advance();
        break;
      }
      case 'PEN': {
        const pen = c.pen, p = this.pen;
        const inner = pen.inner(), outer = pen.outer();
        let inside = 0;
        for (const s of w.sheep) {
          const was = s.inPen;
          if (!s.inPen && M.pointInRect(s.x, s.y, inner)) s.inPen = true;
          else if (s.inPen && !M.pointInRect(s.x, s.y, outer)) s.inPen = false;
          if (s.inPen) inside++;
          else if (was && !p.closing) { this.deduct('PEN', 1, 'Sheep broke from the pen'); if (this.toast) this.toast('A sheep broke out'); }
        }
        if (!p.closing && inside === w.sheep.length) { p.closing = true; p.closeT = 0; }
        if (p.closing) {
          if (inside < w.sheep.length) { p.closing = false; p.closeT = 0; pen.gateT = 0; }
          else {
            p.closeT = Math.min(1, p.closeT + dt / 1.4);
            pen.gateT = p.closeT;
            if (p.closeT >= 1) {
              p.closed = true;
              for (const s of w.sheep) s.penned = true;
              this.advance();   // -> DONE
            }
          }
        }
        if (!p.closing && this.phaseTime > 45) this.deduct('PEN', dt / 20, 'Slow pen');
        const dd = Math.hypot(dog.x - pen.mouth.x, dog.y - pen.mouth.y);
        if (dd < 2 && !p.closing) this.deduct('PEN', dt * 0.5, 'Dog in the pen mouth');
        break;
      }
      default: break;
    }
  }
}
