'use strict';
// Small inline flags for the field-choice screen (SVG rather than emoji, which Windows doesn't draw as flags).
const FLAG_SVG = {
  us: '<rect width="30" height="20" fill="#b22234"/><path d="M0 2.3h30M0 5.4h30M0 8.5h30M0 11.5h30M0 14.6h30M0 17.7h30" stroke="#fff" stroke-width="1.54"/><rect width="12" height="10.8" fill="#3c3b6e"/><g fill="#fff"><circle cx="2" cy="2" r=".6"/><circle cx="6" cy="2" r=".6"/><circle cx="10" cy="2" r=".6"/><circle cx="4" cy="5.4" r=".6"/><circle cx="8" cy="5.4" r=".6"/><circle cx="2" cy="8.8" r=".6"/><circle cx="6" cy="8.8" r=".6"/><circle cx="10" cy="8.8" r=".6"/></g>',
  si: '<rect width="30" height="20" fill="#ed1c24"/><rect width="30" height="13.3" fill="#005da4"/><rect width="30" height="6.7" fill="#fff"/><path d="M6.3 3.3h5.4v4.2q0 3.4-2.7 4.5q-2.7-1.1-2.7-4.5z" fill="#005da4" stroke="#ed1c24" stroke-width=".6"/><path d="M6.6 8.6l1.2-1.4 .6.6 .6-1.6 .6 1.6 .6-.6 1.2 1.4q-.4 2-2.4 3-2-1-2.4-3z" fill="#fff"/>',
  'gb-eng': '<rect width="30" height="20" fill="#fff"/><path d="M15 0v20M0 10h30" stroke="#ce1124" stroke-width="4"/>',
  'gb-sct': '<rect width="30" height="20" fill="#005eb8"/><path d="M0 0l30 20M30 0L0 20" stroke="#fff" stroke-width="3.6"/>',
  fi: '<rect width="30" height="20" fill="#fff"/><path d="M11 0v20M0 10h30" stroke="#002f6c" stroke-width="5.5"/>',
  jp: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>',
  it: '<rect width="30" height="20" fill="#ce2b37"/><rect width="20" height="20" fill="#f4f5f0"/><rect width="10" height="20" fill="#009246"/>',
  at: '<rect width="30" height="20" fill="#ed2939"/><rect y="6.67" width="30" height="6.67" fill="#fff"/>',
};
function flagSvg(code) {
  return FLAG_SVG[code] ? `<svg class="flag" viewBox="0 0 30 20" aria-hidden="true">${FLAG_SVG[code]}</svg>` : '';
}

