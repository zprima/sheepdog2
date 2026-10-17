'use strict';
// Background music, synthesised on the music bus like the whistles and wind: no audio files.
// Each field has a style (MUSIC_STYLES): a tempo, scale, chord loop and a set of instruments. A melody is
// generated once per style from a fixed seed, so a field always plays the same tune.
// The menu screens play their own theme (MUSIC_STYLES.menu); a field's style starts when a run is set up.
// Layers: a bed of held chords (or a drone) and a lead melody that plays every other phrase while the field is
// quiet; once the trial is under way the tempo picks up, the lead plays every phrase and a rhythm section (work
// layer) fades in, with a fill at the end of every other phrase.
// The music ducks under whistles, is muffled while paused, and a short sting marks the end of a run.
const Music = {
  cur: null,        // the playing style instance
  LOOKAHEAD: 0.3,   // seconds of notes scheduled ahead of the audio clock

  get active() { return !!this.cur; },

  // Called every frame. Does nothing until audio has been started by a user gesture, and the chain (reverb
  // included) isn't built until the music volume is first turned up.
  update(game) {
    if (!Sound.ctx || (!this.mix && Sound.volume.music <= 0)) return;
    this.build();
    const ctx = Sound.ctx, now = ctx.currentTime;
    // The title and field-select screens have their own theme; the field's music starts with a run.
    const id = game.inMenu ? 'menu' : game.mapId;
    if (!this.cur || this.cur.id !== id) this.switchTo(id);

    const t = game.trial;
    // The menu theme always plays in full; a field's rhythm layer joins once the run is under way.
    const working = game.inMenu || (!!t && t.started && !t.result);
    const paused = !game.inMenu && game.paused;
    const s = this.cur;
    if (working !== s.working) {
      s.working = working;
      s.work.gain.setTargetAtTime(working ? 1 : 0, now, working ? 1.2 : 0.8);
      s.lead.gain.setTargetAtTime(working ? 1 : 0.75, now, 1);
    }
    if (paused !== this.paused) {
      this.paused = paused;
      this.pauseGain.gain.setTargetAtTime(paused ? 0.35 : 1, now, 0.25);
      this.muffle.frequency.setTargetAtTime(paused ? 700 : 18000, now, 0.25);
    }

    // After the tab was hidden (no frames) pick up from now rather than racing through the missed notes.
    if (s.next < now - 0.05) s.next = now + 0.05;
    while (s.next < now + this.LOOKAHEAD) {
      if (s.step % s.steps === 0) this.setTempo(s);
      this.scheduleStep(s, s.step, s.next); s.step++; s.next += s.stepDur;
    }
  },

  // At each bar line, ease the tempo towards the style's working tempo (once the run is under way) or its quiet
  // one, a few bpm per bar, so the music picks up over a couple of bars rather than jumping.
  setTempo(s) {
    const target = (s.working && s.style.workBpm) || s.style.bpm, d = target - s.bpm;
    s.bpm += Math.sign(d) * Math.min(Math.abs(d), 10);
    s.stepDur = 60 / s.bpm / s.style.sub;
  },

  // Fixed chain after the per-style layers: mix -> duck -> muffle -> pause -> music bus, with a reverb send.
  build() {
    if (this.mix) return;
    const ctx = Sound.ctx;
    this.mix = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000;
    this.pauseGain = ctx.createGain();
    this.mix.connect(this.duckGain).connect(this.muffle).connect(this.pauseGain).connect(Sound.bus('music'));
    // Generated impulse response: decaying stereo noise, a soft outdoor-ish hall.
    const len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.mix.connect(this.verb).connect(wet).connect(this.duckGain);
    // Stings skip the duck and pause stages so they're heard in full as the result card appears.
    this.stingOut = ctx.createGain();
    this.stingOut.connect(Sound.bus('music'));
    this.stingOut.connect(this.verb);
    this.paused = false;
  },

  // Crossfade to another field's style.
  switchTo(id) {
    const ctx = Sound.ctx, now = ctx.currentTime;
    const old = this.cur;
    if (old) {
      old.out.gain.setTargetAtTime(0, now, 0.5);
      setTimeout(() => { for (const n of old.drones) n.stop(); old.out.disconnect(); }, 3000);
    }
    const style = MUSIC_STYLES[id] || MUSIC_STYLES['hollow-meadow'];
    const out = ctx.createGain(), mk = (v) => { const g = ctx.createGain(); g.gain.value = v; g.connect(out); return g; };
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + 2);
    out.connect(this.mix);
    const s = {
      id, style, out, bed: mk(1), lead: mk(0.75), work: mk(0), drones: [], working: false,
      bpm: style.bpm, stepDur: 60 / style.bpm / style.sub, step: 0, next: now + 0.1,
      steps: style.beats * style.sub,
    };
    const seed = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    s.melA = style.melA ? fixedMelody(style, style.melA) : genMelody(style, seed);
    s.melB = style.melB ? fixedMelody(style, style.melB) : genMelody(style, seed + 1);
    if (style.bed.inst === 'drone') this.startDrone(s);
    this.cur = s;
  },

  // Bagpipe-style drone: the tonic in two octaves plus a fifth, held for as long as the style plays.
  startDrone(s) {
    const ctx = Sound.ctx, t = ctx.currentTime + 0.1, st = s.style;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(st.bed.vel, t + 2.5);
    lp.connect(g).connect(s.bed);
    for (const [semi, lvl] of [[-24, 1], [-12, 0.8], [-5, 0.45]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = midiHz(st.root + st.bed.oct * 12 + semi);
      o.detune.value = (Math.random() - 0.5) * 6;
      og.gain.value = lvl * 0.05;
      o.connect(og).connect(lp); o.start(t);
      s.drones.push(o);
    }
  },

  scheduleStep(s, step, t) {
    if (Sound.volume.music <= 0) return;
    const st = s.style, S = s.steps;
    const bar = Math.floor(step / S), inBar = step % S, barIn = bar % 8, phrase = Math.floor(bar / 8);
    const chord = st.chords[barIn];
    const deg = (d, oct) => degMidi(st, d, oct);

    if (inBar === 0 && st.bed.inst !== 'drone') {
      for (const i of [0, 2, 4]) voice(st.bed.inst, midiHz(deg(chord + i, st.bed.oct)), t, S * s.stepDur + 0.2, st.bed.vel, s.bed);
    }

    // Quiet field: the melody rests every other phrase. Working: every phrase.
    if (s.working || phrase % 2 === 1) {
      const mel = phrase % 3 === 2 ? s.melB : s.melA;
      const n = mel[barIn * S + inBar];
      if (n) voice(st.lead.inst, midiHz(deg(n.deg, st.lead.oct)), t, n.len * s.stepDur * 0.92, st.lead.vel, s.lead, st.lead.grace && midiHz(st.lead.grace));
    }

    if (s.working || s.work.gain.value > 0.01) {
      for (const e of st.work) {
        const idx = e.at.indexOf(inBar);
        if (idx < 0) continue;
        const vel = Array.isArray(e.vel) ? e.vel[idx % e.vel.length] : e.vel;
        if (!e.pick) { voice(e.inst, 0, t, 0.2, vel, s.work); continue; }
        const pick = e.pick[idx % e.pick.length], dur = (e.len || 1) * s.stepDur;
        if (pick === 'chord') {
          [0, 2, 4].forEach((i, k) => voice(e.inst, midiHz(deg(chord + i, e.oct)), t + k * 0.014, dur, vel, s.work));
        } else voice(e.inst, midiHz(deg(chord + [0, 2, 4, st.scale.length][pick], e.oct)), t, dur, vel, s.work);
      }
      // A fill through the second half of every other phrase's last bar, building into the next phrase.
      if (st.fill && phrase % 2 === 1 && barIn === 7 && inBar >= S / 2) {
        voice(st.fill, 0, t, 0.2, 0.45 + 0.6 * (inBar - S / 2) / (S / 2), s.work);
      }
    }
  },

  // Dip the music under a whistle so the command is clear.
  duck(hold = 0.9, level = 0.45) {
    if (!this.mix) return;
    const g = this.duckGain.gain, t = Sound.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + 0.06);
    g.setValueAtTime(level, t + hold);
    g.linearRampToValueAtTime(1, t + hold + 0.6);
  },

  // A short phrase in the field's lead voice: rising to the octave for a completed run, falling for time or retire.
  sting(outcome) {
    if (!this.cur || Sound.volume.music <= 0) return;
    const st = this.cur.style, t = Sound.ctx.currentTime + 0.05, good = outcome === 'COMPLETE';
    const top = st.scale.length, notes = good ? [[0, 0.11], [2, 0.11], [4, 0.11], [top, 1.3]] : [[4, 0.28], [3, 0.28], [1, 0.28], [0, 1.2]];
    let at = t;
    for (const [d, len] of notes) {
      voice(st.lead.inst, midiHz(degMidi(st, d, st.lead.oct)), at, len, st.lead.vel * (good ? 1.1 : 0.8), this.stingOut);
      at += good ? len : len + 0.04;
    }
    // The closing chord under the last note.
    for (const i of [0, 2, 4]) voice('pad', midiHz(degMidi(st, i, st.bed.oct)), at - (good ? 1.3 : 1.2), 1.4, good ? 0.9 : 0.6, this.stingOut);
    this.duck(at - t, 0.25);
  },
};

