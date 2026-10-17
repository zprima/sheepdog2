'use strict';
// Audio settings and mixer: separate music and sound-effect volumes (0–100), saved between visits.
// Anything that plays sound should connect to Sound.bus('music') or Sound.bus('sfx').
const Sound = {
  volume: { music: 0, sfx: 10 },  // music off and effects quiet until the player turns them up in Options
  muted: false,                   // the in-run mute button: silences both buses without touching the volumes
  ctx: null,
  buses: {},

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem('sheepdog.audio') || '{}');
      for (const k of Object.keys(this.volume)) if (Number.isFinite(saved[k])) this.volume[k] = M.clamp(saved[k], 0, 100);
      this.muted = saved.muted === true;
    } catch (e) { /* storage unavailable */ }
  },

  set(kind, v) {
    this.volume[kind] = M.clamp(Math.round(v), 0, 100);
    if (this.volume[kind] > 0) this.muted = false; // turning a slider up is a clear wish to hear it
    this.apply();
  },

  // True when nothing would be heard, whether muted or with both sliders at zero.
  get silent() { return this.muted || Object.values(this.volume).every(v => v <= 0); },

  toggleMute() {
    if (this.silent && !this.muted) this.volume.sfx = 10; // both sliders were down: unmuting brings the effects back
    else this.muted = !this.muted;
    if (!this.muted) this.bus('sfx');                     // the click is a user gesture, so audio may start now
    this.apply();
  },

  apply() {
    for (const k of Object.keys(this.buses)) this.buses[k].gain.value = this.muted ? 0 : this.volume[k] / 100;
    try { localStorage.setItem('sheepdog.audio', JSON.stringify({ ...this.volume, muted: this.muted })); } catch (e) { /* storage unavailable */ }
  },

  // Web Audio starts lazily (browsers only allow it after a user gesture); each kind gets its own gain bus.
  bus(kind) {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      for (const k of Object.keys(this.volume)) {
        const g = this.ctx.createGain();
        g.gain.value = this.muted ? 0 : this.volume[k] / 100;
        g.connect(this.ctx.destination);
        this.buses[k] = g;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.buses[kind];
  },

  // Short test sound on the given bus (a whistle for effects) so a slider can be heard while it's adjusted.
  preview(kind) {
    if (kind === 'sfx') { this.whistle('WALK'); return; }
    if (Music.active) return; // the music itself is playing, so the slider can be heard on it
    const out = this.bus(kind);
    if (!out) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440;
    const len = 0.35;
    env.gain.setValueAtTime(0.25, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(env).connect(out);
    osc.start(t); osc.stop(t + len);
  },

  // Menu feedback on the effects bus: a soft wooden tick for moving the selection, a short rising pip to confirm,
  // a falling one to go back. Silent until the page has had a click or key press, since audio can't start before.
  menuSound(kind) {
    if (!this.ctx && !(navigator.userActivation && navigator.userActivation.hasBeenActive)) return;
    const out = this.bus('sfx');
    if (!out) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    const [f0, f1, len, level] = { move: [1250, 950, 0.05, 0.12], confirm: [1400, 2600, 0.13, 0.16], back: [1700, 1100, 0.1, 0.12] }[kind];
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = kind === 'move' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + len);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(env).connect(out);
    osc.start(t); osc.stop(t + len + 0.01);
  },

  // Shepherd's whistle for a dog command, played on the effects bus. Synthesised rather than sampled; the
  // pitch contours are traced from a stockdog handler's whistle demonstration (see WHISTLES).
  whistle(cmd) {
    const pattern = WHISTLES[cmd];
    const out = pattern && this.bus('sfx');
    if (!out) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.01;
    // A new command cuts off the one still sounding, as a handler would.
    if (this.lastWhistle) {
      const g = this.lastWhistle.gain;
      g.cancelScheduledValues(t0); g.setValueAtTime(g.value, t0); g.linearRampToValueAtTime(0, t0 + 0.03);
    }
    const voice = ctx.createGain();
    voice.connect(out);
    this.lastWhistle = voice;

    for (const blast of pattern.blasts) {
      const t = t0 + blast[0][0], end = t0 + blast[blast.length - 1][0];
      // A pure tone gliding through the traced pitch points.
      const osc = ctx.createOscillator(), env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(blast[0][1], t);
      for (const [at, hz] of blast.slice(1)) osc.frequency.linearRampToValueAtTime(hz, t0 + at);
      // Sharp attack, then the traced loudness (third value, default full), then a quick cut-off.
      env.gain.setValueAtTime(0, t);
      blast.forEach(([at, , level = 1], i) => env.gain.linearRampToValueAtTime(0.35 * level, i ? t0 + at : t + 0.012));
      env.gain.linearRampToValueAtTime(0, end + 0.02);
      osc.connect(env).connect(voice);
      osc.start(t); osc.stop(end + 0.03);
      // A faint breath edge at the onset only, so the tone itself stays clean.
      const noise = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
      noise.buffer = this.noiseBuffer();
      bp.type = 'bandpass'; bp.Q.value = 6; bp.frequency.value = blast[0][1];
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.04, t + 0.01);
      ng.gain.linearRampToValueAtTime(0, t + 0.06);
      noise.connect(bp).connect(ng).connect(voice);
      noise.start(t); noise.stop(t + 0.07);
    }
  },

  // Wind roaring across the field: looped noise through a low-pass filter on the effects bus. `level` 0..1
  // follows the gusts; 0 fades it out. Waits for audio to have been started by something else (a whistle).
  setWind(level) {
    if (!this.ctx || (!this.windGain && level <= 0)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.windGain) {
      const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.noiseBuffer(); src.loop = true;
      lp.type = 'lowpass'; lp.Q.value = 2.5;
      g.gain.value = 0;
      src.connect(lp).connect(g).connect(this.buses.sfx);
      src.start();
      this.windGain = g; this.windFilter = lp;
    }
    this.windGain.gain.setTargetAtTime(level > 0 ? 0.03 + level * 0.12 : 0, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(250 + level * 700, t, 0.3);
  },

  noiseBuffer() {
    if (!this.noise) {
      const len = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, len, len), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
  },
};