// DOM HUD: status panel, command buttons, overlays.
class UI {
  constructor(game) {
    this.game = game;
    this.$ = (id) => document.getElementById(id);
    this.hud = this.$('hud');
    this.overlay = this.$('overlay');
    this.cards = { menu: this.$('menu'), maps: this.$('maps'), options: this.$('options'), help: this.$('help'), pause: this.$('pause'), result: this.$('result') };
    this.current = null;
    this.toastT = 0;
    this.pendingMode = null;
    this.faultHit = {};                     // category -> seconds left on its score flash

    // One card per field along the bottom strip, each with a plan of the field drawn once its ground is baked.
    const list = this.$('map-list');
    for (const m of MAPS) {
      const b = document.createElement('button');
      b.className = 'fs-card'; b.dataset.map = m.id;
      b.innerHTML = '<canvas class="fs-thumb"></canvas><span class="fs-card-name"></span><span class="fs-card-loc"></span>';
      b.querySelector('.fs-card-name').textContent = m.name;
      b.querySelector('.fs-card-loc').textContent = m.location;
      b.querySelector('.fs-card-loc').insertAdjacentHTML('afterbegin', flagSvg(m.flag));
      list.appendChild(b);
      // Queued behind the startup bake (prebakeGrounds), which does the current field first.
      const canvas = b.querySelector('canvas');
      setTimeout(() => slicer.add(new Ground(m).bakeSliced(), () => this.drawThumb(canvas, m)));
    }

    // Keyboard/mouse-navigable lists on the title screens.
    this.lists = {
      menu: { items: [...document.querySelectorAll('#menu .menu-item')], index: 0, select: (b) => this.setDesc('menu-desc', b.dataset.desc), activate: (b) => this.activateMenu(b) },
      maps: { items: [...list.children], index: 0, select: (b) => this.showMapInfo(b), activate: (b) => this.activateMap(b) },
      options: { items: [...document.querySelectorAll('#options .menu-item')], index: 0, select: (b) => this.setDesc('options-desc', b.dataset.desc), activate: (b) => { if (b.dataset.action === 'back') this.showCard('menu'); else if (b.dataset.toggle) this.toggleSetting(b); } },
    };
    // Volume sliders: drag with the mouse or use left/right on the selected row.
    this.previewAt = 0;
    for (const row of document.querySelectorAll('#options .opt-row[data-setting]')) {
      const range = row.querySelector('input');
      range.value = Sound.volume[row.dataset.setting];
      this.showVolume(row);
      range.addEventListener('input', () => this.setVolume(row, +range.value));
      range.addEventListener('change', () => range.blur());
      // Touch has no hover, so touching a slider selects its row (and shows its description).
      row.addEventListener('pointerdown', () => this.selectItem('options', this.lists.options.items.indexOf(row), true));
    }
    // Gameplay switches (On/Off), saved between visits like the volumes.
    this.settings = { liveJudge: false };
    try {
      const saved = JSON.parse(localStorage.getItem('sheepdog.settings') || '{}');
      for (const k of Object.keys(this.settings)) if (typeof saved[k] === 'boolean') this.settings[k] = saved[k];
    } catch (e) { /* storage unavailable */ }
    for (const row of document.querySelectorAll('#options .opt-toggle')) this.showToggle(row);
    // Menus select on hover. Field cards don't (each one swaps the backdrop): clicking a card picks it, and
    // clicking the picked card again starts.
    for (const [name, L] of Object.entries(this.lists)) L.items.forEach((b, i) => {
      b.addEventListener('click', () => {
        b.blur();
        if (name === 'maps' && L.index !== i) { this.selectItem(name, i, true); return; }
        this.activateItem(name, b);
      });
      if (name !== 'maps') b.addEventListener('mouseenter', () => this.selectItem(name, i, true));
    });
    this.$('map-start').addEventListener('click', (e) => { e.currentTarget.blur(); this.activateItem('maps', this.lists.maps.items[this.lists.maps.index]); });
    this.$('map-back').addEventListener('click', (e) => { e.currentTarget.blur(); Sound.menuSound('back'); this.showCard('menu'); });
    // Wheel over the strip scrolls it sideways.
    list.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { list.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    this.$('btn-help-back').addEventListener('click', () => this.showCard('menu'));
    window.addEventListener('keydown', (e) => this.onMenuKey(e));
    document.querySelectorAll('button.cmd').forEach(b => b.addEventListener('click', () => { game.command(b.dataset.cmd); b.blur(); }));
    document.querySelectorAll('button.zoom-btn').forEach(b => b.addEventListener('click', () => { game.zoomBy(b.dataset.zoom === 'in' ? 1.15 : 1 / 1.15); b.blur(); }));
    this.$('btn-mute').addEventListener('click', (e) => { e.currentTarget.blur(); this.toggleMute(); });
    this.showMute();
    this.$('btn-resume').addEventListener('click', () => game.resume());
    this.$('btn-restart').addEventListener('click', () => game.restart());
    this.$('btn-retire').addEventListener('click', () => game.retire());
    this.$('btn-again').addEventListener('click', () => game.restart());
    this.$('btn-menu').addEventListener('click', () => game.toMenu());
  }

  // `sound` plays the move tick, for selections the player made rather than ones set when a screen opens.
  selectItem(listName, i, sound = false) {
    const L = this.lists[listName], n = L.items.length;
    if (sound && (i + n) % n !== L.index) Sound.menuSound('move');
    L.index = (i + n) % n;
    L.items.forEach((b, j) => b.classList.toggle('selected', j === L.index));
    L.select(L.items[L.index]);
  }

  activateItem(listName, b) {
    if (b.dataset.action === 'back') Sound.menuSound('back');
    else if (listName !== 'options') Sound.menuSound('confirm');
    this.lists[listName].activate(b);
  }

  // Swap a screen's description, fading the new text in.
  setDesc(id, text) {
    const el = this.$(id);
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('desc-in');
    void el.offsetWidth; // restart the animation
    el.classList.add('desc-in');
  }

  setVolume(row, v) {
    Sound.set(row.dataset.setting, v);
    this.showMute();
    row.querySelector('input').value = Sound.volume[row.dataset.setting];
    this.showVolume(row);
    // Throttled so dragging the slider doesn't stack up test sounds.
    const now = performance.now();
    if (now - this.previewAt > 120) { this.previewAt = now; Sound.preview(row.dataset.setting); }
  }

  showVolume(row) {
    const v = Sound.volume[row.dataset.setting];
    row.querySelector('.opt-value').textContent = !v ? 'Off' : Sound.muted ? 'Muted' : `${v}%`;
    row.querySelector('input').style.setProperty('--fill', `${v}%`);
  }

  toggleSetting(row, on = !this.settings[row.dataset.toggle]) {
    this.selectItem('options', this.lists.options.items.indexOf(row));
    if (this.settings[row.dataset.toggle] === on) return;
    this.settings[row.dataset.toggle] = on;
    Sound.menuSound('move');
    this.showToggle(row);
    try { localStorage.setItem('sheepdog.settings', JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ }
  }

  showToggle(row) {
    row.querySelector('.opt-value').textContent = this.settings[row.dataset.toggle] ? 'On' : 'Off';
  }

  toggleMute() {
    Sound.toggleMute();
    this.showMute();
    for (const row of document.querySelectorAll('#options .opt-row[data-setting]')) { row.querySelector('input').value = Sound.volume[row.dataset.setting]; this.showVolume(row); }
  }

  showMute() {
    const b = this.$('btn-mute'), off = Sound.silent;
    b.classList.toggle('muted', off);
    b.setAttribute('aria-pressed', off);
    b.title = off ? 'Unmute (M)' : 'Mute (M)';
    b.setAttribute('aria-label', off ? 'Unmute' : 'Mute');
  }

  activateMenu(b) {
    if (b.dataset.action === 'help' || b.dataset.action === 'options') { this.showCard(b.dataset.action); return; }
    this.pendingMode = b.dataset.mode;
    this.$('maps-mode').textContent = b.textContent;
    this.showCard('maps');
  }

  activateMap(b) {
    this.game.selectMap(b.dataset.map);
    this.game.startMode(this.pendingMode);
  }

  // A field card's plan, fitted to the card and centred.
  drawThumb(canvas, m) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = 120, h = 144;   // CSS scales it to the card
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d'), s = Math.max(w / m.width, h / m.height) * dpr;
    ctx.setTransform(s, 0, 0, s, (canvas.width - m.width * s) / 2, (canvas.height - m.height * s) / 2);
    drawFieldPlan(ctx, buildCourse(m));
  }

  // Picking a field shows its details, swaps the backdrop to it and brings its card to the middle of the strip.
  showMapInfo(b) {
    const m = mapById(b.dataset.map);
    this.game.selectMap(m.id);
    const outrun = Math.round(Math.hypot(m.sheepStart.x - m.post.x, m.sheepStart.y - m.post.y));
    const t = m.terrain || {};
    let ground = t.relief && t.relief.tilt ? `Rises ${Math.round(t.relief.tilt * m.height)} m` : t.relief ? 'Rolling' : 'Flat';
    if (t.relief && t.relief.tiltX) ground += `, ${Math.round(Math.abs(t.relief.tiltX) * m.width)} m across`;
    this.$('map-name').textContent = m.name;
    this.$('map-loc').textContent = m.location;
    this.$('map-loc').insertAdjacentHTML('afterbegin', flagSvg(m.flag));
    this.$('map-desc').textContent = m.sheep ? `${m.blurb} Sheep: ${m.sheep.breed}, ${m.sheep.note}.` : m.blurb;
    const stats = [['Field', `${m.width} × ${m.height} m`], ['Outrun', `${outrun} m`], ['Ground', ground], this.pendingMode === 'pasture' ? ['Flock', `2 × ${PASTURE_SHEEP} sheep`] : ['Time limit', M.fmtTime(m.timeLimit)], ['Sheep', sheepTemperamentWord(m.sheep)]];
    this.$('map-stats').replaceChildren(...stats.map(([label, value]) => {
      const d = document.createElement('div'); d.className = 'stat';
      d.innerHTML = '<span class="stat-label"></span><span class="stat-value"></span>';
      d.firstChild.textContent = label; d.lastChild.textContent = value;
      return d;
    }));
    const info = this.$('fs-info');
    info.classList.remove('desc-in'); void info.offsetWidth; info.classList.add('desc-in');
    const list = this.$('map-list');
    list.scrollTo({ left: b.offsetLeft - (list.clientWidth - b.offsetWidth) / 2, behavior: this.snapStrip ? 'auto' : 'smooth' });
  }

  // Arrow / Enter navigation on the title screens; Esc backs out of field choice, Options and How to Play.
  onMenuKey(e) {
    // On the result card Enter runs again and Esc goes to the menu (otherwise Esc would only unpause).
    if (this.current === 'result' && (e.code === 'Escape' || e.code === 'Enter')) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.code === 'Enter') this.game.restart(); else this.game.toMenu();
      return;
    }
    if (['help', 'maps', 'options'].includes(this.current) && (e.code === 'Escape' || e.code === 'Backspace')) { e.preventDefault(); Sound.menuSound('back'); this.showCard('menu'); return; }
    const L = this.lists[this.current];
    if (!L) return;
    const across = this.current === 'maps';
    if (across && (e.code === 'ArrowLeft' || e.code === 'KeyA')) { e.preventDefault(); this.selectItem('maps', L.index - 1, true); }
    else if (across && (e.code === 'ArrowRight' || e.code === 'KeyD')) { e.preventDefault(); this.selectItem('maps', L.index + 1, true); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); this.selectItem(this.current, L.index - 1, true); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); this.selectItem(this.current, L.index + 1, true); }
    else if (this.current === 'options' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD')) {
      e.preventDefault();
      const row = L.items[L.index];
      const right = e.code === 'ArrowRight' || e.code === 'KeyD';
      if (row.dataset.setting) this.setVolume(row, Sound.volume[row.dataset.setting] + (right ? 5 : -5));
      else if (row.dataset.toggle) this.toggleSetting(row, right);
    }
    else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); this.activateItem(this.current, L.items[L.index]); }
  }

  showCard(name) {
    this.current = name;
    if (name === 'options') this.selectItem('options', this.lists.options.index);
    if (name === 'menu') {
      this.selectItem('menu', this.lists.menu.index);
      this.$('menu-field').textContent = `Today's field · ${mapById(this.game.mapId).name}`;
    }
    for (const [k, el] of Object.entries(this.cards)) el.classList.toggle('hidden', k !== name);
    // After the screen is shown, so the strip has a size to centre the card in.
    if (name === 'maps') {
      this.snapStrip = true;
      this.selectItem('maps', Math.max(0, MAPS.findIndex(m => m.id === this.game.mapId)));
      this.snapStrip = false;
    }
    if (name === 'pause') this.fillPause();
    const title = ['menu', 'help', 'maps', 'options'].includes(name);
    this.overlay.classList.toggle('hidden', !name);
    this.hud.classList.toggle('hidden', title);
    this.overlay.classList.toggle('title', title);
    this.overlay.classList.toggle('fields', name === 'maps');
    this.overlay.classList.toggle('run', name === 'pause' || name === 'result');
  }

  toast(text) {
    const el = this.$('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.opacity = 1;
    this.toastT = 2.4;
  }

  update(dt) {
    const g = this.game, t = g.trial;
    if (this.toastT > 0) {
      this.toastT -= dt;
      const el = this.$('toast');
      if (this.toastT < 0.4) el.style.opacity = Math.max(0, this.toastT / 0.4);
      if (this.toastT <= 0) el.classList.add('hidden');
    }
    if (!t) return;
    // With the live judge off the run shows no scores or faults until it ends.
    const live = this.settings.liveJudge;
    if (live) this.updateFaults(t, dt); else this.$('faults').replaceChildren();
    this.updateFlockPointer(g);
    const modeEl = this.$('hud-mode');
    modeEl.textContent = modeEl.title = `${MODE_NAMES[g.mode]} · ${g.course.map.name}`;
    const timeEl = this.$('hud-time');
    timeEl.classList.toggle('hidden', t.pasture);
    if (t.pasture) {
      this.$('hud-phase').textContent = 'Pasture';
      this.$('hud-hint').textContent = `Two mobs of ${PASTURE_SHEEP} on open ground. No course, no clock – work them however you like.`;
      this.$('hud-score').innerHTML = '';
      return;
    }
    if (g.mode === 'trial') {
      timeEl.textContent = M.fmtTime(t.timeLeft);
      timeEl.classList.toggle('warn', t.timeLeft < 60);
    } else timeEl.textContent = M.fmtTime(t.time);

    if (g.mode === 'pen') {
      this.$('hud-phase').textContent = t.result ? 'Penned!' : 'Pen the sheep';
      this.$('hud-hint').textContent = `Pens: ${g.drillStats.count} · Best: ${g.drillStats.best == null ? '–' : M.fmtTime(g.drillStats.best)} · Breaks this run: ${Math.round(t.deductions.PEN)}`;
      this.$('hud-score').innerHTML = '';
      return;
    }
    const drill = g.drill;
    this.$('hud-phase').textContent = t.result && drill ? 'Done – resetting' : t.started ? t.info.title : drill ? `Ready: ${t.info.title.toLowerCase()}` : 'Ready at the post';
    this.$('hud-hint').textContent = t.started || drill ? t.info.hint : 'Send the dog with a command or the arrow keys to start the clock.';
    // Finished sections show their score, the one being worked is marked as still being judged, later ones are blank.
    // Until the run ends the bottom line is the most it can still score, which only ever goes down.
    let rows = '';
    if (live || t.result) for (const cat of t.categories) {
      const active = !t.result && t.category === cat;
      const val = t.reached.has(cat) ? t.score(cat).toFixed(1) : '–';
      const cls = [active ? 'active' : '', this.faultHit[cat] > 0 ? 'hit' : ''].join(' ');
      rows += `<tr class="${cls}"><td>${CAT_LABEL[cat]}${active ? ' <span class="judging">judging</span>' : ''}</td><td>${val} / ${POINTS[cat]}</td></tr>`;
    }
    if (live || t.result) rows += t.result
      ? `<tr class="total"><td>Total</td><td>${t.total().toFixed(1)} / ${t.maxPoints}</td></tr>`
      : `<tr class="total"><td>Still possible</td><td>${t.possible().toFixed(1)} / ${t.maxPoints}</td></tr>`;
    if (drill) {
      const st = g.drillStats;
      rows += `<tr class="stats"><td>Runs ${st.count}</td><td>Best ${st.best == null ? '–' : st.best.toFixed(1)}</td></tr>`;
    }
    this.$('hud-score').innerHTML = rows;
  }

  // Faults as they happen: a chip under the status panel per fault, counting up while it keeps costing points,
  // and a short flash on that section's score.
  updateFaults(t, dt) {
    const box = this.$('faults');
    if (this.faultTrial !== t) { this.faultTrial = t; this.faultShown = new Map(); this.faultChips = new Map(); box.replaceChildren(); }
    for (const k of Object.keys(this.faultHit)) this.faultHit[k] -= dt;
    for (const [key, n] of t.notes) {
      const shown = this.faultShown.get(key) || 0;
      if (n.pts - shown < 0.05) continue;
      let chip = this.faultChips.get(key);
      // A new chip only once a fault is worth showing; a live one just counts up.
      if (!chip && n.pts - shown < 0.3) continue;
      if (!chip) {
        chip = { el: document.createElement('div'), base: shown };
        chip.el.className = 'fault';
        chip.el.innerHTML = '<b></b><span></span>';
        chip.el.lastChild.textContent = `${CAT_LABEL[n.cat]}: ${n.reason}`;
        box.prepend(chip.el);
        this.faultChips.set(key, chip);
        while (box.children.length > 3) box.lastChild.remove();
      }
      chip.el.firstChild.textContent = `−${(n.pts - chip.base).toFixed(1)}`;
      chip.t = 2.6;
      chip.el.classList.remove('bump'); void chip.el.offsetWidth; chip.el.classList.add('bump');
      this.faultShown.set(key, n.pts);
      this.faultHit[n.cat] = 0.6;
    }
    if (this.faultChips.size) { const st = this.$('status'); box.style.top = `${st.offsetTop + st.offsetHeight + 8}px`; }
    for (const [key, chip] of this.faultChips) {
      chip.t -= dt;
      if (chip.t < 0.4) chip.el.style.opacity = Math.max(0, chip.t / 0.4);
      else chip.el.style.opacity = '';
      if (chip.t <= 0 || !chip.el.isConnected) { chip.el.remove(); this.faultChips.delete(key); }
    }
  }

  // A triangle on the screen edge pointing toward the flock while it's out of view (not in pasture).
  updateFlockPointer(g) {
    const el = this.$('flock-pointer'), f = g.flock, cam = g.renderer.cam;
    const show = f && f.n && !g.paused && !(g.trial && (g.trial.result || g.trial.pasture));
    const [sx, sy] = show ? cam.toScreen(f.x, f.y) : [0, 0];
    const pad = 24;
    if (!show || (sx > pad && sy > pad && sx < cam.w - pad && sy < cam.h - pad)) { el.classList.add('hidden'); return; }
    const cx = cam.w / 2, cy = cam.h / 2, dx = sx - cx, dy = sy - cy;
    const m = 44, kx = (cx - m) / Math.abs(dx || 1e-6), ky = (cy - m) / Math.abs(dy || 1e-6), k = Math.min(kx, ky);
    let px = cx + dx * k, py = cy + dy * k;
    // Keep clear of the HUD panels by sliding along the edge it sits on.
    const onSide = kx < ky, gap = 30;
    for (const id of ['status', 'commands', 'minimap-wrap']) {
      const r = this.$(id).getBoundingClientRect();
      if (!r.width || px < r.left - gap || px > r.right + gap || py < r.top - gap || py > r.bottom + gap) continue;
      if (onSide) py = r.top - gap > m && (r.bottom + gap > cam.h - m || py - r.top < r.bottom - py) ? r.top - gap : r.bottom + gap;
      else px = r.left - gap > m && (r.right + gap > cam.w - m || px - r.left < r.right - px) ? r.left - gap : r.right + gap;
    }
    el.classList.remove('hidden');
    el.style.transform = `translate(${px}px, ${py}px)`;
    el.firstChild.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }

  updateCommands(dog) {
    document.querySelectorAll('button.cmd').forEach(b => {
      const c = b.dataset.cmd;
      if (c === 'STEADY') b.classList.toggle('on', dog.steady);
      else b.classList.toggle('active', dog.command === c);
    });
  }

  // A command was given: its button pulses and the panel wakes from its idle fade for a moment.
  pulseCommand(cmd) {
    const b = document.querySelector(`button.cmd[data-cmd="${cmd}"]`);
    if (b) { b.classList.remove('sent'); void b.offsetWidth; b.classList.add('sent'); }
    const panel = this.$('commands');
    panel.classList.add('awake');
    clearTimeout(this.awakeTimer);
    this.awakeTimer = setTimeout(() => panel.classList.remove('awake'), 1500);
  }

  fillPause() {
    const g = this.game, t = g.trial;
    this.$('pause-eyebrow').textContent = `${MODE_NAMES[g.mode]} · ${g.course.map.name}`;
    if (!t || t.pasture) { this.$('pause-sub').textContent = t ? `${g.sheep.length} sheep, no clock` : ''; return; }
    const clock = g.mode === 'trial' ? `${M.fmtTime(t.timeLeft)} left` : M.fmtTime(t.time);
    const parts = [t.started ? t.info.title : 'Not started', clock];
    if (g.mode !== 'pen' && this.settings.liveJudge) parts.push(`${t.possible().toFixed(1)} of ${t.maxPoints} still possible`);
    this.$('pause-sub').textContent = parts.join(' · ');
  }

  showResult(trial, game) {
    const r = trial.result;
    this.$('result-eyebrow').textContent = `${MODE_NAMES[game.mode]} · ${game.course.map.name}`;
    this.$('result-title').textContent = { COMPLETE: 'Run complete', TIME: 'Time called', RETIRED: 'Retired' }[r.outcome];
    this.$('result-sub').textContent = `${M.fmtTime(r.time)} on the clock` + (r.outcome === 'TIME' ? ' · the sheep were not penned before time ran out' : '');
    this.$('result-max').textContent = ` / ${trial.maxPoints}`;
    this.$('result-table').replaceChildren(...trial.categories.map((cat) => {
      const row = document.createElement('div');
      row.className = 'rrow';
      row.innerHTML = '<span class="rname"></span><span class="rbar"><i></i></span><span class="rval"></span>';
      const tag = !trial.reached.has(cat) ? 'not reached' : cat === trial.unfinished ? 'unfinished' : '';
      row.querySelector('.rname').innerHTML = CAT_LABEL[cat] + (tag ? ` <small>${tag}</small>` : '');
      row.querySelector('.rval').textContent = `${trial.score(cat).toFixed(1)} / ${POINTS[cat]}`;
      row.querySelector('i').dataset.w = `${trial.score(cat) / POINTS[cat] * 100}%`;
      return row;
    }));
    const notes = [...trial.notes.values()].sort((a, b) => b.pts - a.pts);
    const empty = r.outcome === 'COMPLETE' ? 'A clean run. The judge has nothing to say.' : 'No faults before the run ended.';
    this.$('result-notes').innerHTML = notes.length
      ? notes.map(n => `<li><span>${CAT_LABEL[n.cat]}: ${n.reason}</span><b>−${n.pts.toFixed(1)}</b></li>`).join('')
      : `<li>${empty}</li>`;
    this.showCard('result');
    // The total counts up and the bars fill once the card is on screen.
    const total = trial.total(), el = this.$('result-total'), t0 = performance.now();
    const tick = (now) => {
      const k = M.clamp((now - t0) / 900, 0, 1);
      el.textContent = (total * (1 - Math.pow(1 - k, 3))).toFixed(1);
      if (k < 1 && this.current === 'result') requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // Two frames: the bars must be laid out at zero width first for their fill to animate.
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const i of this.$('result-table').querySelectorAll('i')) i.style.width = i.dataset.w; }));
  }
}