// --- helpers ---------------------------------------------------------------

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Scale degree (any integer, 0 = tonic) to a MIDI note, `oct` octaves above the style's root.
function degMidi(st, d, oct = 0) {
  const n = st.scale.length, o = Math.floor(d / n);
  return st.root + (oct + o) * 12 + st.scale[d - o * n];
}

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// An 8-bar melody as an array indexed by step: {deg, len} where a note starts, else undefined.
// Form A B A C: a two-bar motif, an answer, the motif again (bars 5–6 share bars 1–2's chords), and a
// cadence that ends on a held tonic.
function genMelody(st, seed) {
  const rng = mulberry32(seed), pick = (a) => a[Math.floor(rng() * a.length)];
  const S = st.beats * st.sub, out = new Array(8 * S);
  const n = st.scale.length;
  let prev = 2 + Math.floor(rng() * 3);
  const gen = (bar0, bars) => {
    const notes = [];
    for (let pos = 0; pos < bars * S;) {
      const len = Math.min(pick(st.lead.lens), bars * S - pos);
      if (pos > 0 && rng() < st.lead.rest) { pos += len; continue; }
      let d = prev + pick([-2, -1, -1, 0, 1, 1, 2, 3, -3]);
      if (d < 0) d = -d; if (d > 9) d = 18 - d;
      // On a downbeat, land on a tone of that bar's chord.
      if (pos % S === 0) {
        const c = st.chords[bar0 + pos / S], tones = [0, 2, 4].map(i => (c + i) % n);
        for (const off of [0, 1, -1, 2, -2]) if (tones.includes(((d + off) % n + n) % n)) { d += off; break; }
      }
      notes.push([pos, { deg: d, len }]);
      prev = d; pos += len;
    }
    return notes;
  };
  const put = (bar0, notes) => { for (const [pos, nt] of notes) out[bar0 * S + pos] = nt; };
  const A = gen(0, 2);
  put(0, A); put(2, gen(2, 2)); put(4, A);
  // Cadence: one bar of melody, then the tonic held through the last bar.
  put(6, gen(6, 1));
  out[7 * S] = { deg: prev >= 4 ? n : 0, len: S };
  return out;
}

