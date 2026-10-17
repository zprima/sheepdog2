'use strict';
// Course maps. World units are metres, x to the right and y down when viewed from above.
// Adding a map = adding an object here; buildCourse() derives all the geometry.
// props: placed scenery · scatter: seeded scenery ('edge' band inside the fence, 'field', or 'outside' it)
// terrain: see terrain.js · fence: boundary style (rail, wire, stone, hedge, bamboo, tyrol) · weather: snow, rain, mist, haze or petals.
// wind: { dir, speed, gust }, see wind.js.
// sheep: the flock's temperament, see sheepTemperament() in sheep.js. Omit for steady, neutral sheep.
const MAPS = [
  {
    id: 'hollow-meadow',
    name: 'Hollow Meadow',
    location: 'Home field',
    blurb: 'The original course. Even, well-grazed grass and a handful of oaks.',
    width: 150,
    height: 180,
    sheepCount: 5,
    sheep: { breed: 'Mule ewes', note: 'steady, dog-broke ewes', wary: 1, pace: 1, flocking: 1 },
    timeLimit: 600,                 // seconds, competition mode only
    sheepStart: { x: 75, y: 24 },   // where the sheep are set out
    post: { x: 75, y: 148 },        // handler's post
    dogStart: { x: 72, y: 151 },
    fetchGate: { x: 75, y: 86, width: 7 },
    driveGates: [
      { x: 26, y: 96, width: 7 },   // first drive gate (drive away)
      { x: 124, y: 96, width: 7 },  // second drive gate (cross drive)
    ],
    pen: { x: 93, y: 150, w: 5, h: 5 },  // mouth faces north (toward smaller y)
    terrain: { base: 'grass', bg: '#3e6e2b' },
    props: [
      { x: 14, y: 36, r: 3.2 }, { x: 20, y: 44, r: 2.4 }, { x: 136, y: 28, r: 3 },
      { x: 141, y: 60, r: 2.6 }, { x: 12, y: 130, r: 3 }, { x: 140, y: 150, r: 3.4 },
      { x: 30, y: 170, r: 2.5 }, { x: 118, y: 172, r: 2.8 }, { x: 60, y: 8, r: 2.2 },
      { x: 100, y: 10, r: 2.6 },
      { kind: 'barn', x: 78, y: -8, r: 5 },
    ],
    scatter: [{ seed: 1, region: 'outside', count: 34, kinds: [{ kind: 'oak', r: [2.2, 3.6] }] }],
  },
  {
    id: 'texas',
    name: 'Dry Creek Ranch',
    location: 'Texas, USA',
    blurb: 'Big, sun-baked ranch country: mostly bare dirt with tufts of dry grass, a gravel creek bed, mesquite, prickly pear and rocks. The longest outrun of any field.',
    width: 190,
    height: 230,
    sheepCount: 5,
    sheep: { breed: 'Rambouillet', note: 'range ewes: wary of the dog, but they flock tight', wary: 1.15, pace: 1, flocking: 1.2 },
    timeLimit: 660,
    sheepStart: { x: 95, y: 26 },
    post: { x: 95, y: 196 },
    dogStart: { x: 92, y: 199 },
    fetchGate: { x: 95, y: 108, width: 7 },
    driveGates: [{ x: 36, y: 128, width: 7 }, { x: 154, y: 128, width: 7 }],
    pen: { x: 115, y: 198, w: 5, h: 5 },
    terrain: {
      base: 'dirt',
      layers: [
        { surface: 'dry', scale: 16, above: 0.55, seed: 3 },
        { surface: 'moor', scale: 7, above: 0.8, seed: 11, opacity: 0.55 },
      ],
      // A dry creek bed winds across the field, with a little green along its banks.
      zone(x, y) {
        const d0 = Math.abs(y - (64 + x * 0.22 + Math.sin(x / 24) * 9));
        if (d0 > 9) return null;          // well clear of the creek: skip the noise
        const d = d0 + (M.noise2(x / 1.6, y / 1.6, 30) - 0.5) * 1.8 + (M.noise2(x / 6, y / 6, 31) - 0.5) * 2.4;
        if (d < 2.6) return 'gravel';
        if (d < 6.5 && M.noise2(x / 1.4, y / 1.4, 32) < 0.5) return 'dry';
        return null;
      },
      bg: '#b08e5c',
    },
    fence: { style: 'wire', post: '#7a5a3a' },
    weather: 'haze',
    props: [{ kind: 'windmill', x: 98, y: -8, r: 3 }],
    scatter: [
      { seed: 21, region: 'edge', band: 20, count: 26, kinds: [{ kind: 'mesquite', r: [2.2, 3.4], w: 3 }, { kind: 'cactus', r: [0.9, 1.5], w: 2 }, { kind: 'rock', r: [0.7, 1.5], w: 2 }] },
      { seed: 22, region: 'field', count: 9, kinds: [{ kind: 'cactus', r: [0.8, 1.2] }, { kind: 'rock', r: [0.5, 1.0] }] },
      { seed: 23, region: 'outside', count: 55, kinds: [{ kind: 'mesquite', r: [2.2, 3.6], w: 3 }, { kind: 'cactus', r: [0.9, 1.6], w: 2 }, { kind: 'rock', r: [0.8, 2.2], w: 2 }] },
    ],
  },
  {
    id: 'slovenia',
    name: 'Planina pod Vrhom',
    location: 'Slovenia',
    blurb: 'A green alpine pasture flecked with wildflowers. The ground climbs gently toward the sheep, so the outrun is uphill and the fetch runs downhill fast. Spruce woods and a kozolec hayrack.',
    width: 150,
    height: 190,
    sheepCount: 5,
    sheep: { breed: 'Jezersko-Solčava', note: 'calm mountain ewes', wary: 0.9, pace: 0.95, flocking: 1 },
    timeLimit: 600,
    sheepStart: { x: 75, y: 22 },
    post: { x: 70, y: 162 },
    dogStart: { x: 67, y: 165 },
    fetchGate: { x: 73, y: 92, width: 7 },
    driveGates: [{ x: 24, y: 110, width: 7 }, { x: 124, y: 106, width: 7 }],
    pen: { x: 90, y: 165, w: 5, h: 5 },
    terrain: {
      base: 'meadow',
      layers: [{ surface: 'lush', scale: 24, above: 0.56, seed: 5 }],
      relief: { tilt: 0.06, amp: 2, scale: 50, seed: 2, bumps: { amp: 0.12, scale: 7 } },
      bg: '#3f6f2e',
    },
    fence: { style: 'rail', rail: '#8f6a44', post: '#5e4128' },
    props: [{ kind: 'hayrack', x: 26, y: 178, len: 9 }, { kind: 'hayrack', x: 84, y: -6, len: 12, h: 5.5, r: 2 }],
    scatter: [
      { seed: 31, region: 'edge', band: 16, count: 16, kinds: [{ kind: 'spruce', r: [2.2, 3.4], w: 4 }, { kind: 'oak', r: [2.2, 3], w: 1 }] },
      { seed: 32, region: 'outside', count: 80, clump: 3, kinds: [{ kind: 'spruce', r: [2.4, 3.8] }] },
    ],
  },
  {
    id: 'england',
    name: 'Ashby Levels',
    location: 'England',
    blurb: 'Flat, lush lowland grass with daisies, hedgerows all round and old oaks. A soft English drizzle is falling and puddles have gathered in the low spots, but no excuses here: a fair field for a clean run.',
    width: 160,
    height: 170,
    sheepCount: 5,
    sheep: { breed: 'Suffolk cross', note: 'heavy lowland ewes, slow to stir', wary: 0.85, pace: 0.9, flocking: 0.95 },
    timeLimit: 600,
    sheepStart: { x: 80, y: 22 },
    post: { x: 80, y: 140 },
    dogStart: { x: 77, y: 143 },
    fetchGate: { x: 80, y: 82, width: 7 },
    driveGates: [{ x: 30, y: 94, width: 7 }, { x: 130, y: 94, width: 7 }],
    pen: { x: 98, y: 142, w: 5, h: 5 },
    terrain: {
      base: 'lush',
      layers: [
        { surface: 'grass', scale: 20, above: 0.62, seed: 8 },
        { surface: 'daisy', scale: 8, above: 0.74, seed: 9 },
      ],
      zone(x, y, m) {
        // Small rain puddles in the low spots, ringed with mud. They slow the sheep only a little.
        for (const p of m.terrain.puddles) {
          const dx = x - p.x, dy = y - p.y;
          if (dx * dx + dy * dy > (p.r + 2) * (p.r + 2)) continue;
          const d = Math.hypot(dx, dy * 1.3) + (M.noise2(x / 1.5, y / 1.5, 31) - 0.5) * p.r * 0.8;
          if (d < p.r) return 'puddle';
          if (d < p.r + 0.6) return 'mud';
        }
        return null;
      },
      puddles: [
        { x: 52, y: 40, r: 2.2 }, { x: 118, y: 30, r: 1.6 }, { x: 22, y: 62, r: 2.6 }, { x: 104, y: 62, r: 1.4 },
        { x: 92, y: 46, r: 1.2 }, { x: 60, y: 112, r: 1.8 }, { x: 142, y: 122, r: 2.4 }, { x: 26, y: 136, r: 1.7 },
        { x: 122, y: 156, r: 1.5 }, { x: 46, y: 158, r: 2.0 },
      ],
      bg: '#3a7229',
    },
    fence: { style: 'hedge' },
    weather: 'rain',
    props: [{ kind: 'stones', x: 84, y: -10, r: 6, seed: 0.42 }],
    scatter: [
      { seed: 41, region: 'edge', band: 10, count: 10, avoid: ['puddle', 'mud'], kinds: [{ kind: 'oak', r: [2.6, 3.8] }] },
      { seed: 42, region: 'outside', count: 40, kinds: [{ kind: 'oak', r: [2.6, 4.2] }] },
    ],
  },
  {
    id: 'scotland',
    name: 'Glen Corrie',
    location: 'Scottish Highlands',
    blurb: 'Rough hill grazing on the side of a glen. Rolling, uneven ground rising to the sheep, with tussocky grass, patches of heather and bracken that slow everything down, granite boulders, gorse and Scots pine inside a dry-stone dyke. A gusty westerly blows across the glen, pushing the sheep east, and mist drifts through.',
    width: 170,
    height: 200,
    sheepCount: 5,
    sheep: { breed: 'Scottish Blackface', note: 'thrawn hill ewes: they face up to the dog and take some shifting', word: 'Stubborn', wary: 0.88, pace: 0.95, flocking: 1.1 },
    timeLimit: 660,
    sheepStart: { x: 88, y: 24 },
    post: { x: 82, y: 168 },
    dogStart: { x: 79, y: 171 },
    fetchGate: { x: 85, y: 96, width: 7 },
    driveGates: [{ x: 30, y: 114, width: 7 }, { x: 140, y: 110, width: 7 }],
    pen: { x: 100, y: 172, w: 5, h: 5 },
    terrain: {
      base: 'moor',
      layers: [
        { surface: 'bracken', scale: 18, above: 0.63, seed: 2, opacity: 0.65 },
        { surface: 'heather', scale: 12, above: 0.64, seed: 5, opacity: 0.72 },
        { surface: 'scree', scale: 8, above: 0.82, seed: 9, opacity: 0.75 },
      ],
      relief: { tilt: 0.08, amp: 6, scale: 42, seed: 4, bumps: { amp: 0.35, scale: 4 } },
      bg: '#55663f',
    },
    fence: { style: 'stone' },
    weather: 'mist',
    wind: { dir: -0.3, speed: 7, gust: 0.8 },
    props: [{ kind: 'castle', x: 92, y: -7, r: 5 }],
    scatter: [
      { seed: 51, region: 'edge', band: 18, count: 24, kinds: [{ kind: 'pine', r: [2.4, 3.4], w: 2 }, { kind: 'rock', r: [0.9, 2.0], w: 2 }, { kind: 'shrub', r: [1.1, 1.6], w: 2, leaf: '#4b6a2c', flower: '#e8c63a' }] },
      { seed: 52, region: 'field', count: 9, kinds: [{ kind: 'rock', r: [0.7, 1.4] }] },
      { seed: 53, region: 'outside', count: 60, kinds: [{ kind: 'pine', r: [2.4, 3.8], w: 2 }, { kind: 'rock', r: [1.0, 2.6], w: 2 }, { kind: 'shrub', r: [1.2, 1.8], w: 1, leaf: '#4b6a2c', flower: '#e8c63a' }] },
    ],
  },
  {
    id: 'finland',
    name: 'Koivuniemi',
    location: 'Lakeland, Finland',
    blurb: 'Late-autumn pasture on a birch-wooded point in the Finnish lakeland. Pale grass with drifts of early snow that the sheep wade through slowly, haystacks and spruce, a red mökki and sauna down by the lake shore to the west, and fresh flakes falling.',
    width: 160,
    height: 190,
    sheepCount: 5,
    sheep: { breed: 'Finnsheep', note: 'quiet and easy to handle', wary: 0.9, pace: 1, flocking: 1.05 },
    timeLimit: 600,
    sheepStart: { x: 80, y: 24 },
    post: { x: 80, y: 158 },
    dogStart: { x: 77, y: 161 },
    fetchGate: { x: 80, y: 90, width: 7 },
    driveGates: [{ x: 28, y: 104, width: 7 }, { x: 132, y: 104, width: 7 }],
    pen: { x: 98, y: 160, w: 5, h: 5 },
    terrain: {
      base: 'pale',
      layers: [
        { surface: 'slush', scale: 20, above: 0.46, seed: 6 },
        { surface: 'snow', scale: 20, above: 0.52, seed: 6 },
      ],
      // A lake laps at the shore a little way beyond the west fence.
      zone(x, y) {
        if (x > -14) return null;
        const shore = -26 + Math.sin(y / 23) * 5 + (M.noise2(x / 6, y / 6, 160) - 0.5) * 4;
        if (x < shore - 3) return 'water';
        if (x < shore) return 'shallow';
        if (x < shore + 2) return 'gravel';
        return null;
      },
      relief: { amp: 1.2, scale: 50, seed: 7, bumps: { amp: 0.15, scale: 6 } },
      bg: '#4f7f9a',
    },
    fence: { style: 'rail', rail: '#8a8273', post: '#575047' },
    weather: 'snow',
    props: [
      { kind: 'hut', paint: 'falu', x: -12, y: 46, r: 3.2 },
      { kind: 'hut', paint: 'falu', x: -15, y: 128, r: 2 },   // the sauna, nearer the water
      { kind: 'flagpole', x: 84, y: -5, r: 1.5 },
    ],
    scatter: [
      { seed: 61, region: 'edge', band: 16, count: 18, clump: 2, kinds: [{ kind: 'birch', r: [1.8, 2.6], w: 3 }, { kind: 'birch', r: [1.8, 2.6], w: 1, tint: 'autumn' }, { kind: 'spruce', r: [2.2, 3.2], w: 2, snow: true }] },
      { seed: 62, region: 'edge', band: 12, count: 3, kinds: [{ kind: 'haystack', r: [1.8, 2.2], snow: true }] },
      { seed: 63, region: 'outside', count: 80, clump: 3, avoid: ['water', 'shallow', 'gravel'], kinds: [{ kind: 'birch', r: [1.8, 2.8], w: 3 }, { kind: 'birch', r: [1.8, 2.8], w: 1, tint: 'autumn' }, { kind: 'spruce', r: [2.4, 3.6], w: 2, snow: true }] },
    ],
  },
  {
    id: 'florida',
    name: 'Palmetto Point',
    location: 'Florida, USA',
    blurb: 'A coastal field running down to the Gulf. Bright turf dotted with shallow pools the sheep wade through slowly, turning to soft, slow sand toward the beach on the east side, with cabbage palms and saw palmetto. Surf rolls in beyond the fence.',
    width: 150,
    height: 180,
    sheepCount: 5,
    sheep: { breed: 'Gulf Coast Native', note: 'flighty: they spook early and run hard', wary: 1.2, pace: 1.12, flocking: 0.95 },
    timeLimit: 600,
    sheepStart: { x: 72, y: 24 },
    post: { x: 72, y: 150 },
    dogStart: { x: 69, y: 153 },
    fetchGate: { x: 72, y: 88, width: 7 },
    driveGates: [{ x: 24, y: 98, width: 7 }, { x: 120, y: 98, width: 7 }],
    pen: { x: 90, y: 152, w: 5, h: 5 },
    terrain: {
      base: 'turf',
      layers: [{ surface: 'sand', scale: 13, above: 0.66, seed: 4, bias: (x, y, m) => (x / m.width - 0.68) * 0.9 }],
      zone(x, y, m) {
        // Shallow pools the sheep can wade, slowly, ringed with wet sand.
        for (const p of m.terrain.pools) {
          const dx = x - p.x, dy = y - p.y;
          if (dx * dx + dy * dy > (p.r + 4) * (p.r + 4)) continue;
          const d = Math.hypot(dx, dy) + (M.noise2(x / 3, y / 3, 74) - 0.5) * p.r * 0.7;
          if (d < p.r) return 'shallow';
          if (d < p.r + 1.4) return 'wetsand';
        }
        const shore = m.width + 14 + Math.sin(y / 17) * 2.5;
        if (x > shore) return 'water';
        if (x > shore - 4) return 'wetsand';
        if (x > m.width - 1) return 'sand';
        return null;
      },
      shore: 14,          // metres beyond the east fence to the waterline
      pools: [{ x: 116, y: 50, r: 7 }, { x: 38, y: 60, r: 4.5 }, { x: 34, y: 136, r: 6 }, { x: 128, y: 136, r: 5 }],
      bg: '#3d8fb5',
    },
    fence: { style: 'rail', rail: '#ece8dc', post: '#d8d2c2' },
    props: [{ kind: 'lighthouse', x: 78, y: -7, r: 3 }],
    scatter: [
      { seed: 71, region: 'edge', band: 16, count: 24, avoid: ['shallow', 'wetsand'], kinds: [{ kind: 'palm', r: [2.6, 3.4], w: 2 }, { kind: 'palmetto', r: [1.2, 1.8], w: 3 }] },
      { seed: 72, region: 'outside', count: 55, avoid: ['water', 'wetsand'], kinds: [{ kind: 'palm', r: [2.6, 3.6], w: 2 }, { kind: 'palmetto', r: [1.2, 2.0], w: 3 }] },
    ],
  },
  {
    id: 'japan',
    name: 'Sakura no Oka',
    location: 'Yoshino, Japan',
    blurb: 'A gently rolling hillside in full spring blossom. Cherry trees crowd the edges and shed their petals over the grass, stone lanterns stand among them, and a vermilion torii looks down on the sheep from beyond a bamboo fence.',
    width: 140,
    height: 150,
    sheepCount: 5,
    sheep: { breed: 'Corriedale', note: 'gentle and biddable', wary: 0.9, pace: 0.95, flocking: 1 },
    timeLimit: 600,
    sheepStart: { x: 70, y: 22 },
    post: { x: 70, y: 122 },
    dogStart: { x: 67, y: 125 },
    fetchGate: { x: 70, y: 72, width: 7 },
    driveGates: [{ x: 24, y: 84, width: 7 }, { x: 116, y: 82, width: 7 }],
    pen: { x: 86, y: 124, w: 5, h: 5 },
    terrain: {
      base: 'lush',
      layers: [
        { surface: 'grass', scale: 22, above: 0.6, seed: 12 },
        // Grass flecked with fallen petals, thickest toward the fences where the cherry trees stand.
        { surface: 'petals', scale: 7, above: 0.62, seed: 13, bias: (x, y, m) => Math.max(0, 0.2 - Math.max(0, Math.min(x, y, m.width - x, m.height - y)) / 120) },
      ],
      relief: { amp: 1.6, scale: 46, seed: 9, bumps: { amp: 0.08, scale: 6 } },
      bg: '#56783c',
    },
    fence: { style: 'bamboo' },
    weather: 'petals',
    props: [{ kind: 'torii', x: 70, y: -12, len: 7, r: 5 }],
    scatter: [
      { seed: 81, region: 'edge', band: 16, count: 22, kinds: [{ kind: 'sakura', r: [2.4, 3.4], w: 4 }, { kind: 'sakura', r: [2.2, 3], w: 2, tint: 'deep' }, { kind: 'lantern', r: [0.8, 1], w: 1 }] },
      { seed: 82, region: 'outside', count: 70, clump: 2, kinds: [{ kind: 'sakura', r: [2.4, 3.8], w: 4 }, { kind: 'sakura', r: [2.2, 3.2], w: 2, tint: 'deep' }, { kind: 'pine', r: [2.4, 3.4], w: 2 }] },
    ],
  },
  {
    id: 'italy',
    name: 'Via Appia',
    location: 'Roman Campagna, Italy',
    blurb: 'Sun-warmed pasture outside Rome, green and gold and splashed with poppies. The old basalt paving of the Via Appia runs dead straight across the top of the field, a ruined aqueduct marches along the skyline, and umbrella pines, cypresses and broken columns line the way.',
    width: 160,
    height: 190,
    sheepCount: 5,
    sheep: { breed: 'Sopravissana', note: 'alert, close-flocking', wary: 1, pace: 1.05, flocking: 1.1 },
    timeLimit: 600,
    sheepStart: { x: 80, y: 24 },
    post: { x: 80, y: 158 },
    dogStart: { x: 77, y: 161 },
    fetchGate: { x: 80, y: 92, width: 7 },
    driveGates: [{ x: 28, y: 106, width: 7 }, { x: 132, y: 104, width: 7 }],
    pen: { x: 98, y: 160, w: 5, h: 5 },
    terrain: {
      base: 'campagna',
      layers: [
        { surface: 'dry', scale: 18, above: 0.6, seed: 14, opacity: 0.55 },
        { surface: 'poppy', scale: 9, above: 0.7, seed: 15 },
      ],
      // The Via Appia: a dead-straight Roman road of basalt blocks, worn and grassed over in places, with dusty verges.
      road: { y0: 62, slope: -0.12, half: 2.6 },
      zone(x, y, m) {
        const r = m.terrain.road, d = Math.abs(y - (r.y0 + r.slope * x)) / Math.hypot(1, r.slope);
        if (d > r.half + 2) return null;
        if (d < r.half) return M.noise2(x / 2.2, y / 2.2, 140) < 0.8 ? 'basalt' : 'campagna';
        return M.noise2(x / 1.3, y / 1.3, 141) < 0.6 ? 'dry' : null;
      },
      relief: { amp: 1.5, scale: 55, seed: 11, bumps: { amp: 0.06, scale: 6 } },
      bg: '#8a9a5a',
    },
    fence: { style: 'stone', wall: '#b39470', cap: '#d6c09c' },
    weather: 'haze',
    props: [
      { kind: 'aqueduct', x: 70, y: -30, len: 150, arches: 14, h: 10, ruin: true, seed: 0.37, r: 4 },
      { kind: 'temple', x: 90, y: -9, r: 5, seed: 0.3 },
      // Tombs and columns along the Appia beyond the fences.
      { kind: 'column', x: -10, y: 57, r: 1.1, seed: 0.8 }, { kind: 'column', x: -24, y: 71, r: 1, seed: 0.3 },
      { kind: 'column', x: 172, y: 35, r: 1.1, seed: 0.6 }, { kind: 'column', x: 188, y: 48, r: 1, seed: 0.1 },
      ...[-16, -34, -52, 178, 196, 214].flatMap((x, k) => [
        { kind: k % 2 ? 'cypress' : 'stonepine', x, y: 62 - 0.12 * x - 7, r: k % 2 ? 1.4 : 3.2, seed: (k * 0.37) % 1 },
        { kind: k % 2 ? 'stonepine' : 'cypress', x: x + 6, y: 62 - 0.12 * (x + 6) + 7, r: k % 2 ? 3 : 1.5, seed: (k * 0.61) % 1 },
      ]),
    ],
    scatter: [
      { seed: 91, region: 'edge', band: 16, count: 18, avoid: ['basalt'], kinds: [{ kind: 'stonepine', r: [2.6, 3.6], w: 3 }, { kind: 'cypress', r: [1.2, 1.6], w: 3 }, { kind: 'olive', r: [1.8, 2.6], w: 2 }, { kind: 'column', r: [0.9, 1.2], w: 1 }] },
      { seed: 92, region: 'outside', count: 60, clump: 2, avoid: ['basalt'], kinds: [{ kind: 'stonepine', r: [2.8, 4], w: 3 }, { kind: 'cypress', r: [1.3, 1.8], w: 3 }, { kind: 'olive', r: [1.8, 2.8], w: 3 }] },
    ],
  },
  {
    id: 'austria',
    name: 'Hinterjoch Alm',
    location: 'Tyrol, Austria',
    blurb: 'A steep summer alm high above the valley. The pasture climbs toward the sheep and tilts up to the east as well, so every leg runs across the slope. Flowery turf gives way to slow limestone scree near the top, among spruce, larch, alpine roses and a log hut, all inside a Tyrolean slanted-rail fence.',
    width: 150,
    height: 180,
    sheepCount: 5,
    sheep: { breed: 'Tiroler Bergschaf', note: 'sure-footed mountain ewes, quick to move off', wary: 1.1, pace: 1.05, flocking: 1.1 },
    timeLimit: 660,
    sheepStart: { x: 72, y: 22 },
    post: { x: 70, y: 150 },
    dogStart: { x: 67, y: 153 },
    fetchGate: { x: 71, y: 86, width: 7 },
    driveGates: [{ x: 24, y: 100, width: 7 }, { x: 122, y: 96, width: 7 }],
    pen: { x: 88, y: 153, w: 5, h: 5 },
    terrain: {
      base: 'alpine',
      layers: [
        { surface: 'edelweiss', scale: 14, above: 0.6, seed: 17 },
        // Limestone scree breaks through more and more toward the top of the alm.
        { surface: 'limestone', scale: 9, above: 0.74, seed: 18, opacity: 0.7, bias: (x, y, m) => (0.3 - y / m.height) * 0.3 },
      ],
      relief: { tilt: 0.09, tiltX: 0.035, amp: 2, scale: 48, seed: 6, bumps: { amp: 0.18, scale: 5 } },
      shadeGain: 1.5,
      bg: '#4f6e3a',
    },
    fence: { style: 'tyrol' },
    props: [
      { kind: 'hut', x: 36, y: -20, r: 4 },
      { kind: 'hut', x: 176, y: 132, r: 3.4 },
      { kind: 'shrine', x: -7, y: 146, r: 1 },
      { kind: 'chapel', x: 82, y: -7, r: 3.5 },
    ],
    scatter: [
      { seed: 101, region: 'edge', band: 16, count: 34, kinds: [{ kind: 'spruce', r: [2.2, 3.2], w: 3 }, { kind: 'larch', r: [1.8, 2.6], w: 3 }, { kind: 'shrub', r: [1.0, 1.5], w: 2, leaf: '#36592b', flower: '#d0335a' }, { kind: 'rock', r: [0.8, 1.6], w: 2 }] },
      { seed: 102, region: 'field', count: 7, kinds: [{ kind: 'rock', r: [0.6, 1.3] }] },
      { seed: 103, region: 'outside', count: 85, clump: 3, kinds: [{ kind: 'spruce', r: [2.4, 3.8], w: 4 }, { kind: 'larch', r: [2, 3], w: 3 }, { kind: 'rock', r: [1, 2.4], w: 1 }] },
    ],
  },
];

