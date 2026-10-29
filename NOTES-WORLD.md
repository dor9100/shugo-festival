# NOTES-WORLD

**Status: done (v2: CRITIC follow-up applied).** All of `client/src/world/**` follows the SPEC "World API". GAME already imports it through `client/src/game/worldApi.js`. GAME uses ANIM's rigged mascot for players. `index.html` loads with a clean console.

## v2 changes (CRITIC P2 / lead follow-up)
- **Single centre rail.**
  - Checked against the key frames 01 and 07 and the CRITIC grid: the real arena has **one** dark rail. From the default camera on the −z side it runs left to right, i.e. along x at z = 0, splitting the floor into a near half and a far half.
  - The z-axis rail and its baked floor AO are gone.
- **Config v2 sizes.** The views read everything from config: PLAYER_HEIGHT 1.05, ORB_DIAMETER 0.78, ORB_Y 0.8, BOMB_RADIUS 3.3, YELLOW_RING_RADIUS 1.5.
  - I checked them from GAME's camera (pitch 33°, distance 15, vFOV 56) against key frames 03/07/09/10. The balloon-to-mascot ratio, the bomb circle at about 0.47 arena widths, and the beams all match.
  - Polish from that comparison:
    - The laser core and floor band are thinner (the critic said "wider and softer").
    - Bomb smoke is thinner and more purple (36 puffs, alpha 0.5).
    - The pink pillar is 4.2 m tall (was 9 m) and fainter. Real pillars are short.
- **Laser speed tiers.** LaserView never assumed a speed. Every position and timing goes through `beamSegment` / `beamTimes`, which honour each beam's `spd`. The preview now spawns both tiers (`LASER_SPEED` and `LASER_SPEED_SLOW`), with slow-tier buttons and a slow opening in the auto loop.
- **Floor textures off the main thread.**
  - `floorGen.js` holds the pure, DOM-free generators. `floorWorker.js` is a module worker that runs them.
  - `floorTextures()` / `walkwayTextures()` return 1×1 placeholder `DataTexture`s at once and fill them when the worker answers. They expose `ready`.
  - If workers are unavailable, generation falls back to synchronous.
  - `createArena` main-thread cost went from about **1020 ms to about 45 ms**. The floor appears 0.4–0.7 s later. The worst frame meanwhile is about 32 ms, from the one-time 2048² upload.
- **Rigged mascots kept.** The lead's switch of spectators and the NPC to `createSpectator` / `createRiggedMascot` (ANIM) is kept. The preview also uses the rigged mascot now (`?mascot=world` shows WORLD's primitive critter).

## API recap (`client/src/world/`)

```js
createRenderer(container)      // -> { renderer, scene, camera, labelRenderer, render(), resize(), setQuality('high'|'medium'|'low'), composer, bloom, sun, quality }
createArena(scene)             // -> { update(dt, now), root, dispose() }
createMascot({ color, name, title, isLocal })   // WORLD's primitive critter (GAME now uses ANIM's createRiggedMascot instead)
new LaserView(scene)           // update(beams, now); dispose()       (per-beam `spd` honoured)
new OrbView(scene)             // add(orb); remove(id, { taken }); update(dt, now); dispose()
new BombView(scene)            // add(bomb); explode(id); update(dt, now); dispose()
new Effects(scene)             // floatText(pos, text, color); burst(pos, color); update(dt); dispose()
```

### Renderer
- Tone mapping is ACES and output is sRGB. One sun casts PCF soft shadows (r186 removed PCFSoft) from a ±12.5 m frustum. A hemisphere light and IBL from the procedural sky (PMREM) light any scene.
- Post-processing runs EffectComposer with a 4× MSAA half-float target, UnrealBloom at half resolution, then OutputPass.
  - The bloom threshold of 2.3 (linear) means only emissive things glow.
- Labels go on a CSS2D overlay layer.
- Quality levels:
  - `high`: pixel ratio up to 2, shadows with a 2048 map, bloom, 4× MSAA.
  - `medium`: pixel ratio up to 1.5, shadows with a 1024 map, bloom, 2× MSAA.
  - `low`: pixel ratio 1, no shadows, no bloom.
- `setQuality` can be called at any time.

