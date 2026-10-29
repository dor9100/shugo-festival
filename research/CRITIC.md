# CRITIC: how close is the clone to the real "Jump Jump"?

## Round 2 (re-review of the fixed build): **8.5 / 10**

I rebuilt (`npx vite build`), served dist on :8095 and re-ran every measurement:
- `feel-check.mjs` and `clone-screen.mjs` (1080p geometry);
- a new recorded round `critic/clone_round2.mp4`, 0–68 s;
- 60 fps canvas captures for running;
- the schedule timeline over 4 seeds (`timeline.mjs`);
- a 2-client server-mode session (`net-check.mjs`);
- frame-time hitch logging (`hitch-check.mjs`, `immune-hitch.mjs`).

The new side-by-side sheets are `critic/side-by-side-v2-1-slow-tutorial.jpg`, `-v2-2-chains.jpg` (slow chain plus fast lines), `-v2-3-bombs.jpg`, `-v2-4-jump-over-beam.jpg` and `-v2-5-running.jpg`. No console errors or warnings appeared in any run.

### Fixed (verified)

| Item | Round 1 | Round 2 (measured) | Real |
|---|---|---|---|
| Laser tiers | one speed, 3.34 s | slow tier 2.9 m/s (first chain fits at 3.10 = 0.222 arena/s) and fast tier 4.4 m/s (3.18 s). Tutorial plus everything up to 47 s is slow; 74 s onward is 70/30 fast/slow | slow 0.19–0.23 and fast 0.31–0.34 arena/s ✅ |
| Timeline (laser-on segments) | first chain at 24.2 s | 10–16.6 · **21.7**–45.1 · 48.8–53.7 · 74.0–78.9 … 147.0–160.5. Total on-time 91–98 s over 4 seeds | 10.4–15.1 · 21.7–37.1 · 38.2–46.4 · 48.9–54.7 · 74.2–79.3 … 145.9–160.5, 94 s ✅ |
| Mascot size, on screen at 1080p | 0.087 of arena width, 11.4 bodies/arena | **0.073** (67.5 px / ~925 px), ≈13.7 bodies/arena | 0.070–0.075 ✅ |
| Jump drop ÷ body, on screen | 0.95 | **1.19** | 1.17–1.25 ✅ |
| Jump drop ÷ arena | 0.085 | 0.0865 | 0.087–0.093 ✅ |
| Start / reversal / stop | 25 / 50 / 25 ms | **67 / 133 / 25 ms** | median ~67 / 100–170 / 1–2 frames ✅ |
| Facing, 180° turn | 150 ms | **217 ms** | ~230 ms ✅ |
| Foot slide while running | 0.92 m/s | **0.14–0.18 m/s** | ≈0 ✅ |
| Camera | 33° / 13 m / 60° (near border cut off) | 33° / 15 m / 56°. Whole arena framed like the real game: far border, rail and near border at rows 384 / 577 / 1007 px, against 401 / 571 / 970 px in real frame 3960 | ✅ |
| Remote players | 117 ms late, 20 Hz | **59 ms** late. Speed jitter on the viewing screen is 4% (sd at 60 Hz) during steady runs; median position error 3 cm. Airtime 921 vs 883 ms, apex identical. A jump with 0.43 s lead reads as 0.34–0.39 s on the other screen | ✅ |
| Other P2 fixes | – | single centre rail ✅; popups and vignette off by default ✅; 0.1 s orange hit flash with no flinch (code) ✅; bomb radius 3.3 ✅; airtime, apex and no air control unchanged ✅ | |

### Still differs (prioritized)

**P1: a hitch the first time you become immune.**
- Setting the own mascot immune in the lobby produces frame times of **114 ms + 62 ms** (`immune-hitch.mjs`).
- In rounds it shows up at the first pink pickup: rt 20.3 s (121 ms), 20.6 s (88 ms) and 21.3 s (100 + 51 ms) in three runs. That is right as the first chain starts at 21.7 s.
- Cause: `riggedMascot.js` toggles `material.transparent` (line ~521), which forces a shader recompile, and the aura shader is also used for the first time.
- Fix: keep the mascot material `transparent: true` permanently (opacity 1, `depthWrite: true`). Alternatively, warm the immune variant during the countdown with `renderer.compile(scene, camera)` (or `compileAsync`) while a hidden immune dummy and its aura are present. Warm the laser, bomb and explosion materials the same way.
- I saw 38–56 ms frames around the first laser (9.6–11.0 s) in one of two runs. That is not reproducible, and the GPU was shared with another job, so it is unconfirmed. Bomb waves showed no hitch.