// Collision radius of each kind of prop (null = no circle) and its colour on the minimap.
const PROP_KINDS = {
  oak:      { collide: () => 0.9, mini: '#2f6b2a' },
  spruce:   { collide: () => 0.8, mini: '#22482a' },
  pine:     { collide: () => 0.7, mini: '#2d5a32' },
  birch:    { collide: () => 0.45, mini: '#8fb85a' },
  mesquite: { collide: () => 0.7, mini: '#6b7d42' },
  palm:     { collide: () => 0.5, mini: '#4f9440' },
  palmetto: { collide: (r) => r * 0.7, mini: '#5d8a3e' },
  shrub:    { collide: (r) => r * 0.75, mini: '#4b6a2c' },
  cactus:   { collide: (r) => r * 0.8, mini: '#6f9a48' },
  rock:     { collide: (r) => r * 0.85, mini: '#8b8c86' },
  haystack: { collide: (r) => r * 0.9, mini: '#c9a656' },
  hayrack:  { collide: null, mini: '#6e5134' },
  sakura:   { collide: () => 0.6, mini: '#e3a3bc' },
  lantern:  { collide: (r) => r * 0.6, mini: '#9a9890' },
  torii:    { collide: null, mini: '#c8402c' },
  stonepine:{ collide: () => 0.5, mini: '#35592f' },
  cypress:  { collide: (r) => r * 0.5, mini: '#20402a' },
  olive:    { collide: () => 0.6, mini: '#7d8b62' },
  column:   { collide: (r) => r * 0.7, mini: '#e8e2d4' },
  aqueduct: { collide: null, mini: '#b5764f' },
  larch:    { collide: () => 0.5, mini: '#5d8f3c' },
  hut:      { collide: null, mini: '#7a5234' },
  shrine:   { collide: () => 0.3, mini: '#5a3f28' },
  // Landmarks, set just beyond the top fence so they stand behind the sheep at the lift.
  barn:     { collide: null, mini: '#a8382c' },
  windmill: { collide: null, mini: '#9a9c98' },
  stones:   { collide: null, mini: '#8e8c84' },
  castle:   { collide: null, mini: '#7c7a72' },
  flagpole: { collide: null, mini: '#2a5aa8' },
  lighthouse: { collide: null, mini: '#f0ede4' },
  chapel:   { collide: null, mini: '#ece6d6' },
  temple:   { collide: null, mini: '#e8e2d4' },
};