### Arena
- **Floor:** a 2048² raked-stone "scales" texture plus a matching normal map, generated in a worker.
- **Rails and border:** one dark centre rail with teeth along x at z = 0. The copper border rail has pointed pickets.
- **Walkway:** an octagonal walkway with raked tiles (also from the worker), a balustrade, and 16 finial posts with draped cloth.
- **Surroundings:** a lawn island, flower beds, three red egg huts, eight yellow banners with pennant bunting, a tent, props, sky, rock spires, floating islands, clouds and hot-air balloons.
- **Characters:** spectators and the Festival Manager NPC (ANIM rigged).

### Lasers, balloons, bombs, effects
- **Lasers:**
  - The beam is a camera-facing ribbon with a thin white-hot core, saturated red glow and premultiplied blending.
  - Flare emitters sit on the rail, and a red floor strip lies under the beam.
  - Each beam pops in over 170 ms and fades over 200 ms.
  - Rendering is stateless (descriptors plus `now`), with pooled slots.
- **Balloons:**
  - Glossy MeshPhysical spheres with a fresnel rim, an inner glow and a thin light shaft. Pinks add a short pillar.
  - They bob and spin, and pop in at `at`.
  - They blink during the last 1.5 s, then shrink at expiry.
  - Taken balloons pop with sparkles.
  - Duplicate `add` calls are ignored.
- **Bombs:**
  - A pearl sphere drops in, sitting on an orange fuse decal whose inner disc fills over the fuse.
  - A magenta pillar shows in the last `BOMB_PILLAR_MS`.
  - `explode` gives a flash, a ring, purple smoke and sparks. It is idempotent.
  - If `explode` never arrives, the bomb auto-explodes 1.5 s after `boomAt`.
- **Effects:** pooled float-text sprites and sparkle bursts.
- **Shader warm-up (`warm.js`):** every pooled view renders once out of sight at load, so no shader compiles mid-round.

## Notes for others
- **Festival Manager:** the NPC stands at the (−x,+z) walkway corner, because screen-right is world −x from GAME's yaw-0 camera.
- **ANIM's imports:** ANIM imports `pointScaleHook` (from `mascot.js`) and `sparkleTexture` (from `textures.js`). Both are kept stable.
- **NaN guard:** every shader `pow()` base is clamped, because a NaN pixel gets smeared over the whole screen by bloom.
- **Preview build input:** `world-preview.html` is dev-only. Vite's build input is only `index.html`. The floor worker is bundled automatically through `new URL('./floorWorker.js', import.meta.url)`.

## Preview and tools
- Run `npx vite --port 5174 --strictPort` and open `/world-preview.html`.
  - Views: game cam (v2), overview, low, mascot, NPC and top.
  - Buttons spawn patterns in both tiers, bombs, pink and greens.
  - Params: `?quality=`, `?view=v2`, `?auto=0`, `?shot=1`, `?mascot=world`.
- Screenshots and perf:
  - `node client/src/world/tools/shoot.mjs --set=v2` writes `research/screens/world-v2-*.png`.
  - Without `--set` it writes the classic `world-*.png` set.
  - Add `[--perf] [--uncapped]` for performance runs.

## Screenshots (`research/screens/`)
- **v2 (GAME camera 33°/15 m/56°):** `world-v2-overview` (slow line plus balloons), `world-v2-square`, `world-v2-slow-cross`, `world-v2-balloons`, `world-v2-bomb` (2 bombs, pillars), `world-v2-explosion`, `world-v2-smoke`.
- **v1 (before the rail and size change):** `world-overview`, `world-ref`, `world-game`, `world-square`, `world-cross`, `world-low`, `world-balloons`, `world-bomb`, `world-explosion`, `world-mascot`, `world-npc`, `world-top`.

## Performance
Measured in headless Chromium on the real GPU: `ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0, D3D11)`, at 1920×1080 on high with rigged mascots.

| Metric | Result |
|---|---|
| fps with vsync, average over 5 s | **60.0** |
| fps uncapped, measured in v1 | about 270–300 |
| Draw calls per frame (all passes) | about 140 |
| Triangles | about 400k |
| `createArena` main-thread cost | about 45 ms |

The console shows no errors or warnings on the preview or `index.html`.

## Known gaps
- No normal-size humanoid spectators (optional in SPEC).
- Cloth and banners are mostly static.
- The far scenery is simple low-poly and reads plainly at very low camera angles.
- The floor and walkway show a flat placeholder grey for about 0.5 s after load, until the worker delivers.