**P2 items:**
1. **The tutorial line holds; the real one doesn't.**
   - Arena tracking of the real tutorial (frames 1568→1842) shows it moving from the moment it appears and vanishing on arrival. It is visible ≈4.7 s in total.
   - The clone holds 0.75 s and then end-holds 1.0 s (6.6 s in total), so it runs ~0.75 s behind the real beam throughout (`side-by-side-v2-1`).
   - Fix in `schedule.js`: for the tutorial `place()`, set `hold: 0` and `endHold: ~200`.
   - Confidence L/M: one video only.
2. **The first chain and the 38 s segment merge into one 21.7–45.1 s block.** The real game has a ~1.1 s gap (37.1→38.2).
   - Fix: start the 38 s `gaps` segment at least 1 s after the chain's `lastGone`, or end the chain's last pattern with `endHold: 0`.
3. **The fear badge starts at "3".** `ceil(2.3 s)` gives 3; MECHANICS saw "2" → "1".
   - Fix: in `riggedMascot.js:368`, change `Math.ceil(fearLeftMs / 1000)` to `Math.round(…)` (same for the HUD chip). [L]
4. **The two wave-1 bomb circles are almost concentric** (`side-by-side-v2-3`, rt 65.5). In the real game they are offset by about one radius.
   - Fix: `BOMB_SPACING` [1.5, 3] → [2.5, 3.5]. [L]
5. **Run pose** (`side-by-side-v2-5`): the real mascot leans forward with its tail streaming flat behind it. The clone runs upright with a curled tail. Art polish only.
6. **Stale comment:** the `MOVE_SPEED` comment still says "0.76× laser". The ratio is now 0.73× against fast beams and 1.10× against slow beams, which matches the real game.
7. **Dark floor on first page load:** the floor is black for about 1 s while the worker generates the texture. This only happens on the menu, never in play.

**Still unverifiable from footage:** laser hit width and clearance, pickup reach, S facing, and whether holding Space re-jumps.

**Score rationale:** jump timing, jump height (on screen and against the arena), run speed, snappiness, laser rhythm and the round timeline now all match the footage within measurement error. The one thing a player would *notice* is the first-pink stutter.

---

# Round 1 (original review)

An independent review of the clone's feel against real footage. Everything here was re-measured with the critic's own tools (`research/critic-tools/`), on the main 1080p60 video and on a second, independent 720p60 recording: the Korean video `3UVqsJXsIl4` ("KR"), which has a different player, server and camera. Outputs are in `research/critic/`. No game code was changed.

## Verdict: 6.5 / 10 for "feels like the real game"

**What already matches well:**
- **The jump.** Airtime, arc shape, height in arena units, no air control, no landing lag, and the camera rising with the jump.
- **Run speed**, measured in arena widths per second.
- **Basic rules and timeline.**

An Aion player who stands still and hops would say "yes, that's the jump".

**What would make them say "this isn't Jump Jump":**
1. **Every laser in the clone moves at one fast speed.** The real game has two speed tiers.
   - The slow tier (~4.9 s per pass) covers the tutorial line and the whole first ~40 s. It also appears later, mixed in.
   - The clone's 3.34 s beams make the opening feel rushed.
   - They also change the timing you practise: slow beams take 0.35 s to pass your body, against 0.24 s for fast ones.
2. **The mascot is ~18% too big for the arena.** As a result, the same jump looks smaller relative to the body: it reads as about 0.95 body heights on screen instead of about 1.2.
3. **Left/right is too twitchy.**
   - A full reversal takes 50 ms in the clone. The real game needs at least ~100 ms, and real reversals typically take 130–170 ms.
   - The body also spins ~1.5× faster than the real one.

**Expected score after fixes:** the P0 and P1 items below are mostly constant changes plus one schedule feature. With them done, I'd expect ~8.5/10.

---

## 1. Method (independent of FEEL.md's tools)

- **Floor flow at the feet** (`scan_flow.py`).
  - Every frame of each video is phase-correlated against the previous frame on floor patches left and right of the camera-locked feet pixel.
  - This gives the floor's screen velocity at the feet row.
  - It is a different technique from FEEL's SIFT homography and chord mapping.