// Place a map's seeded scenery, keeping clear of the course so it never blocks a gate or the pen.
function scatterProps(map, ground) {
  const out = [];
  const W = map.width, H = map.height, pen = map.pen;
  const keep = [
    { x: map.sheepStart.x, y: map.sheepStart.y, r: 16 }, { x: map.post.x, y: map.post.y, r: 12 },
    { x: pen.x + pen.w / 2, y: pen.y + pen.h / 2, r: 14 }, { x: map.fetchGate.x, y: map.fetchGate.y, r: 10 },
    { x: pen.x + pen.w / 2 - 8, y: pen.y - 25.5, r: 8 },     // where pen training sets the sheep out
    ...map.driveGates.map(g => ({ x: g.x, y: g.y, r: 11 })),
  ];
  const lines = [[map.sheepStart, map.post], [map.post, map.driveGates[0]], map.driveGates, [map.driveGates[1], { x: pen.x, y: pen.y }]];
  const clear = (x, y, r, region) => {
    for (const k of keep) if (Math.hypot(x - k.x, y - k.y) < k.r + r) return false;
    if (region === 'field') for (const [a, b] of lines) if (M.distToSeg(x, y, a.x, a.y, b.x, b.y) < 10 + r) return false;
    for (const p of [...(map.props || []), ...out]) {
      const d = p.len ? M.distToSeg(x, y, p.x - p.len / 2, p.y, p.x + p.len / 2, p.y) : Math.hypot(x - p.x, y - p.y);
      if (d < (p.r || 2) + r + 1.5) return false;
    }
    return true;
  };
  for (const sc of map.scatter || []) {
    const rnd = M.rng(sc.seed), band = sc.band || 18, total = sc.kinds.reduce((s, k) => s + (k.w || 1), 0);
    const pickKind = () => { let v = rnd() * total; for (const k of sc.kinds) if ((v -= k.w || 1) <= 0) return k; return sc.kinds[0]; };
    const spot = () => {
      if (sc.region === 'field') return [12 + rnd() * (W - 24), 12 + rnd() * (H - 24)];
      if (sc.region === 'edge') {
        const side = Math.floor(rnd() * 4), d = 4 + rnd() * (band - 4), t = 4 + rnd() * ((side % 2 ? H : W) - 8);
        return [[t, d], [W - d, t], [t, H - d], [d, t]][side];
      }
      const m = TERRAIN_MARGIN - 8, x = -m + rnd() * (W + m * 2), y = -m + rnd() * (H + m * 2);
      return x > -6 && x < W + 6 && y > -6 && y < H + 6 ? null : [x, y];
    };
    let placed = 0;
    for (let tries = 0; placed < sc.count && tries < sc.count * 40; tries++) {
      const s = spot();
      if (!s) continue;
      const k = pickKind();
      const group = Math.max(1, Math.round((sc.clump || 1) * (0.5 + rnd())));
      for (let g = 0; g < group && placed < sc.count; g++) {
        const x = s[0] + (g ? (rnd() - 0.5) * 9 : 0), y = s[1] + (g ? (rnd() - 0.5) * 9 : 0);
        const r = k.r[0] + rnd() * (k.r[1] - k.r[0]);
        if (sc.region !== 'outside' && (x < 3 + r * 0.5 || y < 3 + r * 0.5 || x > W - 3 - r * 0.5 || y > H - 3 - r * 0.5)) continue;
        if (sc.avoid && sc.avoid.includes(ground.surface(x, y))) continue;
        if (!clear(x, y, r, sc.region)) continue;
        const p = { kind: k.kind, x, y, r, seed: rnd() };
        for (const f of ['leaf', 'flower', 'tint', 'snow']) if (k[f] !== undefined) p[f] = k[f];
        out.push(p);
        placed++;
      }
    }
  }
  return out;
}