// Whistle patterns per dog command. Each blast is a contour of [time s, Hz, loudness 0–1 (default 1)] points from
// the start of the whistle. Away, Come bye, Walk up, That'll do ("come here") and Lie down follow the contours
// measured from Moura Stock Dogs' "Whistle commands for our Stock dogs". Steady and Get out have no whistle.
const WHISTLES = {
  // Two rising-falling humps, the second higher and held, trailing off low: "wheeoo-wheeeeoo".
  AWAY: { blasts: [[[0, 1590, 0.1], [0.04, 1370, 0.5], [0.09, 1340, 1], [0.12, 1500, 0.7], [0.15, 2440, 0.4],
    [0.19, 2670, 1], [0.23, 2580, 0.9], [0.28, 2300, 0.7], [0.31, 1980, 0.8], [0.35, 1720, 0.8], [0.39, 1500, 0.9],
    [0.41, 1510, 0.8], [0.44, 1820, 0.3], [0.47, 2470, 0.4], [0.49, 2870, 0.6], [0.55, 3000, 1], [0.6, 2960, 1],
    [0.68, 2870, 0.9], [0.71, 2850, 0.7], [0.75, 2580, 0.5], [0.79, 2380, 0.4], [0.81, 1980, 0.4], [0.84, 1820, 0.5],
    [0.87, 1660, 0.6], [0.91, 1510, 0.5], [0.95, 1410, 0.4], [0.99, 1210, 0.25], [1.01, 1140, 0.12], [1.04, 1140, 0.02]]] },
  // High note that fades as it sags, a short silence, then a low note held and falling away: "wheee … ooo".
  COMEBYE: { blasts: [
    [[0, 3620, 0.5], [0.03, 3650, 1], [0.06, 3700, 1], [0.13, 3660, 1], [0.16, 3750, 0.9], [0.19, 3590, 0.4],
      [0.21, 3490, 0.2], [0.23, 3120, 0.05]],
    [[0.3, 1380, 0.25], [0.33, 1390, 0.7], [0.37, 1405, 1], [0.46, 1420, 1], [0.49, 1385, 0.7], [0.53, 1300, 0.45],
      [0.57, 1220, 0.35], [0.61, 1150, 0.35], [0.65, 1090, 0.2], [0.69, 1055, 0.15], [0.72, 1030, 0.05]]] },
  // Two low pips that flick up at the end.
  WALK: { blasts: [[[0, 1350], [0.08, 1400], [0.12, 2700]], [[0.29, 1350], [0.37, 1400], [0.41, 2700]]] },
  // Quick rise into one long, very high, steady blast.
  STOP: { blasts: [[[0, 2500], [0.05, 3100], [0.1, 3800], [0.16, 4000], [0.5, 4100], [1.0, 4200]]] },
  // Short low note, rise, long fall back down, then a quick swoop up high.
  HOME: { blasts: [[[0, 1210, 0.3], [0.02, 1210, 0.6], [0.05, 1210, 1], [0.07, 1230, 0.6], [0.09, 1730, 0.5],
    [0.13, 2590, 0.5], [0.15, 2770, 1], [0.18, 2770, 1], [0.2, 2740, 0.8], [0.23, 2580, 0.4], [0.25, 2290, 0.4],
    [0.27, 2050, 0.35], [0.31, 1850, 0.35], [0.35, 1660, 0.5], [0.39, 1535, 0.5], [0.43, 1430, 0.45], [0.47, 1350, 0.4],
    [0.5, 1280, 0.35], [0.55, 1220, 0.4], [0.57, 1210, 0.45], [0.61, 1210, 0.4], [0.63, 1290, 0.35], [0.65, 1360, 0.3],
    [0.67, 1750, 0.3], [0.68, 2300, 0.3], [0.71, 2900, 0.3], [0.73, 3000, 0.3], [0.75, 3590, 0.3], [0.77, 4090, 0.4],
    [0.79, 4110, 0.2], [0.81, 4180, 0.02]]] },
};
Sound.load();