- **Jump finder** (`find_jumps.py`).
  - Takeoff and landing show up as steps in the vertical floor velocity.
  - Each jump is fitted with a piecewise model: ground (linear), then air (linear chord plus parabola), then ground. The fit gives a sub-frame airtime.
  - **Validation:** run on a 60 fps capture of the clone, the method returns 53 frames (step count) and 54.1 frames (fit). The truth is 53.5 frames.
- **Arena coordinates** (`reg_track.py`, `beam_tracks.py`).
  - Each frame is registered directly to one reference frame using AKAZE features and a RANSAC homography.
  - In the reference frame I hand-picked the four arena corners (or the far corners plus the centre rail).
  - From this I track two things in arena units: the laser-core pixels and the camera-locked feet point.
  - Laser speeds and run speeds come from this.
- **Clone measurements.**
  - `feel-check.mjs`: physics substeps, rendered foot bones and camera projection.
  - `clone-screen.mjs`: 1080p on-screen geometry, so it can be compared 1:1 with the real 1080p video.
  - `clone-jump-capture.mjs`: a 60 fps capture of the clone's canvas.
  - `record-clone.mjs`: a recorded round segment.
  - `net-check.mjs`: two clients in server mode.
  - GPU used: ANGLE D3D11 on the RTX 5080 (not SwiftShader).

---

## 2. Real vs clone: verified numbers

Confidence: **H** = many samples, small error. **M** = few samples or model-dependent. **L** = weak.
"FEEL rev2" = agree or disagree with research/FEEL.md revision 2.