function mapById(id) { return MAPS.find(m => m.id === id) || MAPS[0]; }

// Fetch/drive gates are two hurdle panels with a gap between them.
function makeGate(g, dir) {
  const [dx, dy] = M.norm(dir.x, dir.y);
  const px = -dy, py = dx;              // perpendicular (lies along the gate line)
  const half = g.width / 2, panel = 2.4;
  const hurdles = [
    { ax: g.x + px * half, ay: g.y + py * half, bx: g.x + px * (half + panel), by: g.y + py * (half + panel) },
    { ax: g.x - px * half, ay: g.y - py * half, bx: g.x - px * (half + panel), by: g.y - py * (half + panel) },
  ];
  return { x: g.x, y: g.y, width: g.width, dir: { x: dx, y: dy }, perp: { x: px, y: py }, hurdles };
}

function buildCourse(map) {
  const post = map.post, start = map.sheepStart;
  const [ax, ay] = M.norm(start.x - post.x, start.y - post.y);
  const axis = { x: ax, y: ay }, axisPerp = { x: -ay, y: ax };

  const fetchGate = makeGate(map.fetchGate, { x: post.x - start.x, y: post.y - start.y });
  const g1 = makeGate(map.driveGates[0], { x: map.driveGates[0].x - post.x, y: map.driveGates[0].y - post.y });
  const g2 = makeGate(map.driveGates[1], { x: map.driveGates[1].x - map.driveGates[0].x, y: map.driveGates[1].y - map.driveGates[0].y });

  const p = map.pen;
  const openAngle = -1.0, closedAngle = -Math.PI;   // hinge at NE corner, gate swings out to the north-east
  const pen = {
    x: p.x, y: p.y, w: p.w, h: p.h,
    hinge: { x: p.x + p.w, y: p.y },
    len: p.w, openAngle, closedAngle, gateT: 0,
    mouth: { x: p.x + p.w / 2, y: p.y - 1.5 },
    walls: [
      { ax: p.x, ay: p.y, bx: p.x, by: p.y + p.h },                   // west
      { ax: p.x, ay: p.y + p.h, bx: p.x + p.w, by: p.y + p.h },       // south
      { ax: p.x + p.w, ay: p.y + p.h, bx: p.x + p.w, by: p.y },       // east
    ],
    gateSeg() {
      const a = M.lerp(this.openAngle, this.closedAngle, M.easeInOut(this.gateT));
      return { ax: this.hinge.x, ay: this.hinge.y, bx: this.hinge.x + Math.cos(a) * this.len, by: this.hinge.y + Math.sin(a) * this.len };
    },
    inner() { return { x: this.x + 0.4, y: this.y + 0.4, w: this.w - 0.8, h: this.h - 0.8 }; },
    outer() { return { x: this.x - 0.3, y: this.y - 0.8, w: this.w + 0.6, h: this.h + 1.1 }; },
  };
  const og = pen.gateSeg();
  const ox = Math.cos(openAngle), oy = Math.sin(openAngle);
  pen.handlerSpot = { x: og.bx + ox * 1.4 + 0.5, y: og.by + oy * 1.4 };

  const inset = 2;
  const b = { x: inset, y: inset, w: map.width - inset * 2, h: map.height - inset * 2 };
  const boundary = [
    { ax: b.x, ay: b.y, bx: b.x + b.w, by: b.y },
    { ax: b.x + b.w, ay: b.y, bx: b.x + b.w, by: b.y + b.h },
    { ax: b.x + b.w, ay: b.y + b.h, bx: b.x, by: b.y + b.h },
    { ax: b.x, ay: b.y + b.h, bx: b.x, by: b.y },
  ];
  const ground = new Ground(map);
  if (!map.allProps) map.allProps = [...(map.props || []), ...scatterProps(map, ground)];
  const props = map.allProps;
  const circles = [], propWalls = [];
  for (const t of props) {
    const k = PROP_KINDS[t.kind || 'oak'];
    if (k.collide) circles.push({ x: t.x, y: t.y, r: k.collide(t.r) });
    if (t.kind === 'hayrack') propWalls.push({ ax: t.x - t.len / 2, ay: t.y, bx: t.x + t.len / 2, by: t.y });
  }
  const staticWalls = [...boundary, ...pen.walls, ...fetchGate.hurdles, ...g1.hurdles, ...g2.hurdles, ...propWalls];

  return {
    map, ground, wind: map.wind ? new Wind(map.wind) : null, props, post, start, axis, axisPerp, fetchGate, driveGates: [g1, g2], pen, bounds: b, boundary, staticWalls, circles,
    legs: {
      FETCH: { a: start, b: post },
      DRIVE1: { a: post, b: { x: g1.x, y: g1.y } },
      DRIVE2: { a: { x: g1.x, y: g1.y }, b: { x: g2.x, y: g2.y } },
      DRIVE3: { a: { x: g2.x, y: g2.y }, b: pen.mouth },
    },
    walls() { return [...this.staticWalls, this.pen.gateSeg()]; },
  };
}
