# NOTES-ANIM: rigged, clip-animated mascot

A drop-in alternative to WORLD's `createMascot` (SPEC "World API" → mascot) that animates with **real animation clips** on a
skeleton. The body ("Pompom", an original cute festival critter: cream fur, big head, tall ears with caramel tips, a flower
pin, a robe in the player colour with gold trim, a belt bow and collar bell, a bushy plume tail) is built in code on that
skeleton in chibi proportions. Nothing outside `client/src/anim/**`, `client/public/models/**`, `client/anim-preview.html`,
`tools/anim/**` and this file was touched.

## v3 (critic round 2)
- **First-immunity hitch fixed** (was 114 + 62 ms):
  - The mascot material is now permanently `transparent: true` (opacity 1, depthWrite on). Immunity only changes uniforms, so the shader is never recompiled.
  - Self warm-up: the first mascots that render carry the aura and hit-spark sprites, using their *original shared* materials, drawn at y = −1000 for about 6 renders. Those materials are never disposed, so the compiled programs stay cached. (Warming with disposable clones did not work: disposing them released the programs.)
  - `node research/critic-tools/immune-hitch.mjs http://localhost:8098/?mode=solo` (vite build + `PORT=8098 node server/index.js`), 3/3 runs: first-immune frames [0,4,5,4,9,6], [0,4,5,3,16,6], [0,5,5,4,8,5] ms. The preview confirms no program is added at first immunity or first hit.
  - Hit flash, fear and emotes never change shaders.
  - Optional explicit warm-up, if wanted: `import { warmMascotShaders } from './anim/riggedMascot.js'; await warmMascotShaders(renderer, scene, camera);` Call it after the renderer and scene exist, with the render loop running. It renders a hidden immune + hit dummy through `compileAsync` plus 3 frames, then removes it.
- **Run pose (critic P2):**
  - Forward lean scaled by speed (`TUNING.runLean` 0.42 rad at MOVE_SPEED). It is applied after the clips to spine_01/03/05 only, with the head countering 35%. Backpedalling leans back slightly.
  - The pelvis and legs are untouched, so foot plant is unchanged: 0.16 / 0.23 m/s at 3.2 m/s.
  - Note for anyone adding procedural bone edits: three's mixer only writes values that changed since the last frame, so the clip pose is saved and restored around the lean, otherwise it would accumulate on paused or identical frames.
  - The tail un-curls and streams flat behind when running, fluttering with the stride (`anim-v3-runline-*-strip.png`, `anim-v3-run.png`).
- The lead's fear-badge rounding (`Math.round`, min 1) is kept.

## v2 (critic follow-up, research/CRITIC.md; config now PLAYER_HEIGHT 1.05, MOVE_SPEED 3.2, JUMP_AIRTIME 0.891)
- **Hit = short orange burst, no flinch.** `flashHit()` now does three things:
  - The albedo is pushed to orange (`uHit` shader uniform) with a little orange emissive, decaying over `TUNING.hitFlash` = 0.1 s. That is 5 frames at 60 fps (`anim-v2-hit-*-strip.png`).
  - A small additive orange spark burst plays (shared geometry; one Points per mascot, created on the first hit; `TUNING.hitSparks` = 0.3 s).
  - The additive `Hit_F` flinch is **off** (`TUNING.hitFlinch` = 0). It can be enabled per mascot with `createRiggedMascot({ hitFlinch: 0.3 })`.
- **Foot slide fixed.** The cause was not the rate cap. `CLIP_SPEED` had been measured on the ankle, which rotates during stance: 3.9 m/s against a true 4.95 m/s measured on the ball/toe bones in contact (`tools/anim/stride.mjs`). Playback therefore ran about 27% too fast and the planted foot slid backward.
  - Fixed values: run, strafe and fear 4.95, backpedal 5.3. `TUNING.rateMax` is now 4.2, `TUNING.stride` is 1, and the hip spacing is 1.5 (was 1.95: the pelvis twist on wide hips added slide).
  - Measured in the page with the critic's metric (planted ball speed over the lowest-20% height samples, 60 Hz sim, straight run at 3.2 m/s, `__anim.measureSlide()` / `shots.mjs --slide`): **L 0.15 / R 0.22 m/s, down from 0.92**.
  - The residual is the clip's heel-to-toe roll; a strict 6 mm contact window gives the same figure. At 3.2 m/s the cadence is 2.15× (about 6.5 steps/s).
- **Sized for PLAYER_HEIGHT 1.05.** Everything still derives from `PLAYER_HEIGHT`:
  - The body is scaled so the ear tips sit at 1.05 m.
  - The nameplate anchor is at 1.1 × PLAYER_HEIGHT.
  - The immune aura and the hit sparks are scaled by PLAYER_HEIGHT.
  - Spectators inherit the scale.