| Item | Real (critic measurement) | Evidence | Conf. | FEEL rev2 | Clone (measured) | Match? |
|---|---|---|---|---|---|---|
| **Jump airtime** | **53 frames** step count in 14/16 clean EN jumps. Fit 53.56 ± 0.65 f (EN, n=16) and 53.62 f (KR, n=23, different player). → **0.893 s** | `critic/jumps_main.csv`, `jumps_3uv.csv` | **H** | agree (0.891) | 0.891 s (physics). Rendered feet leave the ground 16 ms and land 8 ms after physics (≤1 frame) | ✅ |
| Arc shape | Symmetric parabola, constant height across jumps (fit rms ≤1.6 px) | same | H | agree | 50% apex timing; 76% of apex at ¼ airtime | ✅ |
| **Jump apex, arena-relative** | Floor drop under the feet at apex ÷ arena width at the feet row:<br>• **0.087–0.093** by tracking the ground point, frames 1653/5402/9793 (91, 95, 89 px at ~1020 px/arena)<br>• **0.0745** by fixed-row flow (median, n=16) | `apex_check.py` output, `find_jumps` apex_px, `critic/row_9793.jpg` | M | agree in metres (1.56 m) | 0.085 (ground-point method) and 0.0738 (fixed-row, same method on the 60 fps capture). Implies ≈1.5–1.65 m at 14 m | ✅ (±5%) |
| Jump apex, on-screen ÷ body height | **≈1.17–1.25** (91–95 px drop vs 73–77 px ear-to-feet) | `critic/hz_real_heights.jpg`, `hz_5396.png` | M | agree (1.23) | **0.95** (83 px drop vs 85–87 px mascot) | ❌ because the mascot is too big (P1-2) |
| **Character size vs arena** | Ear-tip-to-feet px ÷ arena px at the same depth = **0.070–0.075** → **13.3–14.3 visual heights per arena width**. Frames 1650 (68/955), 4036 (74/1025), 9793 (76/1020), key-frame 01 (50/710). This matches MECHANICS' original 13–14 estimate | `hz_real_heights.jpg`, `main_grid_1650.jpg`, `key-frames/01…` | M | **disagree**: FEEL's "11 H" divided by cos φ, but a big-headed mascot's on-screen span already ≈ true height × horizontal px/m. The clone's own mesh proves it: 1.235 m mesh → 85 px at 69.5 px/m ≈ 1.22 m | 0.087 → **11.4** | ❌ P1-2 |
| Air control / landing lag | None: in-air ground tracks are straight, and direction changes land on the touchdown frame | FEEL data plus my fit residuals | M/H | agree | dv = 0 in the air; input applies 8 ms after touchdown; running jump = 2.80 m | ✅ |
| Camera follows jump height | Own HP bar stays on row **514.5–516.5 px across 1369 air frames** (27 jumps), identical to ground frames | `flow_main.csv` (hpy) | **H** | agree | Character's on-screen drift 0.0000 NDC while the floor drops | ✅ |
| **Run speed** | **0.244 arena/s** (KR, IQR 0.231–0.258, n=204 straight 0.3 s windows). EN windows 0.21–0.26 (noisy) | `x3UV_full.npz`, see §5 | M | ~agree (0.227) | 0.229 arena/s (3.2 m/s) | ✅ (maybe −5%) |
| Diagonal speed | 0.252 arena/s (n=123), the same as straight, so input is normalized | same | M | n/a | 1.00× | ✅ |
| Start from rest (≤15% → ≥90%) | 1–6 frames, **median 4 f (~67 ms)** (n=8) | `ramps.py` on `flow_main.csv` | L/M | partly disagree (≤2 f) | 25 ms (1.5 f) | ~ (slightly too instant) |
| Stop | **1–2 frames** (instant) in clean cases | same | M | agree | 25 ms, 0.03 m | ✅ |
| **Reversal** (80% one way → 80% the other) | EN: 6–10 f, typically 9–10 f (2573, 2598, 4395, 5880). KR: median 11 f (n=34, after 3-frame smoothing that adds ~2 f), min 6 f. → **game minimum ≈100 ms, typical 130–170 ms** | `critic/turn_2594.jpg`, KR reversal list | L/M | agree on ~100 ms as the minimum | **50 ms** (33 ms to zero) | ❌ P1-3 (2–3× too snappy) |
| Facing, 180° turn | ~14 frames (233 ms) from left profile through back view to right profile (frames 2600→2614) | `critic/turn_2594.jpg` | L (n=1) | agree (10–14 f) | 150 ms (1200°/s) | ❌ P1-3 (too fast) |
| S (back) | Not independently confirmed; footage too small. FEEL's "turns and runs at full speed" is plausible | `critic/back_1620.jpg` | L | – | Turns to face the camera, 1.00× speed | ✅ (as specified) |
| **Laser speed** | **Two tiers.**<br>• **Fast: 0.31–0.34 arena/s → pass ≈3.0–3.25 s** (EN 1:05 two-line pattern 0.31–0.33; KR 9 tracks 0.31–0.34).<br>• **Slow: 0.19–0.23 arena/s → pass ≈4.5–5.0 s** (EN tutorial 0.222; EN square at 0:50 ~0.20; KR 9 tracks 0.18–0.23).<br>Slow covers everything in the first ~40 s of both rounds (tutorial, first chain) and recurs later (KR rt≈168 and 185) | `beam_tracks.py` on `x3UV_full.npz`, `main_1550.npz`, `main_3870.npz`, `main_2940.npz` | **H** (two tiers) / M (exact values ±5%) | **disagree**: FEEL measured one fast window (1:05) and generalized "constant 3.34 s" to every beam | One speed, 4.19 m/s = 0.30 arena/s = 3.34 s (chains 0.93–1.07×) | ❌ **P0-1** |
| Run ÷ laser speed | 0.76 vs fast beams, **≈1.15 vs slow beams** (you *can* outrun the slow ones) | from above | M | partly disagree | 0.76 always | ❌ (follows P0-1) |
| Laser hold at edges | Start hold ≈0.7–1 s or more (KR tutorial ~0.8 s; EN square ≥1 s at the borders, frame 2990). End hold ~1 s | `main_grid_2990.jpg`, `x3UV_5100.npz` | L/M | agree | 0.75 / 1.0 s | ✅ |
| Hit width / clearance | Not independently measurable. FEEL's model (r+w ≈ 0.51 m, feet ≥ 0.38 m) assumed every beam was 0.30 arena/s; one of its two observed hits (2:34) may have been a slow beam | – | L | unverified | 0.51 m / 0.38 m. Standing-jump clear window = jump 0.18–0.71 s before centre crossing (fast beams) | ? |
| Camera | Solved from arena rows and widths (frames 1650, 3960): slant to arena centre **15.5–16.1 m**, pitch **29–36°** (the recorder changes it), vFOV **≈54–58°**. On-screen scale at the character ≈ clone ±5% | `main_grid_3960.jpg`, `borders3960.png` | M | agree roughly | 13.5 m slant to the feet, 33°, 60° | ✅ (P2 tweak) |
| Timeline | Tutorial line rt 10.3 · first chain rt 21.7 · pink rt 20.4 · bombs rt 62.7 / 112 · fuse 3.3–3.5 s · 165 s timer | MECHANICS plus my side-by-sides | H | – | 10.0 · **24.2** · 20 · 63 / 112 · 3.3 · 165 | ✅ except the chain start (P2) |
| Arena rails | **One** dark centre rail (two halves), not a cross. Seen in every EN frame (it runs left-right) and in KR (it runs in depth) | `key-frames/01…`, `x3UV_ref5300_grid.png` | **H** | – | Cross rails, 4 quadrants | ❌ P2 |
| Net (2 clients, server, LAN) | – | `critic/net-check-summary.json` | H | – | Clock skew ≤ 0.9 ms. Identical beams. A remote jump renders 117 ms late with airtime and apex preserved (908 vs 883 ms; 1.559 vs 1.560 m). A jump taken 0.43 s before a beam looks like 0.27–0.33 s on the other screen | ✅ / P2 |

