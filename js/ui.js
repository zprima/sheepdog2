'use strict';
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

    // One button per field, then Back.
    const list = this.$('map-list');
    for (const m of MAPS) {
      const b = document.createElement('button');
      b.className = 'menu-item map-item'; b.dataset.map = m.id;
      b.innerHTML = `<span class="mi-name"></span><span class="mi-loc"></span>`;
      b.querySelector('.mi-name').textContent = m.name;
      b.querySelector('.mi-loc').textContent = m.location;
      list.appendChild(b);
    }
    const back = document.createElement('button');
    back.className = 'menu-item map-item map-back'; back.dataset.action = 'back'; back.textContent = 'Back';
    list.appendChild(back);
    // Every blurb sits stacked in one grid cell so the box is always as tall as the longest.
    this.$('map-desc').replaceChildren(...[...MAPS.map((m) => [m.id, m.sheep ? `${m.blurb} Sheep: ${m.sheep.breed}, ${m.sheep.note}.` : m.blurb]), ['back', 'Back to the mode menu.']].map(([id, text]) => {
      const s = document.createElement('span'); s.dataset.map = id; s.textContent = text;
      return s;
    }));

    // Keyboard/mouse-navigable lists on the title screens.
    this.lists = {
      menu: { items: [...document.querySelectorAll('#menu .menu-item')], index: 0, select: (b) => { this.$('menu-desc').textContent = b.dataset.desc; }, activate: (b) => this.activateMenu(b) },
      maps: { items: [...list.children], index: 0, select: (b) => this.showMapInfo(b), activate: (b) => this.activateMap(b) },
      options: { items: [...document.querySelectorAll('#options .menu-item')], index: 0, select: (b) => { this.$('options-desc').textContent = b.dataset.desc; }, activate: (b) => { if (b.dataset.action === 'back') this.showCard('menu'); } },
    };
    // Volume sliders: drag with the mouse or use left/right on the selected row.
    this.previewAt = 0;
    for (const row of document.querySelectorAll('#options .opt-row')) {
      const range = row.querySelector('input');
      range.value = Sound.volume[row.dataset.setting];
      this.showVolume(row);
      range.addEventListener('input', () => this.setVolume(row, +range.value));
      range.addEventListener('change', () => range.blur());
    }
    // On touch there is no hover, so the first tap on a field only shows it; a second tap starts.
    for (const [name, L] of Object.entries(this.lists)) L.items.forEach((b, i) => {
      // Recorded on pointerdown, before the emulated mouseenter of a tap selects the item.
      let firstTap = false;
      b.addEventListener('pointerdown', (e) => { firstTap = e.pointerType !== 'mouse' && L.index !== i; });
      b.addEventListener('click', () => {
        b.blur();
        if (firstTap && name === 'maps' && !b.dataset.action) { firstTap = false; this.selectItem(name, i); return; }
        L.activate(b);
      });
      b.addEventListener('mouseenter', () => this.selectItem(name, i));
    });
    this.$('map-start').addEventListener('click', (e) => { e.currentTarget.blur(); this.activateMap(this.lists.maps.items[this.lists.maps.index]); });
    this.$('btn-help-back').addEventListener('click', () => this.showCard('menu'));
    window.addEventListener('keydown', (e) => this.onMenuKey(e));
    document.querySelectorAll('button.cmd').forEach(b => b.addEventListener('click', () => { game.command(b.dataset.cmd); b.blur(); }));
    document.querySelectorAll('button.zoom-btn').forEach(b => b.addEventListener('click', () => { game.zoomBy(b.dataset.zoom === 'in' ? 1.15 : 1 / 1.15); b.blur(); }));
    this.$('btn-resume').addEventListener('click', () => game.resume());
    this.$('btn-restart').addEventListener('click', () => game.restart());
    this.$('btn-retire').addEventListener('click', () => game.retire());
    this.$('btn-again').addEventListener('click', () => game.restart());
    this.$('btn-menu').addEventListener('click', () => game.toMenu());
  }

  selectItem(listName, i) {
    const L = this.lists[listName], n = L.items.length;
    L.index = (i + n) % n;
    L.items.forEach((b, j) => b.classList.toggle('selected', j === L.index));
    L.select(L.items[L.index]);
  }

  setVolume(row, v) {
    Sound.set(row.dataset.setting, v);
    row.querySelector('input').value = Sound.volume[row.dataset.setting];
    this.showVolume(row);
    // Throttled so dragging the slider doesn't stack up test sounds.
    const now = performance.now();
    if (now - this.previewAt > 120) { this.previewAt = now; Sound.preview(row.dataset.setting); }
  }

  showVolume(row) {
    const v = Sound.volume[row.dataset.setting];
    row.querySelector('.opt-value').textContent = v ? `${v}%` : 'Off';
    row.querySelector('input').style.setProperty('--fill', `${v}%`);
  }

  activateMenu(b) {
    if (b.dataset.action === 'help' || b.dataset.action === 'options') { this.showCard(b.dataset.action); return; }
    this.pendingMode = b.dataset.mode;
    this.$('maps-mode').textContent = b.textContent;
    this.showCard('maps');
  }

  activateMap(b) {
    if (b.dataset.action === 'back') { this.showCard('menu'); return; }
    this.game.selectMap(b.dataset.map);
    this.game.startMode(this.pendingMode);
  }

  showMapDesc(id) {
    for (const s of this.$('map-desc').children) s.classList.toggle('active', s.dataset.map === id);
  }

  // Highlighting a field shows its details and swaps the backdrop to it.
  showMapInfo(b) {
    if (b.dataset.action === 'back') {
      this.$('map-loc').textContent = '';
      this.showMapDesc('back');
      this.$('map-stats').classList.add('hidden-keep');
      this.$('map-start').textContent = 'Back to modes';
      return;
    }
    const m = mapById(b.dataset.map);
    this.game.selectMap(m.id);
    const outrun = Math.round(Math.hypot(m.sheepStart.x - m.post.x, m.sheepStart.y - m.post.y));
    const t = m.terrain || {};
    let ground = t.relief && t.relief.tilt ? `Rises ${Math.round(t.relief.tilt * m.height)} m` : t.relief ? 'Rolling' : 'Flat';
    if (t.relief && t.relief.tiltX) ground += `, ${Math.round(Math.abs(t.relief.tiltX) * m.width)} m across`;
    this.$('map-loc').textContent = m.location;
    this.showMapDesc(m.id);
    this.$('map-stats').classList.remove('hidden-keep');
    this.$('map-start').textContent = `Start at ${m.name}`;
    const stats = [['Field', `${m.width} × ${m.height} m`], ['Outrun', `${outrun} m`], ['Ground', ground], ['Time limit', M.fmtTime(m.timeLimit)], ['Sheep', sheepTemperamentWord(m.sheep)]];
    const el = this.$('map-stats');
    el.replaceChildren(...stats.map(([label, value]) => {
      const d = document.createElement('div'); d.className = 'stat';
      d.innerHTML = '<span class="stat-label"></span><span class="stat-value"></span>';
      d.firstChild.textContent = label; d.lastChild.textContent = value;
      return d;
    }));
  }

  // Arrow / Enter navigation on the title screens; Esc backs out of field choice, Options and How to Play.
  onMenuKey(e) {
    if (['help', 'maps', 'options'].includes(this.current) && (e.code === 'Escape' || e.code === 'Backspace')) { e.preventDefault(); this.showCard('menu'); return; }
    const L = this.lists[this.current];
    if (!L) return;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); this.selectItem(this.current, L.index - 1); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); this.selectItem(this.current, L.index + 1); }
    else if (this.current === 'options' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD')) {
      e.preventDefault();
      const row = L.items[L.index];
      if (row.dataset.setting) this.setVolume(row, Sound.volume[row.dataset.setting] + (e.code === 'ArrowRight' || e.code === 'KeyD' ? 5 : -5));
    }
    else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); L.activate(L.items[L.index]); }
  }

  showCard(name) {
    this.current = name;
    if (name === 'menu') this.selectItem('menu', this.lists.menu.index);
    if (name === 'maps') this.selectItem('maps', Math.max(0, MAPS.findIndex(m => m.id === this.game.mapId)));
    for (const [k, el] of Object.entries(this.cards)) el.classList.toggle('hidden', k !== name);
    const title = ['menu', 'help', 'maps', 'options'].includes(name);
    this.overlay.classList.toggle('hidden', !name);
    this.hud.classList.toggle('hidden', title);
    this.overlay.classList.toggle('title', title);
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
    this.$('hud-mode').textContent = `${MODE_NAMES[g.mode]} · ${g.course.map.name}`;
    const timeEl = this.$('hud-time');
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
    let rows = '';
    for (const cat of t.categories) {
      const active = t.category === cat;
      const val = t.reached.has(cat) ? t.score(cat).toFixed(1) : '–';
      rows += `<tr class="${active ? 'active' : ''}"><td>${CAT_LABEL[cat]}</td><td>${val} / ${POINTS[cat]}</td></tr>`;
    }
    rows += `<tr class="total"><td>Total</td><td>${t.total().toFixed(1)} / ${t.maxPoints}</td></tr>`;
    if (drill) {
      const st = g.drillStats;
      rows += `<tr class="stats"><td>Runs ${st.count}</td><td>Best ${st.best == null ? '–' : st.best.toFixed(1)}</td></tr>`;
    }
    this.$('hud-score').innerHTML = rows;
  }

  updateCommands(dog) {
    document.querySelectorAll('button.cmd').forEach(b => {
      const c = b.dataset.cmd;
      if (c === 'STEADY') b.classList.toggle('on', dog.steady);
      else b.classList.toggle('active', dog.command === c);
    });
  }

  showResult(trial, game) {
    const r = trial.result;
    const title = { COMPLETE: 'Run complete', TIME: 'Time called', RETIRED: 'Retired' }[r.outcome];
    this.$('result-title').textContent = title;
    this.$('result-sub').textContent = `${game.course.map.name} · ${M.fmtTime(r.time)}` + (r.outcome === 'TIME' ? ' · the sheep were not penned before time ran out' : '');
    let rows = '';
    for (const cat of trial.categories) {
      const reached = trial.reached.has(cat);
      rows += `<tr><td>${CAT_LABEL[cat]}${reached ? '' : ' <small>(not reached)</small>'}</td><td>${trial.score(cat).toFixed(1)} / ${POINTS[cat]}</td></tr>`;
    }
    rows += `<tr class="total"><td>Total</td><td>${trial.total().toFixed(1)} / ${trial.maxPoints}</td></tr>`;
    this.$('result-table').innerHTML = rows;
    const notes = [...trial.notes.values()].sort((a, b) => b.pts - a.pts);
    this.$('result-notes').innerHTML = notes.length
      ? notes.map(n => `<li>${CAT_LABEL[n.cat]}: ${n.reason} (−${n.pts.toFixed(1)})</li>`).join('')
      : '<li>A clean run. The judge has nothing to say.</li>';
    this.showCard('result');
  }
}
