'use strict';
// Ground surfaces and relief. A map's `terrain` says which surface lies where (noise layers over a
// base, plus an optional zone function), how the ground rises, and the fence, weather and backdrop.

// Smooth value noise in [0,1), and a two-octave blend of it.
M.noise2 = function (x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, s = seed * 1013;
  const a = M.hash2(xi + s, yi), b = M.hash2(xi + 1 + s, yi), c = M.hash2(xi + s, yi + 1), d = M.hash2(xi + 1 + s, yi + 1);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
M.fbm = (x, y, seed = 0) => M.noise2(x, y, seed) * 0.65 + M.noise2(x * 2.3 + 17, y * 2.3 + 5, seed + 7) * 0.35;
// Seeded generator in [0,1) (mulberry32), so scattered props land in the same place every run.
M.rng = function (seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// colors: tile variants · detail: what is drawn on the tile up close · speed: how fast sheep and dog cross it.
const SURFACES = {
  grass:   { colors: ['#5e993c', '#5c963a', '#609c3e', '#5b9439'], detail: 'tuft', ink: 'rgba(40,80,25,0.35)', speed: 1 },
  lush:    { colors: ['#4f9a3a', '#4c9637', '#539f3d', '#4a9336'], detail: 'tuft', ink: 'rgba(28,72,20,0.4)', speed: 1 },
  daisy:   { colors: ['#58a03f', '#559c3c', '#5ca442', '#53983a'], detail: 'flower', ink: 'rgba(28,72,20,0.4)', dots: ['#f6f3e6', '#f6f3e6', '#f2d64b'], speed: 1 },
  meadow:  { colors: ['#67a142', '#649e3f', '#6aa545', '#62993d'], detail: 'flower', ink: 'rgba(40,85,25,0.35)', dots: ['#f4f0d8', '#f1d34a', '#c9a6e8', '#e8807a'], speed: 1 },
  turf:    { colors: ['#6aa83f', '#66a43c', '#6ead43', '#63a03a'], detail: 'tuft', ink: 'rgba(40,85,25,0.35)', speed: 1 },
  pale:    { colors: ['#8a9a5c', '#859657', '#8fa061', '#819153'], detail: 'tuft', ink: 'rgba(70,80,40,0.45)', speed: 1 },
  dry:     { colors: ['#b4a35c', '#ad9c55', '#baa962', '#a8984f'], detail: 'tuft', ink: 'rgba(110,90,40,0.45)', speed: 1 },
  dirt:    { colors: ['#bf9566', '#b98f60', '#c59b6c', '#b38a5b'], detail: 'pebble', ink: 'rgba(110,75,45,0.45)', speed: 1 },
  gravel:  { colors: ['#cbb08a', '#c5aa83', '#d1b690', '#bfa47d'], detail: 'pebble', ink: 'rgba(115,95,75,0.55)', speed: 0.95 },
  moor:    { colors: ['#68804a', '#647c46', '#6c844e', '#607843'], detail: 'tuft', ink: 'rgba(55,70,30,0.45)', speed: 0.97 },
  heather: { colors: ['#5f5250', '#5b4e4d', '#635653', '#574a49'], detail: 'flower', ink: 'rgba(60,45,55,0.5)', dots: ['#a86fa6', '#93618f', '#b980b4'], speed: 0.88 },
  bracken: { colors: ['#86743f', '#82703c', '#8a7843', '#7e6c39'], detail: 'tuft', ink: 'rgba(95,60,25,0.5)', speed: 0.9 },
  scree:   { colors: ['#80827a', '#7b7d75', '#85877f', '#767870'], detail: 'pebble', ink: 'rgba(60,60,58,0.5)', speed: 0.92 },
  slush:   { colors: ['#b7c3b4', '#b1bdae', '#bdc9ba', '#abb7a8'], detail: 'tuft', ink: 'rgba(90,105,85,0.45)', speed: 0.9 },
  snow:    { colors: ['#e9eef2', '#e4eaef', '#eef2f5', '#dfe6ec'], detail: 'drift', ink: 'rgba(150,170,195,0.55)', speed: 0.82 },
  sand:    { colors: ['#e3cf9b', '#ddc994', '#e8d4a1', '#d8c48f'], detail: 'ripple', ink: 'rgba(170,140,90,0.45)', speed: 0.85 },
  wetsand: { colors: ['#c9b07c', '#c4ab77', '#ceb581', '#bfa672'], detail: null, speed: 0.9 },
  petals:  { colors: ['#5fa043', '#5c9c40', '#62a446', '#59983d'], detail: 'flower', ink: 'rgba(40,85,25,0.35)', dots: ['#f7d3df', '#f2bfd0', '#fbe6ee', '#ecaec4'], speed: 1 },
  campagna:{ colors: ['#7f9a48', '#7b9645', '#839e4c', '#779242'], detail: 'tuft', ink: 'rgba(75,85,35,0.4)', speed: 1 },
  poppy:   { colors: ['#76953f', '#72913c', '#7a9943', '#6e8d39'], detail: 'flower', ink: 'rgba(60,80,30,0.4)', dots: ['#d8352a', '#e2452e', '#c92b25', '#f3eedc'], speed: 1 },
  basalt:  { colors: ['#86837b', '#817e76', '#8b8880', '#7c7971'], detail: 'cobble', ink: 'rgba(55,52,48,0.55)', speed: 1 },
  alpine:  { colors: ['#5a8c40', '#57883d', '#5e9043', '#54853a'], detail: 'tuft', ink: 'rgba(30,70,22,0.4)', speed: 1 },
  edelweiss:{ colors: ['#64944a', '#619047', '#68984d', '#5d8c44'], detail: 'flower', ink: 'rgba(30,70,22,0.4)', dots: ['#f4f2ea', '#4f6fd0', '#f1d34a', '#f4f2ea'], speed: 1 },
  limestone:{ colors: ['#a19f92', '#9b998c', '#a7a598', '#959386'], detail: 'pebble', ink: 'rgba(95,92,85,0.5)', speed: 0.9 },
  mud:     { colors: ['#6d6a3c', '#69663a', '#716e40', '#656236'], detail: 'pebble', ink: 'rgba(70,58,32,0.45)', speed: 0.94 },
  puddle:  { colors: ['#8a9a98', '#869694', '#8e9e9c', '#829290'], detail: 'rings', speed: 0.85 },
  shallow: { colors: ['#6fb8b4', '#6bb3af', '#74bdb9', '#67aea9'], detail: 'wave', speed: 0.6 },
  water:   { colors: ['#3d8fb5', '#3b8ab0', '#4094ba', '#3a88ad'], detail: 'wave', speed: 0 },
};
const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
for (const s of Object.values(SURFACES)) {
  s.rgb = s.colors.map(hexRGB);
  s.mean = [0, 1, 2].map(k => s.rgb.reduce((a, c) => a + c[k], 0) / s.rgb.length);
  // Close-up marks come in a dark (ink) and a light tone.
  s.hi = `rgba(${s.mean.map(c => Math.min(255, c * 1.15 + 8) | 0).join(',')},0.35)`;
  s.lo = `rgba(${s.mean.map(c => c * 0.7 | 0).join(',')},0.4)`;
}
M.smoothstep = (a, b, v) => { const t = M.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };


// Sun for the baked hillshade: low from the upper left of the screen (world -x, a little -y).
const SUN = (() => { const v = [-0.62, -0.28, 0.73], l = Math.hypot(...v); return v.map(c => c / l); })();
// How far past the boundary fence the scenery is drawn.
const TERRAIN_MARGIN = 70;
const GROUND_PX = 4;            // texels per metre in the baked top-down ground
const ISO_Z = 6;                // pixels per world unit in the pre-rendered isometric ground
const bakeJobs = new Map();     // map id -> { gen, res }: a field's ground bake, in progress or done
let isoCache = null;            // the isometric ground of the most recent map
let isoJob = null;              // { id, gen }: an isometric ground being built in slices

// Background work in short slices, each slice its own task so frames render in between. A message
// channel rather than setTimeout: no 4 ms clamp, and no throttling when the page is in the background.
const slicer = (() => {
  const jobs = [], ch = new MessageChannel();
  let posted = false;
  const post = () => { if (!posted) { posted = true; ch.port2.postMessage(0); } };
  ch.port1.onmessage = () => {
    posted = false;
    const until = performance.now() + 6;
    while (jobs.length && performance.now() < until) {
      const j = jobs[0];
      if (j.cancelled) { jobs.shift(); continue; }
      const st = j.gen.next();
      if (st.done) { jobs.shift(); if (j.done) j.done(st.value); }
    }
    if (jobs.length) post();
  };
  return { add(gen, done, urgent) { const j = { gen, done, cancelled: false }; urgent ? jobs.unshift(j) : jobs.push(j); post(); return j; } };
})();

// One direction of a box blur over a w x h float grid: `stride` 1 blurs rows, w blurs columns.
function boxBlur(src, w, h, stride, r) {
  const out = new Float32Array(src.length), n = stride === 1 ? w : h, lines = stride === 1 ? h : w, lineStep = stride === 1 ? w : 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    let sum = 0, cnt = 0;
    for (let k = 0; k <= Math.min(r, n - 1); k++) { sum += src[base + k * stride]; cnt++; }
    for (let k = 0; k < n; k++) {
      out[base + k * stride] = sum / cnt;
      const add = k + r + 1, rem = k - r;
      if (add < n) { sum += src[base + add * stride]; cnt++; }
      if (rem >= 0) { sum -= src[base + rem * stride]; cnt--; }
    }
  }
  return out;
}

class Ground {
  constructor(map) {
    const t = map.terrain || {};
    this.map = map;
    this.t = t;
    this.base = t.base || 'grass';
    this.layers = t.layers || [];
    this.relief = t.relief || null;      // { tilt: rise per metre toward the sheep, tiltX: rise per metre eastward, amp, scale, seed }
    this.flat = !this.relief;
    this.maxH = this.flat ? 0 : (this.relief.tilt || 0) * (map.height + TERRAIN_MARGIN * 2) + Math.abs(this.relief.tiltX || 0) * (map.width + TERRAIN_MARGIN * 2)
      + (this.relief.amp || 0) + (this.relief.bumps ? this.relief.bumps.amp : 0);
    this.tiles = new Map();
  }

  surface(x, y) {
    if (this.t.zone) { const z = this.t.zone(x, y, this.map); if (z) return z; }
    let s = this.base;
    for (const L of this.layers) {
      let n = M.fbm(x / L.scale, y / L.scale, L.seed || 0);
      if (L.bias) n += L.bias(x, y, this.map);
      if (n > L.above) s = L.surface;
    }
    return s;
  }

  // Surfaces are fixed, so tiles are looked up once and remembered.
  tileSurface(i, j, T) {
    const key = ((i + 4096) * 8192 + (j + 4096)) * 2 + (T < 5 ? 1 : 0);
    let s = this.tiles.get(key);
    if (!s) { s = this.surface((i + 0.5) * T, (j + 0.5) * T); this.tiles.set(key, s); }
    return s;
  }

  // Bake the top-down ground for the field and its margin: blended colours, mottling and hillshade.
  // Anything that changes over metres (layer noise, broad mottling, the landform and its lighting) is worked
  // out on a 1 m grid and interpolated; per texel there is only fine detail, and only where it shows (patch
  // edges). A generator, so idle time can bake in slices (prebakeGrounds); baked() finishes it on demand.
  *bakeSteps() {
    const map = this.map, Mg = TERRAIN_MARGIN, P = GROUND_PX;
    const tw = Math.ceil((map.width + 2 * Mg) * P), th = Math.ceil((map.height + 2 * Mg) * P);
    const cw = Math.ceil(tw / P) + 2, ch = Math.ceil(th / P) + 2;     // 1 m grid: node (i, j) sits at (-Mg + i, -Mg + j)
    const layers = this.layers, nl = layers.length, relief = !this.flat, bumps = relief && this.relief.bumps;
    const cn = new Float32Array(cw * ch * nl), cm = new Float32Array(cw * ch), chs = relief ? new Float32Array(cw * ch) : null;
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const x = -Mg + i, y = -Mg + j, o = j * cw + i;
        for (let l = 0; l < nl; l++) {
          const L = layers[l];
          let n = M.fbm(x / L.scale, y / L.scale, L.seed || 0) + (M.noise2(x / 2.4, y / 2.4, (L.seed || 0) + 40) - 0.5) * 0.08;
          if (L.bias) n += L.bias(x, y, map);
          cn[o * nl + l] = n;
        }
        // Two broad scales of mottling so grass reads as grass, not a flat fill.
        cm[o] = (M.noise2(x / 7, y / 7, 91) - 0.5) * 0.12 + (M.noise2(x / 2, y / 2, 92) - 0.5) * 0.07;
        if (relief) chs[o] = this.height(x, y, true);
      }
      if (j % 24 === 23) yield;
    }

    // Light and shade on the landform (hummocks left out): sun, hollows darker, ridges and high ground lighter.
    let hMin = 0, hMax = 0;
    const ck = relief ? new Float32Array(cw * ch) : null;
    if (relief) {
      hMin = Infinity; hMax = -Infinity;
      for (const v of chs) { if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
      let hs = chs;
      for (let pass = 0; pass < 2; pass++) hs = boxBlur(boxBlur(hs, cw, ch, 1, 15), cw, ch, cw, 15);
      yield;
      const gain = this.t.shadeGain || 2.6;
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
        if (i === 0 && j % 64 === 63) yield;
        const o = j * cw + i, i0 = Math.max(0, i - 1), i1 = Math.min(cw - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(ch - 1, j + 1);
        const hx = (chs[j * cw + i1] - chs[j * cw + i0]) / (i1 - i0), hy = (chs[j1 * cw + i] - chs[j0 * cw + i]) / (j1 - j0);
        const lam = (-hx * SUN[0] - hy * SUN[1] + SUN[2]) / Math.hypot(hx, hy, 1) / SUN[2] - 1;
        ck[o] = M.clamp(1 + lam * gain, 0.55, 1.22) * M.clamp(1 + (chs[o] - hs[o]) * 0.06, 0.88, 1.1)
          * (1 + ((chs[o] - hMin) / Math.max(1, hMax - hMin) - 0.5) * 0.06);
      }
      if (bumps) { hMin -= bumps.amp; hMax += bumps.amp; }
      yield;
    }

    // Hummocks at full resolution (they are what the sheep stand on, and they catch a little light).
    const bump = bumps ? new Float32Array(tw * th) : null;
    if (bumps) {
      const sd = (this.relief.seed || 0) + 13;
      for (let j = 0; j < th; j++) {
        const y = -Mg + (j + 0.5) / P;
        for (let i = 0; i < tw; i++) bump[j * tw + i] = (M.noise2((-Mg + (i + 0.5) / P) / bumps.scale, y / bumps.scale, sd) - 0.5) * 2 * bumps.amp;
        if (j % 96 === 95) yield;
      }
    }

    const zone = this.t.zone, base = SURFACES[this.base].mean, lm = layers.map(L => SURFACES[L.surface].mean);
    const bg = hexRGB(this.t.bg || '#3e6e2b');
    const rgba = new Uint8ClampedArray(tw * th * 4), hgt = relief ? new Float32Array(tw * th) : null;
    for (let j = 0; j < th; j++) {
      const y = -Mg + (j + 0.5) / P, gy = (j + 0.5) / P, cj = gy | 0, fy = gy - cj;
      for (let i = 0; i < tw; i++) {
        const x = -Mg + (i + 0.5) / P, gx = (i + 0.5) / P, ci = gx | 0, fx = gx - ci, o = j * tw + i;
        const c00 = cj * cw + ci, c10 = c00 + 1, c01 = c00 + cw, c11 = c01 + 1;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        let r, g, b;
        const z = zone && zone(x, y, map);
        if (z) { const m = SURFACES[z].mean; r = m[0]; g = m[1]; b = m[2]; }
        else {
          r = base[0]; g = base[1]; b = base[2];
          for (let l = 0; l < nl; l++) {
            const L = layers[l];
            let n = cn[c00 * nl + l] * w00 + cn[c10 * nl + l] * w10 + cn[c01 * nl + l] * w01 + cn[c11 * nl + l] * w11, w = 1;
            if (n < L.above - 0.08) continue;
            if (n < L.above + 0.08) {
              // Near a patch edge: fine noise frays it into clumps instead of a cut-out blob.
              const sd = (L.seed || 0) + 40;
              n += (M.noise2(x / 1.1, y / 1.1, sd + 1) - 0.5) * 0.06 + (M.noise2(x / 0.5, y / 0.5, sd + 2) - 0.5) * 0.06;
              w = M.smoothstep(L.above - 0.01, L.above + 0.01, n);
              if (w <= 0) continue;
            }
            w *= L.opacity || 1;
            const m = lm[l];
            r += (m[0] - r) * w; g += (m[1] - g) * w; b += (m[2] - b) * w;
          }
        }
        let k = 1 + cm[c00] * w00 + cm[c10] * w10 + cm[c01] * w01 + cm[c11] * w11 + (M.noise2(x / 1.2, y / 1.2, 93) - 0.5) * 0.05;
        if (relief) {
          k *= ck[c00] * w00 + ck[c10] * w10 + ck[c01] * w01 + ck[c11] * w11;
          let h = chs[c00] * w00 + chs[c10] * w10 + chs[c01] * w01 + chs[c11] * w11;
          if (bumps) {
            h += bump[o];
            const i0 = i > 0 ? i - 1 : i, i1 = i < tw - 1 ? i + 1 : i, j0 = j > 0 ? j - 1 : j, j1 = j < th - 1 ? j + 1 : j;
            const hx = (bump[j * tw + i1] - bump[j * tw + i0]) * P / (i1 - i0), hy = (bump[j1 * tw + i] - bump[j0 * tw + i]) * P / (j1 - j0);
            const lam = (-hx * SUN[0] - hy * SUN[1] + SUN[2]) / Math.hypot(hx, hy, 1) / SUN[2] - 1;
            k *= M.clamp(1 + lam * 1.1, 0.86, 1.1);
          }
          hgt[o] = h;
        }
        // Fade into the backdrop toward the outer edge of the margin.
        const e = Math.min(x + Mg, map.width + Mg - x, y + Mg, map.height + Mg - y), f = M.smoothstep(0, 28, e);
        rgba[o * 4] = bg[0] + (r * k - bg[0]) * f;
        rgba[o * 4 + 1] = bg[1] + (g * k - bg[1]) * f;
        rgba[o * 4 + 2] = bg[2] + (b * k - bg[2]) * f;
        rgba[o * 4 + 3] = 255;
      }
      if (j % 24 === 23) yield;
    }
    return { tw, th, rgba, hgt, hMin, hMax, fieldCanvas: null };
  }

  bakeJob() {
    let job = bakeJobs.get(this.map.id);
    if (!job) bakeJobs.set(this.map.id, job = { gen: this.bakeSteps(), res: null });
    return job;
  }

  // Step this field's bake, yielding between slices, until it is done.
  *bakeSliced() {
    const job = this.bakeJob();
    while (!job.res) { const s = job.gen.next(); if (s.done) job.res = s.value; else yield; }
    return job.res;
  }

  baked() {
    const job = this.bakeJob();
    while (!job.res) { const s = job.gen.next(); if (s.done) job.res = s.value; }
    return job.res;
  }

  // Just the field (no margin) as a canvas, for the minimap.
  fieldCanvas() {
    const B = this.baked();
    if (B.fieldCanvas) return B.fieldCanvas;
    const P = GROUND_PX, x0 = TERRAIN_MARGIN * P, w = this.map.width * P, h = this.map.height * P;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h);
    for (let j = 0; j < h; j++) img.data.set(B.rgba.subarray(((x0 + j) * B.tw + x0) * 4, ((x0 + j) * B.tw + x0 + w) * 4), j * w * 4);
    ctx.putImageData(img, 0, 0);
    return (B.fieldCanvas = canvas);
  }

  // The ground pre-rendered in the game's isometric projection, heights included (voxel-style column
  // casting, nearest ground first, so hills hide what lies behind them). Drawn each frame with one drawImage.
  iso() {
    if (isoCache && isoCache.id === this.map.id) return isoCache;
    // Finish a build already under way for this field, or do the whole build now.
    if (!isoJob || isoJob.id !== this.map.id) isoJob = { id: this.map.id, gen: this.isoSteps() };
    const job = isoJob;
    while (!job.gen.next().done);
    return isoCache;
  }

  *isoSteps() {
    const B = yield* this.bakeSliced(), map = this.map, Mg = TERRAIN_MARGIN, P = GROUND_PX, Z = ISO_Z;
    const dMin = -Mg - (map.height + Mg), dMax = map.width + 2 * Mg;          // x - y
    const tMin = -Mg, tMax = (map.width + map.height) / 2 + Mg;               // (x + y) / 2
    const iw = Math.ceil((dMax - dMin) * Z), ih = Math.ceil((tMax - tMin) * Z + (B.hMax - Math.min(0, B.hMin)) * 0.9 * Z) + 2;
    const offU = -dMin * Z, offV = -tMin * Z + B.hMax * 0.9 * Z;
    const canvas = document.createElement('canvas'); canvas.width = iw; canvas.height = ih;
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(iw, ih), px = new Uint32Array(img.data.buffer);
    const { tw, th, rgba, hgt } = B;
    // Every column samples on the same grid of t, so neighbouring columns don't shimmer against each other.
    // Samples are just under a pixel apart; any gap on steep ground is filled down to the last row drawn.
    const step = 0.7 / Z;
    for (let u = 0; u < iw; u++) {
      const d = dMin + (u + 0.5) / Z;
      const t0 = Math.max(-Mg - d / 2, -Mg + d / 2), t1 = Math.min(map.width + Mg - d / 2, map.height + Mg + d / 2);
      if (t1 <= t0) continue;
      let top = Infinity;
      for (let t = Math.floor(t1 / step) * step; t >= t0; t -= step) {
        // Bilinear sample of the baked ground at (x, y).
        const fx = M.clamp((t + d / 2 + Mg) * P - 0.5, 0, tw - 1.001), fy = M.clamp((t - d / 2 + Mg) * P - 0.5, 0, th - 1.001);
        const i = fx | 0, j = fy | 0, ax = fx - i, ay = fy - j;
        const o00 = j * tw + i, o10 = o00 + 1, o01 = o00 + tw, o11 = o01 + 1;
        const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
        const h = hgt ? hgt[o00] * w00 + hgt[o10] * w10 + hgt[o01] * w01 + hgt[o11] * w11 : 0;
        const v = Math.floor(t * Z - h * 0.9 * Z + offV);
        if (v >= top) continue;
        const a = o00 * 4, b = o10 * 4, c = o01 * 4, e = o11 * 4;
        const r = rgba[a] * w00 + rgba[b] * w10 + rgba[c] * w01 + rgba[e] * w11;
        const g = rgba[a + 1] * w00 + rgba[b + 1] * w10 + rgba[c + 1] * w01 + rgba[e + 1] * w11;
        const bl = rgba[a + 2] * w00 + rgba[b + 2] * w10 + rgba[c + 2] * w01 + rgba[e + 2] * w11;
        const col = (0xff000000 | (bl << 16) | (g << 8) | r) >>> 0;      // little-endian RGBA
        const end = Math.min(top === Infinity ? v + 1 : top, ih);
        for (let row = Math.max(0, v); row < end; row++) px[row * iw + u] = col;
        top = v;
      }
      if (u % 200 === 199) yield;
    }
    ctx.putImageData(img, 0, 0);
    isoCache = { id: map.id, canvas, offU, offV, Z };
    if (isoJob && isoJob.id === map.id) isoJob = null;
  }

  // Ground height in metres; the field rises toward the sheep (smaller y), and to the east with tiltX.
  height(x, y, smooth = false) {
    if (this.flat) return 0;
    const r = this.relief;
    let h = (r.tilt || 0) * (this.map.height - y) + (r.tiltX || 0) * x;
    if (r.amp) h += (M.fbm(x / r.scale, y / r.scale, r.seed || 0) - 0.5) * 2 * r.amp;
    // Hummocks: small, close-set bumps that make rough ground read as rough.
    if (r.bumps && !smooth) h += (M.noise2(x / r.bumps.scale, y / r.bumps.scale, (r.seed || 0) + 13) - 0.5) * 2 * r.bumps.amp;
    return h;
  }

  // Speed multiplier for something heading (vx, vy) at (x, y): the surface, then the slope.
  speedMul(x, y, vx, vy) {
    const s = SURFACES[this.surface(x, y)].speed;
    if (this.flat) return s;
    const v = Math.hypot(vx, vy);
    if (v < 0.05) return s;
    const ux = vx / v * 0.5, uy = vy / v * 0.5;
    const grade = this.height(x + ux, y + uy, true) - this.height(x - ux, y - uy, true);   // hummocks don't count
    return s * M.clamp(1 - grade * 3.5, 0.7, 1.12);
  }
}

// Bake every field's ground in the background, the given field first, so picking or highlighting
// a field later doesn't stall.
function prebakeGrounds(firstId) {
  for (const m of [...MAPS].sort((a, b) => (b.id === firstId) - (a.id === firstId))) slicer.add(new Ground(m).bakeSliced());
}

// Build a field's isometric ground in the background and call `ready` when it can be drawn without a
// stall. A newer request replaces an older one still waiting.
let isoPending = null;
function prepareIso(map, ready) {
  if (isoPending) { isoPending.cancelled = true; isoPending = null; }
  if (isoCache && isoCache.id === map.id) { ready(); return; }
  if (!isoJob || isoJob.id !== map.id) isoJob = { id: map.id, gen: new Ground(map).isoSteps() };
  const gen = isoJob.gen;
  isoPending = slicer.add(gen, () => { isoPending = null; ready(); }, true);
}
