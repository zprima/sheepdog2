# Sheepdog Trials

An isometric sheepdog-trial game in plain HTML5 Canvas and JavaScript. No build step.

## Run

Open `index.html` in a browser, or serve the folder (this server disables caching so edits show up on reload):

```bash
python3 serve.py 8000
```

## Deploying

When publishing changes to GitHub Pages, bump the `?v=` number on the CSS and JS links in `index.html` so returning visitors don't mix cached old files with new ones:

```bash
sed -i '' -E 's/\?v=[0-9]+/?v=2/g' index.html
```

then visit http://localhost:8000.

## Modes

- **Trial competition** – full National-style course (outrun, lift, fetch, drive, pen; no shed), 10-minute limit, scored out of 90.
- **Free trial** – same course and scorecard, no clock.
- **Practice drills** – one part of the course, judged as in a trial, then reset automatically so you can repeat it:
  - **Outrun & lift** – send the dog from the post and lift the sheep (out of 30).
  - **Fetch** – sheep already lifted; bring them through the fetch gate to the post (out of 20).
  - **Drive** – sheep at the post; drive away, cross drive and bring them to the pen (out of 30).
  - **Pen** – sheep set out near the pen; pen them against the clock.

Drills are defined in `DRILLS` in `js/trial.js` (a phase list plus how the best run is ranked); start positions are in `Game.setup()`.

After choosing a mode you pick a field:

| Field | Location | Ground |
| --- | --- | --- |
| Hollow Meadow | Home field | Even grass (the original course) |
| Dry Creek Ranch | Texas | Mostly dry dirt, some grass, a gravel creek bed; mesquite, cactus, rocks; longest outrun |
| Planina pod Vrhom | Slovenia | Flowery alpine grass rising gently toward the sheep; spruce and a kozolec |
| Ashby Levels | England | Flat, lush grass with hedgerows and oaks; light drizzle |
| Glen Corrie | Scotland | Rolling hill ground: rough grass, heather and bracken (slow), scree, boulders, dry-stone dyke, mist; a gusty westerly that pushes the sheep downwind |
| Koivuniemi | Finland | Pale autumn grass with snow drifts (slow); birch, spruce, haystacks, a red mökki and sauna by a lake beyond the west fence; falling snow |
| Palmetto Point | Florida | Coastal turf with wadeable shallow pools, turning to slow sand toward the beach; palms, palmetto, surf beyond the fence |
| Sakura no Oka | Japan | Smaller field with a 100 m outrun; gently rolling grass strewn with fallen petals; cherry trees, stone lanterns, a bamboo fence and a torii; falling blossom |
| Via Appia | Italy | Roman Campagna: green-gold grass with poppies, the basalt Via Appia across the top of the field; umbrella pines, cypresses, olives, broken columns, a ruined aqueduct; warm haze |
| Hinterjoch Alm | Tyrol, Austria | Steep alm rising toward the sheep and to the east (cross-slope), flowery turf with slow limestone scree near the top; spruce, larch, alpine roses, log huts, a wayside shrine and a slanted-rail fence |

Surfaces and slopes change how fast the sheep (and, less so, the dog) move: uphill is slower, downhill quicker.

Each field also has its own breed of sheep with a temperament (the `sheep` entry in `MAPS`): how warily they watch the dog (`wary`), how fast they trot and run (`pace`) and how tightly they bunch (`flocking`). These are multipliers on `SHEEP_CFG`, the same for the whole flock and clamped to 0.8–1.25. A field without an entry gets neutral sheep. Glen Corrie's Blackface ewes spook early, while the Suffolk crosses at Ashby Levels are slow to stir.

## Controls

| Key | Command |
| --- | --- |
| Arrow keys | Steer the dog directly (screen directions) |
| C | Come bye – flank clockwise |
| A | Away – flank anticlockwise |
| W | Walk up |
| Space / L | Lie down |
| S | Steady (toggle half speed) |
| B | Get out (back off wide) |
| T | That'll do (return to handler) |
| + / - / wheel | Zoom |
| R | Restart · Esc: pause / menu |

On a phone or other touch screen: drag anywhere on the field for a floating stick that steers the dog, tap the command pad to whistle, and pinch to zoom. On the field list, the first tap previews a field and the second starts it. Small screens get a compact HUD (no scorecard or minimap); landscape works best.

## Structure

- `js/map.js` – course data (add new maps to `MAPS`), scenery scattering and course geometry.
- `js/terrain.js` – ground surfaces, relief (height and slope) and their effect on speed.
- `js/wind.js` – gusting wind for maps with a `wind` entry; drifts the sheep, drives the streaks, mist and wind sound.
- `js/music.js` – synthesised background music: a style per field (`MUSIC_STYLES`), a layer that joins once the run starts, ducking under whistles and an end-of-run sting.
- `js/sheep.js` – sheep state machine, flocking and per-field temperament.
- `js/dog.js`, `js/handler.js` – dog commands and the handler.
- `js/trial.js` – phases and judging rules.
- `js/render.js`, `js/minimap.js` – isometric renderer and minimap.
- `js/ui.js`, `js/input.js`, `js/game.js` – HUD, input and the game loop.
