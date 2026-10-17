'use strict';
// Game: owns the world, runs the loop, routes commands.
class Game {
  constructor(canvas, minimapCanvas) {
    this.renderer = new Renderer(canvas);
    this.minimap = new Minimap(minimapCanvas);
    this.ui = new UI(this);
    this.input = new Input(this);
    this.mode = null;
    this.mapId = MAPS[0].id;
    try { const saved = localStorage.getItem('sheepdog.map'); if (saved && MAPS.some(m => m.id === saved)) this.mapId = saved; } catch (e) { /* storage unavailable */ }
    this.course = null;
    this.sheep = []; this.dog = null; this.handler = null; this.trial = null;
    this.paused = true;
    this.inMenu = true;
    this.drillStats = { count: 0, best: null };
    this.resetTimer = 0;
    this.last = performance.now();
    this.attractT = 0;
    this.enterAttract();
    this.ui.showCard('menu');
    requestAnimationFrame((t) => this.frame(t));
  }

  startMode(mode) {
    this.mode = mode;
    this.drillStats = { count: 0, best: null };
    this.setup();
    this.inMenu = false;
    this.paused = false;
    this.renderer.cam.zoom = this.baseZoom();
    this.ui.showCard(null);
  }

  // Switch field; on the title screens the backdrop follows the highlighted map.
  selectMap(id) {
    if (id === this.mapId) return;
    this.mapId = id;
    try { localStorage.setItem('sheepdog.map', id); } catch (e) { /* storage unavailable */ }
    // Keep the current backdrop until the new field's ground is ready, so the menu never freezes.
    if (this.inMenu) prepareIso(mapById(id), () => { if (this.mapId === id && this.inMenu) this.enterAttract(); });
  }

  get drill() { return DRILLS[this.mode] || null; }

  setup() {
    const map = mapById(this.mapId);
    this.course = buildCourse(map);
    const c = this.course;
    this.sheep = [];
    this.events = [];
    this.resetTimer = 0;

    // Where the sheep are set out and the dog waits. Drills put the dog lying behind the sheep,
    // far enough back (~16 m) that they only lift their heads rather than bolt.
    const b = c.bounds, inField = (x, y) => [M.clamp(x, b.x + 3, b.x + b.w - 3), M.clamp(y, b.y + 3, b.y + b.h - 3)];
    let sheepAt = c.start, dogAt = map.dogStart;
    if (this.mode === 'pen') {
      const m = c.pen.mouth;
      sheepAt = { x: m.x - 8, y: m.y - 24 }; dogAt = { x: m.x - 6, y: m.y - 3 };
    } else if (this.mode === 'fetch') {
      const [x, y] = inField(c.start.x + c.axis.x * 16, c.start.y + c.axis.y * 16);
      dogAt = { x, y };
    } else if (this.mode === 'drive') {
      const [dx, dy] = M.norm(c.driveGates[0].x - c.post.x, c.driveGates[0].y - c.post.y);
      sheepAt = { x: c.post.x + dx * 18, y: c.post.y + dy * 18 };
      dogAt = { x: c.post.x + dx * 2, y: c.post.y + dy * 2 };
    }
    for (let i = 0; i < map.sheepCount; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 3;
      this.sheep.push(new Sheep(i, sheepAt.x + Math.cos(a) * r, sheepAt.y + Math.sin(a) * r, map.sheep));
    }
    this.dog = new Dog(dogAt.x, dogAt.y);
    if (this.mode === 'pen') {
      this.handler = new Handler(c.pen.handlerSpot.x, c.pen.handlerSpot.y);
      this.handler.holdingGate = true;
    } else this.handler = new Handler(c.post.x - 1.3, c.post.y + 0.4);
    if (this.drill && this.mode !== 'outrun') this.dog.heading = this.flockHeading();

    this.trial = new Trial(c, this.mode);
    this.trial.toast = (t) => this.ui.toast(t);
    this.trial.onPhase = (p) => this.onPhase(p);
    if (this.drill && this.drill.autoStart) this.trial.start();

    const cam = this.renderer.cam;
    cam.x = this.dog.x; cam.y = this.dog.y;
  }

