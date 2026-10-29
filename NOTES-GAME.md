# NOTES-GAME

**Status: done (FEEL pass applied).** The client uses NET's `client/src/net/session.js` (solo / server / p2p), WORLD's `client/src/world/**` and ANIM's rigged mascot. I removed my temporary placeholders. The temporary fake session is still reachable at `?mode=fake` for quick UI tests (see below).

## What exists

| File | Role |
|---|---|
| `client/index.html`, `client/src/style.css`, `client/public/favicon.svg` | Page shell (`#world` canvas layer + `#ui` overlay) and all HUD/menu styling: dark translucent panels, teal highlights, gold accents. `--s` UI scale is set from JS on resize. |
| `client/src/main.js` | Builds the world once (renderer, arena, Effects, input, orbit camera) and shows the main menu. Creates and joins rooms through the Session API, then starts/ends `Game`. Runs the rAF loop with a dt clamp (50 ms). Mode comes from `?mode=`, otherwise `detectMode()`. Handles `?room=CODE` prefill. |
| `game/game.js` | One in-room session. It is the state store fed by session messages (players, orbs, bombs, beams, scores, phase, immunity, fear). It runs the local player in fixed substeps on the room clock, with a swept `laserHitTest` per substep (one `hit` claim per beam, skipped while immune) and balloon pickup claims (optimistic hide, restored after 1 s if unconfirmed). It interpolates remote players, drives the WORLD views, shows floating `+50/+60/+70/−20` over the scorer's head, handles NPC tips, countdown / "Start!" / "Time!", and phase music. |
| `game/player.js` | Local controller: camera-relative movement with backpedal, input-driven facing, accel/decel ramps, jump with takeoff-locked air velocity (`AIR_CONTROL`), "Cannot glide" detection, fear forced-run with edge sliding, `PLAY_LIMIT` clamp, `moveAngle`. |
| `game/tuning.js` | **All movement-feel parameters in one place**, read from `shared/config.js` (see below), plus camera and UI timing constants. |
| `game/camera.js` | MMO orbit camera. Drag with left or right mouse (yaw 360°, pitch 10–85°). Wheel zoom 4–24 m. Q/E rotate. Sensitivity comes from settings. Defaults (FEEL + CRITIC): yaw 0 (camera on the −z side), pitch 33°, distance 15 m, vertical FOV 56°, rigid follow of the mascot including the jump height. |
| `game/remote.js` | Snapshot interpolation `INTERP_DELAY_MS` (config) behind `session.now()`, α-β smoothing of horizontal samples (see below), extrapolation capped at 200 ms. Gives velocity, `vy` and `moveAngle` for animation. |
| `game/input.js` | Keyboard state. Ignores keys typed into fields, clears on blur, Space never activates buttons. |
| `game/audio.js` | Slot-based SFX and music (see Audio). |
| `game/settings.js` | localStorage: name, sensitivity, SFX volume, music volume, mute, graphics quality. |
| `game/worldApi.js` | Single import point for the World API: WORLD's modules, with `createMascot` = ANIM's `createRiggedMascot` (lead's swap; `loadMascotAssets()` in main.js). |
| `game/devSession.js` | Scripted fake of the Session API, used only with `?mode=fake` (`&fakeRound=<s>&fakeResults=<s>`). Not needed for real play. |
| `ui/menu.js` | Main menu: name, Create room, Join with code, Solo practice, detected mode, inline errors, mute button. |
| `ui/hud.js` | Room panel (code, copy code, copy invite link, mode, ping, player count, mute) and Rank panel (own row pinned in teal, sorted list, medals 1/2/3, shared ranks for ties, thousands separators, "No Point acquisition information.", footer "Displayed when points are acquired"). Also the event tracker "Jump Jump ⏱ mm:ss", key hints, red system message, big center text, NPC tip bubble ("Jump Researcher", original SVG portrait), invincible/fear chips, hit vignette, fear/immunity tints. |
| `ui/overlays.js` | Lobby side panel (code, copy buttons, player list with colours, crown, bot and you tags, host Start / Add bot / Remove bot, otherwise "Waiting for host…"). Results screen ("Jump Jump · Event Complete · Event Results", Rank · Name · Points, own row highlighted, host "Play again", back-to-lobby countdown). Tab scoreboard. Esc menu (sensitivity, SFX volume, music volume, mute, graphics quality, Resume, Leave room). |
| `ui/toast.js`, `ui/dom.js`, `ui/icons.js` | Toast line, DOM/format helpers (ranks, mm:ss, thousands), inline SVG icons (no emoji). |

## Controls
WASD or arrows move (camera-relative) · Space jump (no double jump; in mid-air it shows the red "Cannot glide in current state.") · drag with left or right mouse to orbit · wheel to zoom · Q/E rotate · hold Tab for the scoreboard · Esc menu · **M mute** (the speaker button in the room panel and on the main menu does the same; mute is saved and shows a "Muted" / "Sound on" toast).

## Movement feel (FEEL rev2 + research/CRITIC.md) — controller, camera, net smoothing
All numbers come from `shared/config.js` through `game/tuning.js` (`MOVE_FEEL`, `CAM`). No jump or feel number is hard-coded anywhere else; the physics, autopilot and tests all read the live config (`window.__jj.cfg`).
- **Direction & facing:** with `BACKPEDAL false` (current config), S turns and runs toward the camera at full speed like any other direction. With `BACKPEDAL true`, input with a backward component moves at `MOVE_SPEED × BACKPEDAL_RATIO` while facing the opposite way. Facing turns at `FACE_TURN_DEG_PER_S` toward the input direction. `moveAngle` is passed to the mascot (0 = forward, ±π = backpedal, +π/2 = moving toward the mascot's left).
- **Accel/decel:** velocity moves toward the target vector at `MOVE_SPEED/MOVE_ACCEL_MS` per ms when speeding up or changing direction, and at `MOVE_SPEED/MOVE_DECEL_MS` per ms when stopping. A D→A reversal reaches full speed at 2 × `MOVE_ACCEL_MS`.
- **AIR_CONTROL 0:** the horizontal velocity at takeoff is kept for the whole jump, and input and facing are ignored mid-air. Held input applies on the first substep after touchdown (`LANDING_LAG_MS`). Values between 0 and 1 blend toward the input.
- **Physics:** fixed 120 Hz substeps on the room clock, with the laser sweep test on every substep. `JUMP_BUFFER_MS ?? 100`.
- **Camera (CRITIC P2-6):** pitch 33°, distance 15 m, vertical FOV 56° (set on WORLD's camera by `OrbitCamera`). The focus is the mascot at `0.63 × PLAYER_HEIGHT`. Follow is **rigid**, including the full jump height.
- **Practice popups (Esc menu, default OFF, persisted as `practicePopups`):** the floating +50/−20 numbers and the red screen-edge vignette on hits. The real game has neither, so by default a hit is just ANIM's short body flash plus the sound.
- **Remote smoothing (`game/remote.js`):** interpolation runs `INTERP_DELAY_MS` (config) behind `session.now()`.
  - The Room stamps snapshot rows with its tick time, but each row holds the sender's latest `st`, which is 0–45 ms older (measured). Raw interpolation therefore wobbles the speed.
  - Horizontal samples go through an α-β filter (0.5 / 0.2), with exact resets on stops, reversals and teleports; y stays raw.
  - The client also sends `st` at a steady cadence now. The old accumulator alternated 33 and 50 ms gaps.
  - If NET ever adds a per-player sample time as `row[6]`, it is used instead and the filter is bypassed.

### `node e2e/feel-measure.mjs` — CRITIC targets, 20/20 PASS
| Metric | Ours | Target (CRITIC §2) |
|---|---|---|
| Jump airtime / apex | 0.891 s / 1.56 m (0.111 arena) | 0.89 ± 0.03 s / 1.5–1.65 m at 14 m |
| Apex timing / height at 25 % / Space→takeoff | 50 % / 76 % / 0 ms | 50 ± 5 % / 75 ± 5 % / ≤ 17 ms |
| Run speed, run ÷ fast laser | 3.20 m/s = 0.229 arena/s, 0.73× | 0.235 ± 0.02, 0.76 ± 0.06 |
| Accel to full / stop < 10 % | 50 ms / 25 ms, 0.027 m | 33–100 ms / ≤ 42 ms, < 0.1 m |
| D→A reversal: zero crossing / full speed | 58 / 100 ms | full-to-full 100–190 ms |
| Facing 180° / 90° | 217 ms / 100 ms | 160–260 ms / (info) |
| S / S+A | 1.00×, faces the camera, moves toward it / moves 135°, faces 135° | 1.0×, faces camera |
| Diagonal, air control, running jump, landing reaction | 1.000× ; Δv 0, Δfacing 0 ; 1.0× speed kept, 2.85 m = 0.204 arena ; 8 ms | 1.0× ; 0 ; 0.20 ± 0.02 arena ; ≤ 17 ms |
| Laser pass fast / slow | 3.18 s / 4.83 s | 3.1 ± 0.2 / 4.5–5.0 s |
| Arena ÷ body, camera | 13.3 ; 33° / 15 m / 56°, character fixed on screen during a jump | 13.6 ± 0.7 ; 29–36° / ~15 m / 54–58° |

### `node e2e/game-net-smooth.mjs` — 2 clients, server mode, one runs at constant speed while the other samples the rendered mascot each frame
- **Delay:** render delay 99–110 ms. That is 75 ms `INTERP_DELAY_MS` + ~2 ms LAN + ~20 ms average state age (rows stamped with the tick time, not the `st` time) + ~7 ms filter.
- **On screen (1080p):** frame-to-frame step error 0.2–0.9 px rms, slow wander 0.6–2.4 px rms.
- **Before the fix:** the same test (no filter, old send accumulator) gave frame-to-frame speed sd 28–65 % and up to 300 mm line error.
- **Remaining jitter** is sub-pixel. **For NET:** stamping each snapshot row with the room time its `st` arrived (`row[6]`), or snapping on receipt, would remove the age noise and the ~20 ms.

**Jump clearance (current config).** The feet stay above the 0.38 m clearance for 775 ms. Beam contact while standing is 232 ms (fast tier) or 352 ms (slow tier), so the standing slack is +543 / +423 ms, and running into the beam gives +641 / +608 ms. `game-laser.mjs` prints this per tier from the live config. The autopilot plans every jump from each beam's own `beamState`, so per-beam `spd` is honoured.

## Audio
These slots are agreed with SOUND (`client/public/sfx/<slot>.mp3`, listed in `sfx/manifest.json`): `jump, land, pickup_green, pickup_pink, pickup_yellow, immune_on, immune_off, laser_spawn, laser_hit, bomb_spawn, bomb_tick, bomb_boom, fear, countdown_tick, round_start, round_end, results, ui_click, ui_error, music_lobby, music_round`.
- The manifest is accepted as `{slot: {file}}`, `{slot: "file"}` or an array. `file` paths containing `/` resolve against `document.baseURI` (`sfx/jump.mp3`), and bare names resolve under `sfx/`. A missing file or decode failure falls back to a WebAudio synth per slot (music falls back to a small synth loop).
- Music uses looping `AudioBufferSourceNode` (`loop = true`) on its own bus with a 1 s crossfade: `music_lobby` plays in the menu, lobby and results, and `music_round` plays in countdown and playing. Separate SFX and Music volumes are in the Esc menu. Mute silences everything. The AudioContext unlocks on the first pointer or key gesture.
- Verified in Chromium: all 21 slots decode from the files with no 404s, and the music plays from file.

## How to test
Dev: `npx vite --port 5175 --strictPort` (repo root). Scripts live in `e2e/game-*.mjs` and the shared helpers are `game-lib.mjs` and `game-autopilot.mjs`. The autopilot runs in the page: it presses Space at a computed time before each beam and holds WASD toward balloons. Screenshots go to `research/screens/game-*.png`. Override the URL with `BASE_URL=...`.
- `node e2e/game-smoke.mjs`: menu → solo → lobby with bots → countdown → playing.
- `node e2e/game-laser.mjs`: stand still through the first beam (expects a `hit` claim). Then standing jumps (skipped if the config's slack is < 0) and running jumps into approaching beams; expects no `hit` for jumped beams. The autopilot (`game-autopilot.mjs`) plans every takeoff analytically from the live config: the takeoff delay d must satisfy d + s1 ≤ tA and d + s2 ≥ tB, and it jumps at the middle of that window.
- `node e2e/feel-measure.mjs`: the movement-feel table above (CRITIC targets).
- `BASE_URL=http://localhost:<port>/ node e2e/game-net-smooth.mjs`: remote render delay and smoothness with 2 clients in server mode.
- `node e2e/game-mascot-shots.mjs`: rigged mascot backpedal (S, S+A), side run (A), W+D and jump, each at the default camera and zoomed in, plus the default camera mid-round.
- `node e2e/game-round.mjs`: a full real 165 s solo round with 3 bots and the autopilot. It takes screenshots of pickup, immunity, bombs with yellows, fear, Tab scoreboard, Esc menu and results, and checks HUD scores against the results ranking. Long runs should use a private build (`npx vite build --outDir <tmp>` + `npx vite preview --outDir <tmp> --port 5195`), because other agents' edits make the dev server reload the page.
- `node e2e/game-ui.mjs` (fake session): `?room=` prefill, inline join error, left and right drag, wheel, Q, camera-relative W, glide message, results → Play again.
- `node e2e/game-audio.mjs`: file decoding, music, menu mute button, M key, persistence.
- Server mode: `npm run build && PORT=47820 node server/index.js`, then `BASE_URL=http://localhost:47820/ node e2e/game-multi.mjs` (two contexts) and `BASE_URL=http://localhost:47820/ SERVER_PID=<pid> node e2e/game-robust.mjs` (stall, small window, server kill).

## Test results (Chromium headless, RTX 5080 via ANGLE D3D11; no SwiftShader)
- **Laser claims (real solo Room, current config with fast and slow tiers):** standing still sent `hit` for beam 1. 4 standing jumps (takeoff windows about ±220 ms) and 4 running jumps into beams produced **0** `hit` claims on jumped beams. Beams the autopilot skipped (two beams crossing within one jump) were claimed as hits, which is correct.
- **Feel:** `feel-measure.mjs` passes 20/20 against the CRITIC targets with the current config (table above). Net smoothness is in the section above.
- **CRITIC follow-ups:** with practice popups off (the default) a hit shows no vignette and no −20 popup, and the toggle persists. Camera is 15 m / 56°. The laser test passes with both tiers (slow beams in the opening).
- **Rigged mascot (1.05 m):** S turns to face the camera and runs (BACKPEDAL off), S+A, side run, W+D, and a jump with the camera rising with it. Screenshots are `game-mascot-*.png` and `game-default-camera-midround.png`.
- **Full solo round (real Room, 3 bots), run three times (the last with the FEEL config and the rigged mascot):** every phase ran through to results. HUD scores matched the results ranking exactly, "1,390" was formatted correctly, and there were 0 console errors or warnings. Pickup, immunity, bomb + yellows, fear (forced run, tint, "Surprised!" chip), scoreboard, Esc menu and results all worked.
- **Two clients, server mode:** the invite link pre-fills the code. Bob sees Alice move (3 mm error vs her own position after settling). Countdown is in sync. Beam descriptors are identical. Clocks agree within 0.2 ms. After 35 s of play the scores are identical on both clients. Leaving through Esc → Leave room updates the host's roster. Killing the server sends you back to the menu with "Disconnected from the game server". 0 console errors.
- **Robustness:** a 2.5 s main-thread stall caused no catch-up teleport (sim clock skips ahead, max 200 ms) and `st` resumed. At 820×560 the panels don't overlap and the key hints hide. Window resize works.
- **UI:** all `game-ui.mjs` checks pass. The audio checks pass.

## Notes for others / known gaps
- **Edge beams (lead / NET):** a beam resting at ±`ARENA_HALF` is only 0.45 m from `PLAY_LIMIT` (6.55), which is inside the hit range (`LASER_HIT_HALF + PLAYER_RADIUS` = 0.51). So a player pressed against an edge is hit during that beam's spawn hold or end hold. That is consistent with `shared/lasers.js` and fair (the beam really is there), but if it isn't wanted, beams would need to rest slightly outside ±7, or the test would need to ignore hold phases.
- **Fear badge (WORLD):** the original badge reads "2" → "1" for a 2.3 s fear. My HUD chip uses `max(1, floor(s))`. The mascot nameplate badge uses `ceil` and shows "3, 2, 1".
- The autopilot is a test tool and isn't perfect at multi-beam patterns (# squares). Human play is unaffected.
- I have not tested P2P myself (NET reports it working). All my multi tests used server mode.
- **Camera framing:** at the default camera (33°, 15 m, 56°) the arena fills the view with the near edge at the bottom of the screen, as in the video. `CAM.centerBias` (0 by default) can pull the focus toward the centre if a wider view is wanted.
- **Strafe clips:** the strafe clips only blend in during turns, because facing turns to the input direction for every key at `FACE_TURN_DEG_PER_S` (800°/s). That matches the measured game: sideways runs face the movement direction.
- Optional "rename in lobby" (`name` message) is not exposed in the UI.
- `window.__jj` (`game`, `sent` claims log, `beamState`, `laserHitTest`, `cfg` = live config, `rec` = optional per-substep recorder) and `window.__app` (`menu`, `orbit`, `input`, `audio`, `game`) are debug and test hooks.