- **Jump unchanged:** still scrubbed by `vy`, so it auto-fits the new 0.891 s airtime. The critic measured takeoff and touchdown within 1 frame of physics.
- **Preview additions:**
  - `?cam=game`: the game's default camera (pitch 33°, 15 m slant, vFOV 56, from −z).
  - `runline`: a straight run demo.
  - `?prop.<name>=` overrides proportions for experiments.
  - `__anim.measureSlide()`, `__anim.TUNING`.
- **Shots:** `anim-v2-game.png`, `anim-v2-gameperf.png` and `anim-v2-gamearena.png` are from the game camera. Close-ups: `anim-v2-local-idle.png` (own nameplate) and `anim-v2-immune.png`. Strips: `anim-v2-hit-*-strip.png` and `anim-v2-runline-*-strip.png`.
- **Perf (same machine):** 12 + 16 mascots run at about 750 fps uncapped. Animation CPU is 0.36 ms/frame. Players are 8.9k triangles each, spectators 3.8k.

## Files
| File | What |
|---|---|
| `client/public/models/mascot-anims.glb` | **173.5 KB**. Skeleton (26 joints, UE-Manny layout, fingers removed) + 16 clips. No mesh. int16 rotations, `EXT_meshopt_compression` (three's `MeshoptDecoder`). |
| `client/src/anim/riggedMascot.js` | `loadMascotAssets()`, `createRiggedMascot()`, `createSpectator()`, `TUNING`. State machine, effects, spectator brain. |
| `client/src/anim/rig.js` | GLB loading (cached), chibi rig template (`PROPS`), extra procedural bones (ears, 3-bone tail), clip prep (hips track scaling, additive hit, IK-solved clap). |
| `client/src/anim/body.js` | Body geometry: primitives merged into **one skinned geometry shared by all mascots** (vertex colours, `aTint` robe mask). `detail` factor gives a spectator LOD. |
| `client/src/anim/nameplate.js` | CSS2D nameplate per SPEC (title + name; own = green + red/blue bar; fear "2"/"1" badge; npc = teal). |
| `client/anim-preview.html`, `client/src/anim/preview.js` | Preview (see below). |
| `tools/anim/*` | `build-clips.mjs` (builds the glb), `analyze.mjs` (FK: root motion, foot contact, stride speed, per-frame jump data), `inspect.mjs` (lists skeleton/clips of any glb), `compare-rest.mjs` (rest-pose compatibility), `shots.mjs` (Playwright screenshots, strips, perf), `sheet.mjs` (contact sheets), `lib.mjs`. Own `package.json` (`@gltf-transform/*`, `meshoptimizer`). |

Rebuild the clips: `cd tools/anim && npm install && cd ../.. && node tools/anim/build-clips.mjs -v` (about 1 s).

## Skeleton and clip sources (all read-only, in `C:\Users\Dor\Desktop\repos\fun-game-test`)
One skeleton: the **UE5 Manny layout used by eclipse-tenkahoho's fighters** (`eclipse-tenkahoho/public/assets/fighters/*.glb`).
The raw Fighter pack clips and every fighter glb share **the same rest pose** (max 0.05° difference, `tools/anim/compare-rest.mjs`),
so clips from both combine with no retargeting.

| Clip (in glb) | Source | Notes |
|---|---|---|
| `idle` | `eclipse/shared/animation packs/fighter-manny/clips-manny/Idle_Seq` (UE Fighter Animations Pack) | 10 s breathing idle |
| `run` | `…/Run_F_0_Loop_IP_Seq` | in-place loop, 0.667 s, 3.9 m/s at full size |
| `run_back` | `…/Run_B_180_Loop_IP_Seq` | backpedal, 0.667 s |
| `strafe_l` / `strafe_r` | `…/Run_F_L_90_Loop_IP_Seq` / `…/Run_F_R_90_Loop_IP_Seq` | 0.667 s, synced with run |
| `sprint` | `…/Run_Fast_Loop_IP_Seq` | in the glb, currently unused |
| `jump_air` | `…/Jump_0_Start` 0.15–0.40 s + `Jump_0_Loop` + `Jump_0_End` 0–0.133 s | one normalised 1 s timeline (liftoff → apex → touchdown); the baked 0.41 m of jump height was removed (feet pinned) |
| `jump_land` | `…/Jump_0_End` 0.133–0.767 s | landing crouch and recovery |
| `hit`, `hit_b` | `…/Hit_F_Seq`, `…/Hit_B_Seq` | used as **additive** upper-body flinches (`hit_add`) |
| `fear` | legs and hips from `Run_F_0_Loop_IP`, upper body from `fighters/maor.glb` `Maor_Waaa_Loop` | panic run: arms flailing overhead, head thrown back |
| `cheer` | `fighters/maor.glb` `Maor_Victory` | hopping side to side, arms up waving in turn |
| `jazz` | `fighters/boolbooloni.glb` `Bool_JazzHands` | jazz hands by the face, knee bobs |
| `victory` | `fighters/boolbooloni.glb` `Bool_Victory` | hand behind head, pointing at the sky |
| `wave` | `fighters/ofek.glb` `Wave` | people-kit gesture retargeted onto the fighter rig |
| `idle_hips` | `fighters/ofek.glb` `Idle_Hips` | hands on hips (spectator idle variant) |
| `clap` (runtime) | synthesised in `rig.js` | two-bone IK on the chibi arms over `idle_hips`, two claps per 0.8 s |

What `build-clips.mjs` keeps: rotations of the 26 joints and the pelvis translation (hips height and sway). It drops root-bone
motion (clips are in place), every other translation, scale and the fingers. It resamples at 30 fps, reduces keys
(1.5 mrad / 0.8 mm tolerance), and removes the residual horizontal pelvis drift in loops.

Licensing: the Fighter pack clips are from the user's UE marketplace demo pack. The `Maor_*` and `Bool_*` clips were authored
in eclipse-tenkahoho. Treat these as the user's assets. The body is original and procedural.

## Chibi proportions
`PROPS` in `rig.js` scales each bone's offset from its parent: legs 0.31, spine 0.4, shoulders 0.74, arms 0.42, neck 0.2–0.25,
hip spacing ×1.95. Clips drive rotations only, so they still work. The **pelvis translation track is multiplied by `PROPS.legs`**,
so the feet stay on the ground. A uniform scale then makes the ear tips exactly `PLAYER_HEIGHT` tall. The head is about 40% of
the height. Origin is at the feet; the mascot faces +Z, and its left is +X.

## API (same as SPEC's Mascot, plus small extras)
```js
import { loadMascotAssets, createRiggedMascot, createSpectator } from './anim/riggedMascot.js';
await loadMascotAssets();               // optional: createRiggedMascot also works before this resolves (the body attaches when ready)
const m = createRiggedMascot({ color, name, title, isLocal, npc?, hat?, scale? });
m.root; m.label;                        // Group (origin at feet, faces +Z); CSS2DObject nameplate
m.update(dt, { moving, speed, airborne, vy, feared, immune, fearLeftMs, moveAngle?, hit? });
m.setName(n); m.setTitle(t); m.setColor(hex); m.flashHit(); m.dispose();
m.emote('cheer'|'jazz'|'victory'|'clap'|'wave'|'idle_hips'|null);   // extra: results screen / lobby (only shows while standing)
const s = createSpectator({ color, scale? }); s.update(dt, { excitement?: 0..1 }); s.cheer(seconds);   // no nameplate (label = null)
```
`moveAngle` matches GAME's `player.moveAngle` and `remote.moveAngle` (0 = forward, +π/2 = moving to the character's left).
`hit` is edge-triggered, the same as calling `flashHit()`.