  // Dog faces the sheep at the start of a drill.
  flockHeading() {
    const f = computeFlock(this.sheep);
    return f.n ? Math.atan2(f.y - this.dog.y, f.x - this.dog.x) : 0;
  }

  onPhase(phase) {
    const c = this.course;
    if (phase === 'PEN') { this.handler.goTo(c.pen.handlerSpot.x, c.pen.handlerSpot.y); this.handler.holdingGate = true; }
    if (phase !== 'DONE' && phase !== 'LIFT') this.ui.toast(PHASE_INFO[phase].title);
    if (phase === 'DONE') this.onDone();
  }

  onDone() {
    const t = this.trial;
    const drill = this.drill;
    Music.sting(t.result.outcome);
    if (drill) {
      if (t.result.outcome !== 'COMPLETE') return;
      const st = this.drillStats;
      st.count++;
      if (drill.best === 'time') {
        const best = st.best == null || t.time < st.best;
        if (best) st.best = t.time;
        this.ui.toast(`Penned in ${M.fmtTime(t.time)}${best && st.count > 1 ? ' – new best!' : ''}`);
      } else {
        const score = t.total(), best = st.best == null || score > st.best;
        if (best) st.best = score;
        // Name the costliest fault so the next attempt has something to work on.
        const worst = [...t.notes.values()].sort((a, b) => b.pts - a.pts)[0];
        const tail = best && st.count > 1 ? ' – new best!' : worst && worst.pts >= 0.5 ? ` – ${worst.reason} (−${worst.pts.toFixed(1)})` : '';
        this.ui.toast(`${score.toFixed(1)} / ${t.maxPoints}${tail}`);
      }
      this.resetTimer = 3.5;
      return;
    }
    setTimeout(() => { if (this.trial === t) { this.paused = true; this.ui.showResult(t, this); } }, 1200);
  }

  // Commands from buttons or keys.
  command(cmd) {
    if (cmd === 'MENU') { if (this.inMenu) return; this.paused ? this.resume() : this.pause(); return; }
    if (cmd === 'RESTART') { if (!this.inMenu) this.restart(); return; }
    if (this.paused || !this.dog) return;
    if (this.trial.result) return;
    this.dog.setCommand(cmd, this.flock);
    Sound.whistle(cmd);
    if (WHISTLES[cmd]) Music.duck();
    if (cmd !== 'STOP' && cmd !== 'STEADY') this.trial.start();
  }

  pause() { this.paused = true; this.ui.showCard('pause'); }
  resume() { if (this.inMenu) return; this.paused = false; this.ui.showCard(null); this.last = performance.now(); }
  restart() { this.setup(); this.paused = false; this.ui.showCard(null); this.last = performance.now(); }
  retire() {
    if (this.trial && !this.trial.result && this.trial.started && !this.drill) { this.trial.finish('RETIRED'); this.paused = true; this.ui.showResult(this.trial, this); return; }
    this.toMenu();
  }
  toMenu() { this.inMenu = true; this.paused = true; this.enterAttract(); this.ui.showCard('menu'); }

  // Title-screen backdrop: a fresh course with the sheep left to graze and the camera drifting over the field.
  enterAttract() {
    this.mode = 'free';
    this.setup();
    this.renderer.cam.zoom = this.baseZoom() * 1.15;
    // The dog lies a little way off the flock, on the side away from the middle of the field.
    const f = computeFlock(this.sheep), b = this.course.bounds;
    const [ox, oy] = M.norm(f.x - (b.x + b.w / 2), f.y - (b.y + b.h / 2));
    this.dog.x = f.x + (ox || 1) * 18; this.dog.y = f.y + oy * 18;
    this.dog.heading = Math.atan2(f.y - this.dog.y, f.x - this.dog.x);
    this.dog.steady = true;
    this.attractAI = { phase: 'REST', t: M.rand(3, 5), target: 0 };
    this.attractFocus = null; this.attractOff = null;
    this.attractUpdate(0);
  }