// A written-out 8-bar melody, given as [deg, len] pairs played back to back, in the same step layout as genMelody.
function fixedMelody(st, notes) {
  const out = new Array(8 * st.beats * st.sub);
  let pos = 0;
  for (const [deg, len] of notes) { out[pos] = { deg, len }; pos += len; }
  return out;
}

let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf) {
    const len = ctx.sampleRate, b = ctx.createBuffer(1, len, len), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = b;
  }
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  return src;
}

// One note on a synthesised instrument. `vel` scales the instrument's own level; `grace` (Hz) is a pipe-style
// grace note flicked in at the start.
function voice(inst, f, t, dur, vel, out, grace) {
  const ctx = Sound.ctx;
  const osc = (type, freq, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune; return o; };
  const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filt = (type, freq, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = q; return b; };
  const run = (nodes, start, stop) => { for (const n of nodes) { n.start(start); n.stop(stop); } };
  // Held note: attack, sustain to the note's end, release.
  const held = (g, peak, a, r) => {
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur)); g.gain.linearRampToValueAtTime(0, t + Math.max(a, dur) + r);
    return t + Math.max(a, dur) + r + 0.05;
  };
  // Struck note: quick attack, exponential decay.
  const struck = (g, peak, decay) => {
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    return t + decay + 0.02;
  };

  switch (inst) {
    case 'pad': case 'strings': {
      const lp = filt('lowpass', inst === 'pad' ? 750 : 1500), g = gain();
      const end = held(g, 0.045 * vel, inst === 'pad' ? 0.6 : 0.35, 1.2);
      const os = [osc('sawtooth', f, -7), osc('sawtooth', f, 7)];
      for (const o of os) o.connect(lp);
      lp.connect(g).connect(out); run(os, t, end);
      break;
    }
    case 'whistle': case 'flute': {
      const o = osc(inst === 'whistle' ? 'sine' : 'triangle', f), g = gain(), lp = filt('lowpass', 3000);
      // Vibrato comes in after the attack.
      const lfo = osc('sine', 5.3), depth = gain();
      depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.35, dur));
      lfo.connect(depth).connect(o.frequency);
      const end = held(g, 0.11 * vel, 0.035, 0.09);
      o.connect(lp).connect(g).connect(out);
      run([o, lfo], t, end);
      // Breath at the onset.
      const nz = noise(ctx), bp = filt('bandpass', f * 2, 3), ng = gain();
      ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.02 * vel, t + 0.015); ng.gain.linearRampToValueAtTime(0, t + 0.08);
      nz.connect(bp).connect(ng).connect(out); run([nz], t, t + 0.1);
      break;
    }
    case 'pipes': {
      const o = osc('sawtooth', f), g = gain(), bp = filt('peaking', 1400, 1), lp = filt('lowpass', 2600, 1.2);
      bp.gain.value = 6;
      if (grace && dur > 0.2) { o.frequency.setValueAtTime(grace, t); o.frequency.setValueAtTime(f, t + 0.035); }
      const end = held(g, 0.05 * vel, 0.01, 0.05);
      o.connect(bp).connect(lp).connect(g).connect(out); run([o], t, end);
      break;
    }
    case 'accordion': {
      const lp = filt('lowpass', 1700), g = gain();
      const end = held(g, 0.035 * vel, 0.03, 0.08);
      const os = [osc('square', f, -6), osc('square', f, 6)];
      for (const o of os) o.connect(lp);
      lp.connect(g).connect(out); run(os, t, end);
      break;
    }
    case 'guitar': case 'pluck': {
      const o = osc('sawtooth', f), lp = filt('lowpass', 0, 1), g = gain();
      lp.frequency.setValueAtTime(Math.min(f * 8, 6000), t); lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.4);
      const end = struck(g, 0.13 * vel, Math.max(0.6, dur + 0.8));
      o.connect(lp).connect(g).connect(out); run([o], t, end);
      break;
    }
    case 'harp': {
      const os = [osc('triangle', f), osc('sine', f * 2)], g = gain(), g2 = gain(0.25);
      os[0].connect(g); os[1].connect(g2).connect(g);
      const end = struck(g, 0.12 * vel, 1.8);
      g.connect(out); run(os, t, end);
      break;
    }
    case 'balalaika': {
      // Long notes are tremolo-picked; short ones a single pluck.
      const picks = dur > 0.3 ? Math.floor(dur / 0.075) : 1;
      for (let i = 0; i < picks; i++) {
        const at = t + i * 0.075, o = osc('sawtooth', f), lp = filt('lowpass', Math.min(f * 6, 5000)), g = gain();
        const last = i === picks - 1, decay = last ? 0.5 : 0.12, peak = 0.1 * vel * (i % 2 ? 0.75 : 1);
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0005, at + decay);
        o.connect(lp).connect(g).connect(out); run([o], at, at + decay + 0.02);
      }
      break;
    }
    case 'steel': {
      const g = gain(), parts = [[1, 1], [2, 0.4], [3.01, 0.12]], os = [];
      for (const [m, lvl] of parts) {
        const o = osc('sine', f * m), pg = gain(lvl);
        o.frequency.setValueAtTime(f * m * 1.01, t); o.frequency.exponentialRampToValueAtTime(f * m, t + 0.05);
        o.connect(pg).connect(g); os.push(o);
      }
      const end = struck(g, 0.11 * vel, 1.1);
      g.connect(out); run(os, t, end);
      break;
    }
    case 'marimba': {
      const os = [osc('sine', f), osc('sine', f * 4)], g = gain(), g2 = gain();
      os[0].connect(g); os[1].connect(g2).connect(out);
      g2.gain.setValueAtTime(0.03 * vel, t); g2.gain.exponentialRampToValueAtTime(0.0005, t + 0.08);
      const end = struck(g, 0.13 * vel, 0.5);
      g.connect(out); run(os, t, end);
      break;
    }
    case 'horn': {
      // Alphorn-ish: a mellow, breathy tone that scoops up into the note.
      const os = [osc('sine', f), osc('triangle', f * 2, 3)], g = gain(), g2 = gain(0.3), lp = filt('lowpass', 900);
      for (const o of os) { o.frequency.setValueAtTime(o.frequency.value * 0.97, t); o.frequency.exponentialRampToValueAtTime(o.frequency.value, t + 0.12); }
      os[0].connect(lp); os[1].connect(g2).connect(lp);
      const end = held(g, 0.08 * vel, 0.18, 0.5);
      lp.connect(g).connect(out); run(os, t, end);
      break;
    }
    case 'bass': {
      const o = osc('triangle', f), lp = filt('lowpass', 500), g = gain();
      const end = struck(g, 0.2 * vel, 0.8);
      o.connect(lp).connect(g).connect(out); run([o], t, end);
      break;
    }
    case 'drum': {
      const o = osc('sine', 110), g = gain();
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.15);
      const end = struck(g, 0.35 * vel, 0.35);
      o.connect(g).connect(out); run([o], t, end);
      break;
    }
    case 'snare': case 'tick': {
      const nz = noise(ctx), g = gain();
      const f2 = inst === 'snare' ? filt('bandpass', 1800, 0.8) : filt('highpass', 6000);
      const end = struck(g, (inst === 'snare' ? 0.12 : 0.07) * vel, inst === 'snare' ? 0.14 : 0.045);
      nz.connect(f2).connect(g).connect(out); run([nz], t, end);
      break;
    }
  }
}

