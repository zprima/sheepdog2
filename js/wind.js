'use strict';
// Wind on fields that have one (map.wind). `dir` is the way it blows toward (world radians: 0 = east,
// π/2 = south, so -π/2 blows up the field toward the sheep), `speed` its mean in m/s and `gust` how far
// it rises and falls. The sheep drift downwind, more in the gusts; the renderer and sound follow it too.
class Wind {
  constructor(cfg) {
    this.dir = cfg.dir;
    this.base = cfg.speed;
    this.gust = cfg.gust || 0;
    this.t = Math.random() * 100;
    this.update(0);
  }

  update(dt) {
    const t = (this.t += dt), g = this.gust;
    // A slow swell, plus gusts that build and die away every ten seconds or so.
    const swell = Math.sin(t * 0.21) * 0.5 + Math.sin(t * 0.53 + 1.3) * 0.3;
    const gust = Math.pow(Math.max(0, Math.sin(t * 0.6 + 0.7)), 3) * Math.max(0, Math.sin(t * 0.17));
    this.speed = Math.max(0, this.base * (1 + g * (swell * 0.4 + gust * 1.4)));
    this.angle = this.dir + Math.sin(t * 0.13) * 0.2 + Math.sin(t * 0.41) * 0.08;
    this.x = Math.cos(this.angle) * this.speed;
    this.y = Math.sin(this.angle) * this.speed;
  }

  // Roughly 0 (calm) to 1 (a strong gust).
  get strength() { return M.clamp(this.speed / (this.base * (1 + this.gust * 1.6)), 0, 1); }
}