**Real-game notes from the Korean recording (version differences):** its event timer reads **03:17** 80 s into the video, so the KR round is longer than 2:45. Its airtime is identical (0.894 s), and it has the same two laser tiers.

---

## 3. Prioritized discrepancies and fixes

### P0: breaks the feel

**P0-1. Lasers have only one speed; the real game has a slow tier (~4.9 s per pass) and a fast tier (~3.1 s per pass).**
- **What's wrong**
  - The tutorial line and the whole first chain (rt 10–40 s) are slow in the real game.
  - Slow patterns also recur later: KR rt≈168 and 185, cross or square on both axes.
  - In the clone, every beam crosses in 3.34 s.
  - Effects on the feel:
    - The opening is far more hectic than the real game.
    - Players never meet a beam they can outrun, but slow beams are outrunnable in the real game (run ÷ beam ≈ 1.15).
    - The jump timing you practise is wrong for half the beams: contact lasts 0.35 s on a slow beam vs 0.24 s on a fast one, so the standing-jump window is 0.23–0.66 s before the beam arrives instead of 0.18–0.71 s.
- **Evidence**
  - `critic/x3UV_full.npz`: 20 tracked passes, clearly bimodal (0.18–0.23 vs 0.31–0.34 arena/s).
  - `critic/main_1550.npz` (EN tutorial, 0.222).
  - `critic/main_2940.npz` (EN square ≈ 0.20).
  - `critic/main_3870.npz` (EN 1:05 two-line pattern, 0.31–0.33; this is FEEL's window).
  - `critic/side-by-side-1-tutorial-laser.jpg`.
- **Fix** (`shared/config.js` + `shared/schedule.js`)
  1. Add `LASER_SPEED_SLOW = 2.9` (m/s: 0.207 arena/s, 4.8 s pass) and set `LASER_SPEED` (fast) to **4.4** (0.315 arena/s, 3.2 s). 4.19 is within error, but my value is 4.3–4.6.
  2. Give each `LASER_SEGMENTS` entry a `speeds: { slow: w, fast: w }` weight.
     - Tutorial line: slow.
     - Chain 22–37.5 s and gaps 38–55 s: slow.
     - 74–144 s: ~70% fast / 30% slow.
     - Final chain: mostly fast with an occasional slow pattern.
  3. In `place()`, pass the chosen speed, since `b.spd` is already supported.
  4. In `chain()` and `gaps()`, use `passMs(spd)` of the chosen tier instead of `LASER_SPEED`.
  5. The first chain becomes ~3 slow patterns. The real chain is 21.7–37.4 s with crosses and squares. Three slow patterns need ≈16.7 s including the end hold, against a 15.5 s window. So widen `LASER_CHAIN_SPEED_RANGE` to about [0.85, 1.2] for the slow tier, or let the chain overrun its window by ~1 s. Either way this also removes P2-5.
  6. Bots: `BOT_JUMP_LEAD_S` should account for per-beam speed (bots.js already reads `beamState`, so this is fine).

### P1: noticeable

**P1-2. The mascot is ~18% too big relative to the arena: `PLAYER_HEIGHT` 1.27 m should be ≈1.05 m.**
- **What's wrong**
  - Real: 13.3–14.3 visual body heights per arena width. Clone: 11.4.
  - Because of this, the real jump reads as ~1.2 body heights on screen, but the clone's identical-in-metres jump reads as 0.95. It looks like a smaller hop.
  - Everything else (jump height in metres, hit width, run speed, camera scale) already matches in arena units, so only the body is off.
- **Evidence**
  - `critic/clone-screen.json`: Hpx 87, arena 973 px at the feet, drop 83 px.
  - `critic/hz_clone1080_stand_center.png` vs `critic/hz_real_heights.jpg`.
  - FEEL §6 used `h/(px·cos φ)`, which double-corrects for a big-headed mascot. The clone's own mesh shows on-screen span ≈ true height × horizontal px/m.
- **Fix**
  - `shared/config.js`: `PLAYER_HEIGHT = 1.05`. This also rescales the camera pivot (`CAM.targetHeight`) and the nameplate height.
  - **Keep** `JUMP_HEIGHT = 1.56`, `JUMP_AIRTIME = 0.891`, `PLAYER_RADIUS`, `LASER_*` and `MOVE_SPEED`. Those are arena-relative and verified.
  - Scale the balloons with the body: `ORB_DIAMETER` 0.95 → ~0.78, `ORB_Y` 0.95 → ~0.8 (balloons ≈ ¾ of the body at head height).
  - Re-run `research/critic-tools/clone-screen.mjs`. Target: `ratio` ≈ 1.15–1.25 and Hpx/arena ≈ 0.073.

**P1-3. Left/right and facing are 2–3× snappier than the real game.**
- **What's wrong**
  - A full D→A reversal takes 50 ms (velocity crosses zero after 33 ms). Real: at least ~100 ms; typical 130–170 ms.
  - Start from rest: 25 ms in the clone vs a median ~4 frames (~67 ms) in the real game.
  - The 180° body turn takes 150 ms vs ~230 ms real.
  - The user explicitly cares about "the same way you can move fast left and right". The clone currently allows dodges that the real game doesn't.
- **Evidence**
  - `critic/feel-check.txt`.
  - Reversal frame sequences listed in §2.
  - KR median 11 f (n=34).
  - `critic/turn_2594.jpg`.
- **Fix** (`shared/config.js`)
  - `MOVE_ACCEL_MS` 25 → **50**. This gives a 3-frame start and a 100 ms reversal, because a reversal = 2 × accel in `player.js`.
  - Keep `MOVE_DECEL_MS = 25`, since real stops are instant.
  - `FACE_TURN_DEG_PER_S` 1200 → **~800**.
  - Confidence L/M. If players say it feels sluggish, 40 ms / 900°/s is the lower bound.

### P2: polish

1. **Single centre rail, not a cross.** `client/src/world/` arena floor: draw one dark rail through the centre on one axis only. Players use it as the halfway landmark, so with 4 quadrants the arena reads differently. Evidence: `key-frames/01_arena_overview…`, `critic/x3UV_ref5300_grid.png`.
2. **Hit feedback is too long and has a flinch.**
   - Clone: a 0.38 s red emissive flash, plus an additive `hit_add` flinch for 0.45 + 0.3 s.
   - Real (FEEL §4, consistent with my frames): a 3–7-frame orange-pink burst with sparks, and no flinch or stagger.
   - Fix in `client/src/anim/riggedMascot.js`: make the flash decay `dt / 0.38` → `dt / 0.12`, tint it orange (HIT_GLOW ≈ (1, 0.45, 0.2)), add a spark burst, and drop the `hit_add` weight to ~0.25 or zero.
3. **Floating "+70 / −20" score text** (`game.js floatOver`). The real HUD shows only the pickup sparkle and a rank-panel update; there are no score popups. Make it optional and off by default.
4. **Foot sliding while running.**
   - The planted foot slides at 0.92 m/s at 3.2 m/s (29%), because `TUNING.rateMax` = 2.9 caps the cadence.
   - Fix in `riggedMascot.js`: set `rateMax` ≈ 4.2 now, or ≈ 5 after shrinking the mascot (P1-2). Goal: planted-foot speed < 0.2 m/s in `feel-check.mjs`.
5. **The first chain starts at 24.2 s instead of ~21.7 s**, leaving a 9 s gap after the tutorial (real: 6.6 s). This happens because no pattern count fits the 0.93–1.07× speed range, so `chain()` falls back to n=3 at nominal speed aligned to the window *end*. Fix: align the fallback to `start`, or apply the P0-1 slow-tier change with a wider speed range.
6. **Camera default**: the real camera is a bit farther with a narrower FOV (slant 15.5–16 m, 54–58°, pitch 29–36°). Suggested `CAM.distDefault` 13 → 15 and `CAM.fov` 60 → 56. The on-screen scale stays the same, the perspective gets slightly flatter, and the near border becomes visible from mid-arena as in the real game. Low priority, because the real recorder changes it anyway.
7. **Bomb radius 3.0 m (0.21 arena)** vs MECHANICS' ~0.24 arena (≈3.4 m) [L]. Consider 3.3.
8. **Remote players render 117 ms late on LAN**, plus internet RTT on real connections.
   - A friend who cleared a beam with 0.25 s to spare can look like they were hit.
   - Options: `INTERP_DELAY_MS` 110 → 80 with `SNAP_HZ` / `CLIENT_SEND_HZ` 20 → 30, or render remote players' *jump* phase extrapolated from their reported takeoff time.
   - The real game shows the same kind of lag on others (FEEL: the score cell lags 0.45–1.9 s), so this is acceptable as-is.

---

## 4. Holistic notes from the side-by-side sheets

Sheets: `research/critic/side-by-side-1-tutorial-laser.jpg`, `-2-chain.jpg`, `-3-bombs.jpg`, `-4-jump.jpg`.

- **Jump on screen.** The camera rises with the jump: the character stays put and the floor and shadow drop. In arena units the clone's drop matches (fixed-row flow 0.0738 vs real 0.0745). This is good, and the most important thing the team got right. The jump *looks* small only because the body is big (P1-2).
- **Jump animation vs physics.** The rendered feet leave the ground ≤1 frame after takeoff and touch down ≤1 frame after landing, and there is no extra tuck height. Good.
- **Laser look and readability.**
  - The clone beams are readable, with white-hot emitter nodes, and they hold at the edge before moving. Good.
  - The clone beams are wider and softer, a broad orange band on the floor. The real core is thinner, with a halo and floor tint.
  - The bigger readability difference is speed: the real first minute is calm and slow (P0-1).
- **Bombs.**
  - Circle with fill, a magenta pillar in the last second, a purple smoke cloud, and a fear countdown "2"/"1" under the name. All present, with the right timing (63.3 / 66.4 s).
  - The clone smoke is a bigger, opaque pink cloud; the real smoke is thinner purple.
- **HUD.** Rank panel top-right with "View All", the event timer, key hints on the right, and an NPC tip bubble bottom-centre. The layout matches.
- **Unverifiable.**
  - Pickup reach (0.83 m is a geometric guess).
  - Fear run direction.
  - Whether holding Space re-jumps.
  - Whether there is a pre-round countdown (the real video may be trimmed; the clone uses 5 s).

## 5. What FEEL rev2 got right and wrong

**Right:**
- Airtime (0.89 s).
- Arc.
- No air control and no landing lag.
- Rigid camera, including height.
- Jump height in metres.
- Run speed (±7%).
- Stop speed.
- That a reversal takes ~100 ms (as a minimum).

**Wrong:**
1. "Every laser crosses in 3.34 s at one constant speed." Only one fast window was measured. In reality there are two tiers, and the slow tier dominates the opening.
2. "Character = 1/11 arena." The cos φ correction is inappropriate for the mascot's on-screen span; the real value is ≈1/13.7.
3. "Start ≤ 2 frames." The real median is ~4 frames.

---

## 6. Reproduce

```
npx vite build && PORT=8095 node server/index.js      # then, in another shell:
node research/critic-tools/feel-check.mjs             # clone feel table -> research/critic/feel-check.txt
node research/critic-tools/clone-screen.mjs           # 1080p on-screen geometry (jump drop / body / arena)
node research/critic-tools/net-check.mjs http://localhost:8095/ 60
node research/critic-tools/record-clone.mjs http://localhost:8095/?mode=solo 74   # round video + beam log
python -I research/critic-tools/scan_flow.py <video> <out.csv> F0 N feetX feetY [hpbox]   # real floor flow
python -I research/critic-tools/find_jumps.py <flow.csv> <out.csv>                        # jumps + airtime fit
python -I research/critic-tools/reg_track.py <video> REF F0 F1 corners feet out.npz [masks]; python -I research/critic-tools/beam_tracks.py out.npz 60
```