### State machine (`update`)
- **Locomotion:** a four-way blend: run, backpedal, strafe left and strafe right, weighted cos² and sin² of `moveAngle` and smoothed. All four loops (and `fear`) are **driven by one shared phase**, so blends and run↔fear transitions never break the step. Playback rate = `speed` ÷ (the clip's planted-foot speed × leg scale × body scale), clamped to `TUNING.rateMin..rateMax` (0.75..4.2).
- **idle ↔ run:** about 0.1 s fades (`TUNING.fade`). All weights always sum to 1, so the rest pose never bleeds through.
- **Jump:** `jump_air` is **scrubbed by `vy`**: phase = (JUMP_VELOCITY − vy) / (2·JUMP_VELOCITY). It therefore spans exactly the physics airtime and follows `JUMP_AIRTIME` and `JUMP_VELOCITY` from `shared/config.js` if they change. Without `vy` it falls back to airtime ÷ `JUMP_AIRTIME`. On touchdown `jump_land` plays at 1.4×; it is cut to about 0.07 s when you land while moving.
- **Fear:** the `fear` panic run, with ears flattened and shaking and the tail wagging fast. The nameplate shows the fear badge.
- **Hit:** an orange 0.1 s body burst plus orange sparks (v2). The additive `Hit_F` flinch is optional and off by default.
- **Immune:** pale-gold pulsing emissive, a stronger rim, 0.72 opacity and a sparkle aura (shared points; uses WORLD's exported `pointScaleHook` and `sparkleTexture`).
- **Procedural extras after the clips:** the ears drag when running, flop with `vy`, flatten when feared and twitch at random. The tail wags (faster when running or panicking) and lifts with `vy`.
- **Spectators:** a random cycle of idle, cheer, clap, jazz hands, wave, hands-on-hips and victory, with random start offsets and a 0.75 chance to return to idle. Animation updates at 20 Hz (`TUNING.spectatorHz`). They use the low-tessellation body.

## How to swap it in (for the lead / GAME / WORLD)
1. GAME, `client/src/game/worldApi.js`: `export { createRiggedMascot as createMascot, loadMascotAssets } from '../anim/riggedMascot.js';`
   and `await loadMascotAssets()` during boot. This is optional but avoids a few frames with no body. `game.js` needs no other change: it already passes `moveAngle`, `vy` and the rest.
2. WORLD, `arena.js`, spectators (optional): `createSpectator({ color, scale })` instead of `createMascot({ color, name: '', scale })`, and call `s.update(dt, { excitement })` in `arena.update`. Use `s.cheer(3)` after a boom or at results.
   NPC: `createRiggedMascot({ color: '#7b2430', name: 'Shugo Festival Manager', npc: true, hat: '#d4282a' })`.
3. Results screen: `mascot.emote('cheer')` for the winners, if wanted.
4. Prod build: the glb is in `client/public/models/` and is loaded from `new URL('models/mascot-anims.glb', document.baseURI)`, so it works under `base: './'` and GitHub Pages sub-paths.

## Preview
`npx vite --port 5177 --strictPort`, then open `http://localhost:5177/anim-preview.html`.
- Default view: a controllable mascot (WASD with camera-relative movement, Space jump using the real `MOVE_SPEED`, `JUMP_VELOCITY` and `GRAVITY`; hold Shift to keep facing and get strafe or backpedal; F fear, H hit, I immune, C cheer) plus a ring of labelled demo mascots, each looping one state: idle, run, back, strafe L/R, jump (real physics), run+jump, fear, hit, immune, cheer, clap, jazz, victory, wave, runner (runs a circle at full speed), and the hat NPC.
- `?perf=1`: 12 players + 16 spectators. `?arena=1`: inside WORLD's arena. `?solo=<state>&shot=<state>&dist=&pitch=&yaw=`: one mascot, framed. `window.__anim` exposes `focus`, `setPaused`, `step`, `fps` and `cpu`.
- Screenshots: `node tools/anim/shots.mjs "run@2.2,8,90" … [--strip=8 --step=40] [--perf --uncapped]`. Strips are deterministic: the sim is paused and stepped between frames.

## Verification (Playwright, GPU: ANGLE D3D11 on an RTX 5080, 1280×720, WORLD renderer with bloom and shadows)
- `research/screens/anim-{idle,run,back,strafe_l,jump,fear,hit,immune,cheer,clap,jazz,victory,wave,npc}.png`, `anim-sheet.png` (contact sheet),
  `anim-strip-{jump,run,hit,strafe_l,fear}-*.png` (motion strips), `anim-overview.png`, `anim-arena.png` (in WORLD's arena), `anim-perf.png`.
- No console errors or warnings.
- **Perf, 12 players + 16 spectators, all on screen:** about 640 fps uncapped (`--disable-gpu-vsync`); 60 fps vsync-capped with the minimum also 60. Animation CPU for all 28: **0.45 ms/frame**. 72 draw calls (body + shadow per mascot, aura only when immune). Players are 8.9k triangles each; spectators use a lower-detail body (3.8k triangles each); 31 bones per skeleton. Frame total about 330k triangles including the shadow pass. Asset load is about 50 ms.

## Gaps / known limits
- **Foot plant:** planted to about 0.2 m/s at 3.2 m/s (v2). Feet stay planted up to about 6 m/s (`rateMax` 4.2). Above that they slide.
- The legs are mostly under the robe. The run reads mainly through the feet, arm pumping, forward lean, bob and tail. The robe hem follows the thighs through skinning, but the shins can clip through the hem on high knee lifts.
- Big head vs short arms: raised arms in cheer and victory pass close to the head sides and can clip slightly.
- `clap` is synthesised (no clap clip exists in any of the libraries). `sprint` is in the glb but unused.
- There is no turn-in-place clip; facing changes are handled by GAME rotating `root`.
- The hit flash plus aura uniform time is per-frame global (shared material). That is fine for the current use.
- The nameplate is my own CSS (`am-*`) mirroring WORLD's `wm-*` look. WORLD does not export its nameplate. If WORLD restyles theirs, mirror it here.
- `riggedMascot.js` imports `pointScaleHook` from `world/mascot.js` and `sparkleTexture` from `world/textures.js`. If WORLD renames these, update the import.