  // Title-screen dog: rests, then flanks round to the outside of the flock and walks them back toward the
  // middle of the field at half speed, so the backdrop shows a dog quietly working without driving sheep into fences.
  attractDog(dt) {
    const a = this.attractAI, dog = this.dog, f = this.flock, b = this.course.bounds;
    if (!f.n) return;
    a.t -= dt;
    const mx = b.x + b.w / 2, my = b.y + b.h / 2;
    const angle = Math.atan2(dog.y - f.y, dog.x - f.x);
    const outward = Math.atan2(f.y - my, f.x - mx);
    const flank = (target) => {
      const diff = M.angleLerp(angle, target, 1) - angle;
      a.phase = 'FLANK'; a.target = target; a.t = 6;
      dog.setCommand(diff > 0 ? 'COMEBYE' : 'AWAY', f);
      dog.flankR = 18;
    };
    if (a.phase === 'FLANK') {
      if (Math.abs(M.angleLerp(angle, a.target, 1) - angle) < 0.3 || a.t <= 0) { dog.setCommand('STOP'); a.phase = 'REST'; a.t = M.rand(2, 4); }
    } else if (a.phase === 'WALK') {
      if (a.t <= 0 || Math.hypot(dog.x - f.x, dog.y - f.y) < 13) { dog.setCommand('STOP'); a.phase = 'REST'; a.t = M.rand(5, 8); }
    } else if (a.t <= 0) {
      const off = Math.hypot(f.x - mx, f.y - my);
      if (off > 20 && Math.abs(M.angleLerp(angle, outward, 1) - angle) > 0.5) flank(outward);
      else if (off > 20) { dog.setCommand('WALK', f); a.phase = 'WALK'; a.t = 3; }
      else flank(angle + (Math.random() < 0.5 ? 1 : -1) * M.rand(1.2, 2));
    }
  }

  attractUpdate(dt) {
    this.attractT += dt;
    const c = this.course, t = this.attractT * 0.05;
    if (c.wind) c.wind.update(dt);
    this.flock = computeFlock(this.sheep);
    this.attractDog(dt);
    const w = {
      dog: this.dog, handler: this.handler, sheep: this.sheep, flock: this.flock,
      walls: c.walls(), circles: c.circles, bounds: c.bounds, ground: c.ground, wind: c.wind, events: [],
    };
    this.dog.update(dt, w);
    for (const s of this.sheep) s.update(dt, w);
    for (let i = 0; i < this.sheep.length; i++) for (let j = i + 1; j < this.sheep.length; j++) separateBodies(this.sheep[i], this.sheep[j], SHEEP_CFG.radius, SHEEP_CFG.radius);
    this.handler.update(dt, this.flock.n ? this.flock : this.dog);
    // Keep the flock (and a little of the dog) framed in the open space beside the menu (below it on an upright
    // phone), with a slow sway. A screen offset (ox, oy) from the centre is a world offset (u, v) with
    // u - v = ox / zoom and u + v = 2·oy / zoom.
    const cam = this.renderer.cam, fl = this.flock.n ? this.flock : c.start;
    const tx = fl.x + (this.dog.x - fl.x) * 0.3, ty = fl.y + (this.dog.y - fl.y) * 0.3;
    const fc = this.attractFocus || (this.attractFocus = { x: tx, y: ty });
    const k = Math.min(1, dt * 0.8);
    fc.x += (tx - fc.x) * k; fc.y += (ty - fc.y) * k;
    let ox = cam.w * 0.375, oy = 0;
    if (this.ui.current === 'maps') { ox = cam.w * (cam.w >= 900 ? 0.18 : 0.08); oy = -cam.h * 0.04; }   // the field is the picture here
    else if (cam.w >= 900) ox = (Math.min(680, cam.w * 0.45) + cam.w) / 2 - cam.w / 2;
    else if (cam.h > cam.w * 1.3) { ox = cam.w * 0.15; oy = cam.h * 0.32; }
    // Glide to the new framing when the screen changes.
    const off = this.attractOff || (this.attractOff = { x: ox, y: oy }), ko = Math.min(1, dt * 2.5);
    off.x += (ox - off.x) * ko; off.y += (oy - off.y) * ko;
    const u = (off.x + 2 * off.y) / (2 * cam.zoom), v = (2 * off.y - off.x) / (2 * cam.zoom);
    cam.x = fc.x - u + Math.sin(t * 2) * 3;
    cam.y = fc.y - v + Math.sin(t * 1.4 + 1) * 3;
  }
  // One zoom step in from 18, pulled back on small (phone) screens so enough of the field fits.
  baseZoom() {
    const cam = this.renderer.cam;
    return 18 * 1.15 * M.clamp(Math.min(cam.w, cam.h) / 700, 0.6, 1);
  }
  zoomBy(f) { const cam = this.renderer.cam; cam.zoom = M.clamp(cam.zoom * f, 7, 34); }

  frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 0.1);
    if (this.inMenu && this.course) this.attractUpdate(dt);
    else if (!this.paused && this.course) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) this.update(h);
    }
    if (this.course) {
      this.renderer.draw(this);
      this.minimap.draw(this);
      this.ui.update(dt);
      if (this.dog) this.ui.updateCommands(this.dog);
      const wind = this.course.wind;
      Sound.setWind(wind && !this.inMenu && !this.paused ? 0.15 + wind.strength * 0.85 : 0);
      Music.update(this);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    const c = this.course;
    const dir = this.input.arrowDir();
    if (dir) { this.dog.setDirect(dir[0], dir[1]); this.trial.start(); }
    else if (this.dog.command === 'DIRECT') this.dog.setDirect(0, 0);

    if (c.wind) c.wind.update(dt);
    this.flock = computeFlock(this.sheep);
    const w = {
      dog: this.dog, handler: this.handler, sheep: this.sheep, flock: this.flock,
      walls: c.walls(), circles: c.circles, bounds: c.bounds, ground: c.ground, wind: c.wind, events: this.events = [],
    };
    this.dog.update(dt, w);
    for (const s of this.sheep) s.update(dt, w);
    for (let i = 0; i < this.sheep.length; i++) for (let j = i + 1; j < this.sheep.length; j++) separateBodies(this.sheep[i], this.sheep[j], SHEEP_CFG.radius, SHEEP_CFG.radius);
    for (const s of this.sheep) separateBodies(this.dog, s, DOG_CFG.radius, SHEEP_CFG.radius, 0.2, 0.8);
    this.handler.update(dt, this.flock.n ? this.flock : this.dog);
    this.trial.update(dt, w);
    // While the gate swings shut the handler walks it closed, holding the free end.
    const pen = c.pen;
    if (pen.gateT > 0 && this.handler.holdingGate) {
      const a = M.lerp(pen.openAngle, pen.closedAngle, M.easeInOut(pen.gateT));
      const gs = pen.gateSeg();
      this.handler.x = gs.bx + Math.cos(a) * 1.2; this.handler.y = gs.by + Math.sin(a) * 1.2;
      this.handler.tx = this.handler.x; this.handler.ty = this.handler.y;
      this.handler.heading = a + Math.PI;
    }

    if (this.resetTimer > 0) { this.resetTimer -= dt; if (this.resetTimer <= 0) this.setup(); }

    // Camera follows the dog, leaning a little toward the sheep so both stay in view (less on narrow screens).
    const cam = this.renderer.cam;
    let tx = this.dog.x, ty = this.dog.y;
    if (this.flock.n) {
      let ox = this.flock.x - this.dog.x, oy = this.flock.y - this.dog.y;
      const od = Math.hypot(ox, oy), lean = Math.min(od * 0.4, 14, Math.min(cam.w, cam.h) / (cam.zoom * 4));
      if (od > 0.1) { tx += ox / od * lean; ty += oy / od * lean; }
    }
    const k = Math.min(1, dt * 3.5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
  }
}