// --- styles ----------------------------------------------------------------
// beats × sub steps per bar; chords are scale degrees per bar of the 8-bar loop (bars 5–6 repeat bars 1–2).
// bpm is the quiet tempo and workBpm the tempo once a run is under way; fill is the percussion voice for the
// phrase-end fill while working. lead.lens are note lengths in steps. work entries play on the listed steps of each bar: `pick` indexes the
// chord tones [root, third, fifth, octave] or 'chord' for a strum; no pick means unpitched percussion.
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  yo: [0, 2, 5, 7, 9],              // Japanese pentatonic
};

const MUSIC_STYLES = {
  // Title and field-select screens: a broad, written-out anthem in E-flat on a mellow horn over strings, with
  // rolling harp and a soft drum — not tied to any field, and unlike any field's generated tunes.
  menu: {
    bpm: 72, beats: 4, sub: 2, root: 51, scale: SCALES.major, chords: [0, 5, 3, 4, 0, 5, 3, 0],
    bed: { inst: 'strings', oct: 0, vel: 0.75 },
    lead: { inst: 'horn', oct: 1, vel: 1 },
    melA: [
      [4, 3], [5, 1], [4, 2], [2, 2],   [7, 3], [6, 1], [5, 4],
      [3, 2], [5, 2], [7, 3], [5, 1],   [4, 6], [2, 1], [3, 1],
      [4, 3], [5, 1], [4, 2], [2, 2],   [7, 3], [8, 1], [9, 4],
      [8, 2], [7, 2], [5, 2], [3, 2],   [2, 2], [1, 2], [0, 4],
    ],
    melB: [
      [7, 4], [6, 2], [4, 2],           [5, 6], [7, 2],
      [8, 3], [7, 1], [5, 2], [3, 2],   [4, 4], [6, 2], [4, 2],
      [2, 3], [4, 1], [7, 4],           [9, 3], [8, 1], [7, 2], [5, 2],
      [7, 2], [5, 2], [3, 2], [1, 2],   [2, 2], [0, 6],
    ],
    work: [
      { inst: 'harp', at: [0, 1, 2, 3, 4, 5, 6, 7], pick: [0, 2, 3, 2, 1, 2, 3, 2], oct: 0, vel: 0.55, len: 2 },
      { inst: 'bass', at: [0, 4, 6], pick: [0, 2, 0], oct: -1, vel: 0.9 },
      { inst: 'drum', at: [0, 6], vel: [0.45, 0.25] },
    ],
  },
  // Home field: a gentle jig on tin whistle over soft strings and a harp; a lively jig with bodhrán once working.
  'hollow-meadow': {
    bpm: 64, workBpm: 96, beats: 2, sub: 3, root: 55, scale: SCALES.major, chords: [0, 3, 0, 4, 0, 3, 4, 0],
    bed: { inst: 'pad', oct: 0, vel: 1 },
    lead: { inst: 'whistle', oct: 1, vel: 0.9, lens: [3, 3, 2, 1, 1, 6], rest: 0.15 },
    fill: 'snare',
    work: [
      { inst: 'harp', at: [0, 1, 2, 3, 4, 5], pick: [0, 1, 2, 3, 2, 1], oct: 0, vel: 0.8, len: 1 },
      { inst: 'bass', at: [0, 2, 3, 5], pick: [0, 2, 0, 2], oct: -1, vel: [1, 0.6] },
      { inst: 'drum', at: [0, 3], vel: [0.7, 0.5] },
      { inst: 'tick', at: [0, 1, 2, 3, 4, 5], vel: [0.8, 0.35, 0.55] },
    ],
  },
  // Texas: slow, open guitar over a low pad; a train beat with boom-chick bass once working.
  texas: {
    bpm: 76, workBpm: 108, beats: 4, sub: 2, root: 52, scale: SCALES.major, chords: [0, 3, 0, 4, 0, 3, 4, 0],
    bed: { inst: 'pad', oct: 0, vel: 0.8 },
    lead: { inst: 'guitar', oct: 1, vel: 0.9, lens: [2, 2, 4, 1, 1, 6, 3], rest: 0.3 },
    fill: 'snare',
    work: [
      { inst: 'bass', at: [0, 2, 4, 6], pick: [0, 2, 0, 2], oct: -1, vel: 1 },
      { inst: 'guitar', at: [1, 3, 5, 7], pick: ['chord'], oct: 0, vel: 0.4, len: 1 },
      { inst: 'snare', at: [2, 6], vel: 0.55 },
      { inst: 'tick', at: [0, 1, 2, 3, 4, 5, 6, 7], vel: [0.4, 0.9] },
    ],
  },
  // Slovenia: an alpine waltz on accordion; a brisk oom-pah-pah once working.
  slovenia: {
    bpm: 108, workBpm: 138, beats: 3, sub: 2, root: 53, scale: SCALES.major, chords: [0, 4, 3, 0, 0, 4, 4, 0],
    bed: { inst: 'pad', oct: 0, vel: 0.8 },
    lead: { inst: 'accordion', oct: 1, vel: 0.9, lens: [2, 1, 1, 2, 2, 4], rest: 0.1 },
    fill: 'snare',
    work: [
      { inst: 'bass', at: [0], pick: [0], oct: -1, vel: 1 },
      { inst: 'accordion', at: [2, 4], pick: ['chord'], oct: 0, vel: 0.5, len: 1 },
      { inst: 'pluck', at: [1, 3, 5], pick: [3, 2, 1], oct: 1, vel: 0.35, len: 1 },
      { inst: 'tick', at: [2, 4], vel: 0.6 },
    ],
  },
  // England: a pastoral flute air over strings; a morris-dance step with harp and bells once working.
  england: {
    bpm: 80, workBpm: 104, beats: 4, sub: 2, root: 50, scale: SCALES.major, chords: [0, 5, 3, 4, 0, 5, 4, 0],
    bed: { inst: 'strings', oct: 0, vel: 0.85 },
    lead: { inst: 'flute', oct: 1, vel: 0.9, lens: [2, 2, 2, 4, 1, 1, 6, 3], rest: 0.15 },
    fill: 'tick',
    work: [
      { inst: 'harp', at: [0, 1, 2, 3, 4, 5, 6, 7], pick: [0, 1, 2, 3, 2, 1, 2, 1], oct: 0, vel: 0.7, len: 1 },
      { inst: 'bass', at: [0, 3, 4, 6], pick: [0, 2, 0, 2], oct: -1, vel: 0.9 },
      { inst: 'drum', at: [0, 4], vel: [0.55, 0.4] },
      { inst: 'tick', at: [2, 3, 6, 7], vel: [0.8, 0.4] },
    ],
  },
  // Scotland: pipe tune in A mixolydian over a drone, with grace notes; a pipe-band march once working.
  scotland: {
    bpm: 72, workBpm: 96, beats: 4, sub: 2, root: 57, scale: SCALES.mixolydian, chords: [0, 6, 0, 4, 0, 6, 6, 0],
    bed: { inst: 'drone', oct: 0, vel: 1 },
    lead: { inst: 'pipes', oct: 1, vel: 0.85, lens: [3, 1, 2, 2, 4, 1, 1], rest: 0.05, grace: 79 },
    fill: 'snare',
    work: [
      { inst: 'drum', at: [0, 4], vel: [1, 0.7] },
      { inst: 'snare', at: [1, 2, 3, 5, 6, 7], vel: [0.35, 0.8, 0.4, 0.35, 0.8, 0.5] },
      { inst: 'bass', at: [0, 4], pick: [0, 2], oct: -1, vel: 0.8 },
    ],
  },
  // Finland: a kantele tune in D dorian over soft strings; a polka with off-beat accordion once working.
  finland: {
    bpm: 80, workBpm: 112, beats: 4, sub: 2, root: 50, scale: SCALES.dorian, chords: [0, 3, 6, 0, 0, 3, 4, 0],
    bed: { inst: 'strings', oct: 0, vel: 0.75 },
    lead: { inst: 'harp', oct: 1, vel: 0.9, lens: [2, 2, 1, 1, 2, 4, 6], rest: 0.1 },
    fill: 'snare',
    work: [
      { inst: 'bass', at: [0, 2, 4, 6], pick: [0, 2, 0, 2], oct: -1, vel: 0.9 },
      { inst: 'accordion', at: [1, 3, 5, 7], pick: ['chord'], oct: 0, vel: 0.45, len: 1 },
      { inst: 'drum', at: [0, 4], vel: 0.5 },
      { inst: 'tick', at: [1, 3, 5, 7], vel: 0.6 },
    ],
  },
  // Florida: steel drum and marimba; a calypso groove once working.
  florida: {
    bpm: 96, workBpm: 116, beats: 4, sub: 2, root: 48, scale: SCALES.major, chords: [0, 3, 0, 4, 0, 3, 4, 0],
    bed: { inst: 'pad', oct: 0, vel: 0.8 },
    lead: { inst: 'steel', oct: 1, vel: 0.9, lens: [1, 2, 1, 2, 2, 1, 3, 4], rest: 0.15 },
    fill: 'snare',
    work: [
      { inst: 'marimba', at: [0, 2, 3, 5, 6], pick: [0, 2, 1, 2, 3], oct: 1, vel: 0.8 },
      { inst: 'bass', at: [0, 3, 4, 7], pick: [0, 0, 2, 1], oct: -1, vel: 1 },
      { inst: 'drum', at: [0, 3, 6], vel: [0.6, 0.45, 0.45] },
      { inst: 'snare', at: [4], vel: 0.4 },
      { inst: 'tick', at: [0, 1, 2, 3, 4, 5, 6, 7], vel: [0.9, 0.4] },
    ],
  },
  // Japan: a breathy shakuhachi-like flute in the yo pentatonic over soft strings; koto and driving taiko once working.
  japan: {
    bpm: 66, workBpm: 88, beats: 4, sub: 2, root: 50, scale: SCALES.yo, chords: [0, 3, 1, 3, 0, 3, 4, 0],
    bed: { inst: 'strings', oct: 0, vel: 0.6 },
    lead: { inst: 'flute', oct: 1, vel: 0.9, lens: [4, 2, 2, 6, 1, 1, 8], rest: 0.2 },
    fill: 'drum',
    work: [
      { inst: 'pluck', at: [0, 1, 2, 3, 5, 6], pick: [0, 1, 2, 3, 2, 1], oct: 0, vel: 0.5, len: 2 },
      { inst: 'drum', at: [0, 3, 4, 6, 7], vel: [1, 0.5, 0.8, 0.5, 0.6] },
      { inst: 'tick', at: [2, 6], vel: 0.7 },
      { inst: 'bass', at: [0, 4], pick: [0, 0], oct: -1, vel: 0.7 },
    ],
  },
  // Italy: a tarantella in A minor, mandolin tremolo over strings; a fast one with guitar and tambourine once working.
  italy: {
    bpm: 100, workBpm: 126, beats: 2, sub: 3, root: 57, scale: SCALES.harmonicMinor, chords: [0, 4, 0, 3, 0, 4, 4, 0],
    bed: { inst: 'strings', oct: 0, vel: 0.7 },
    lead: { inst: 'balalaika', oct: 1, vel: 0.8, lens: [1, 1, 1, 2, 1, 3, 6], rest: 0.08 },
    fill: 'tick',
    work: [
      { inst: 'bass', at: [0, 3], pick: [0, 2], oct: -1, vel: 1 },
      { inst: 'guitar', at: [1, 2, 4, 5], pick: ['chord'], oct: 0, vel: 0.35, len: 1 },
      { inst: 'drum', at: [0, 3], vel: [0.5, 0.35] },
      { inst: 'tick', at: [0, 1, 2, 3, 4, 5], vel: [1, 0.4, 0.6, 0.9, 0.4, 0.6] },
    ],
  },
  // Austria: a Tyrolean Ländler in G on zither over alphorn chords; a quick oom-pah-pah once working.
  austria: {
    bpm: 100, workBpm: 128, beats: 3, sub: 2, root: 55, scale: SCALES.major, chords: [0, 4, 4, 0, 0, 4, 3, 0],
    bed: { inst: 'horn', oct: -1, vel: 0.9 },
    lead: { inst: 'harp', oct: 1, vel: 0.9, lens: [1, 1, 2, 2, 1, 1, 4, 6], rest: 0.08 },
    fill: 'snare',
    work: [
      { inst: 'bass', at: [0, 3], pick: [0, 2], oct: -1, vel: [1, 0.7] },
      { inst: 'pluck', at: [2, 4], pick: ['chord'], oct: 0, vel: 0.4, len: 1 },
      { inst: 'accordion', at: [1, 5], pick: [3, 2], oct: 1, vel: 0.3, len: 1 },
      { inst: 'tick', at: [2, 4], vel: 0.6 },
    ],
  },
};

// Audio may only start after a user gesture; the first key or click starts it, and music follows.
for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, () => Sound.bus('music'), true);
