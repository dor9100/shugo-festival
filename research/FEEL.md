# Jump Jump: FEEL measurements (frame-by-frame)

Goal: make the clone *feel* like the real Aion 2 "Shugo Festival: Jump Jump", meaning the same jump airtime and height, run speed, snappiness, laser hitbox and camera. Companion to `MECHANICS.md`, which covers the rules.

> **Revision 2 (this version) supersedes revision 1.** Revision 1 reported a 0.42 s / 0.33 H hop, a run speed of 0.65 arena widths/s and a backpedal. All three were artefacts. The real jump is **long and high (0.89 s, apex 1.23 character heights)**. Revision 1 only saw the first 23 frames of one jump and read the rest as running and backpedalling. With 11 jumps now measured, the run speed is **0.227 arena widths/s**, slower than the lasers.

**Scale used for meters** (as decided by the clone): **arena = 14 m, character H = 1.27 m (= 1/11 arena)**. Arena-relative and H-relative values are the ground truth.

**Sources**
- Main: YouTube `HDwM-UsNnvo` (GAC Film Room, recorder "Koschey"), **1080p60**, in `research/video-hd/video1080.mp4`. It has 13,650 frames. Frame numbers are 60 fps frames of this file: `t = frame/60` s of video time, so frame 3975 is 1:06.25. Frame indices are identical in the 720p copy.
- Cross-check videos (720p60, untrusted data, only read as pixels) in `research/video-extra/<id>/`:
  - `2Xw7aF3SlgQ` (low chase camera, large characters, long shadows)
  - `Z5QJ6ciXYas`, `DQLtoluKx5g`, `LliVB_8jtyQ`, `bWlFEmCpg2M` (overviews)
  - Korean footage: `3UVqsJXsIl4` (TL Adol, near top-down), `uc8nL1Aj8c0`, `j5v_eva-0bE` (도하TV), `NoKrCq0DQ7g`
  - These were used for qualitative checks. All quantitative numbers come from the main video, where the pipeline below works best.
- Tools are in `research/feel-tools/`, and intermediate sheets, CSVs and registrations are in `research/feel-out/`.

**Confidence:** **[H]** measured directly with small error, many samples · **[M]** measured, but with model assumptions or few samples · **[L]** weak evidence or estimate.

---

## 0. Method

### Key fact: the camera is locked to the character, including its height
The recorder's own nameplate and HP bar sit at **exactly the same screen pixel (y = 514 ± 1)** in every one of 21 sampled frames across the round, including mid-jump frames. Koschey's head stays within ±5 px on screen through 1.2 H jumps (`feel-out/tk_all.csv`, frames 3964–4059). The camera pose recovered from the floor homography (`campose.py`) shows the camera **translating up and down with the jump at constant pitch** (4040–4094: the camera rises by 0.096 arena widths and returns to within 0.0001, while pitch stays at 34.3°).

So, **on screen, the character never moves. When it jumps, the whole floor drops away beneath it.** This is why jumps are nearly invisible to the eye, and why revision 1 misread them.

### Pipeline
1. **Floor registration** (`reg.py`): SIFT on the floor and border rails, with laser glow, HUD and the character masked, then a RANSAC homography `H_t` from every frame directly to one reference frame per window (no chaining, so no drift).
2. **Character track without tracking:** the character is camera-locked, so the fixed screen pixel at its feet (≈ (968, 608)) mapped through `H_t` gives the floor point under the view ray through the feet. On the ground this is the true ground position. In the air it is displaced away from the camera.
3. **Jump signature** (`vseries.py`). The vertical velocity of that floor point is:
   - constant on the ground;
   - a **sharp negative step at takeoff**, then a **linear ramp** (constant acceleration, i.e. gravity), then a **sharp step at landing**.
   This identifies takeoff and landing to ±1 frame.
4. **Height** (`apex_frame.py`, `airtime_roots.py`). The ground track during the air phase is the chord between the takeoff and landing ground points; air control is tested separately below. The chord point is mapped back into the current frame. Its screen drop below the feet, `d(t)`, divided by the character's standing height in pixels, `Hpx`, gives the lift `z/H`. This holds because the camera translates with the character, so a vertical lift and a vertical body segment are projected the same way. `Hpx = 73 ± 4 px` (ear tip to feet on 3.2× zooms, frames 4034 and 9780, `feel-out/stand_h.jpg`). A parabola is then fitted to the interior (d > 15 px), and its roots give sub-frame takeoff and landing times.
5. **Absolute cross-check** (`apex_arena.py`). In the window with a calibrated arena homography (`A3960.npy`, built from the laser emitter nodes sliding on the border rails, §3), the lift in arena units is `z = ΔF·tan φ₀`, where φ₀ is the standing depression angle (the ray depression doesn't change because the camera rises with the character). This is converted with H = 1/11 arena.
6. **Beam timing** (`beamcross.py`). Laser-core pixels near the character are shifted down by the beam height (≈ 0.25 H ≈ 18 px), mapped to the floor, and fitted with up to three lines by sequential RANSAC. This gives the signed distance of the nearest beam to the character's ground point per frame, and the frame where the beam centre crosses it.
7. **Hits** from the on-body hit flash (orange burst, 3–7 frames), cross-checked against the own score cell. The cell lags the flash by **0.45–1.9 s** (`feel-out/panel9020.jpg`, `rank4080.jpg`).

---

## 1. Jump

### Jump samples (Koschey; n = 11; all high default camera)
Velocities are floor-registered reference pixels per frame (x = screen-lateral, y = depth, + = toward the camera): "pre" is the 8 frames before takeoff, "air" is the chord, "post" is the 5 frames after landing. Apex = screen drop at apex ÷ 73 px. Beam = frames after takeoff at which the beam centre crossed the character's ground point; lift at crossing = model lift at that moment.

| # | Takeoff → landing (last ground frame → touchdown) | Airtime, frame count | Airtime, parabola roots | Apex | Horizontal motion pre → air → post | Beam crossing (lift) | Outcome |
|---|---|---|---|---|---|---|---|
| 1 | 1653 (0:27.55) → 1706 | 53 f | 53.84 f | 89.1 px = **1.22 H** | +2.13 → +2.67 → +2.96 (same) | +15.0 f (1.00 H) | cleared (first, tutorial laser) |
| 2 | 2356 (0:39.27) → 2409 | 53 | 53.70 | 88.4 = 1.21 | (3.1,−2.0) → (2.8,−1.8) → (0.6,**+1.8**) reversed at landing | +23.2 (1.21) | no hit, but probably pink-invincible |
| 3 | 2802 (0:46.70) → 2855 | 53 | 53.62 | 95.0 = 1.30 | −2.58 → −2.13 → **+1.41** reversed at landing | +20.9 (1.18) | cleared |
| 4 | 3512 (0:58.53) → 3565 | 53 | 53.61 | 83.6 = 1.15 | −3.28 → −2.72 → **+1.64** reversed at landing | +23.3 (1.21) | cleared |
| 5 | 3975 (1:06.25) → 4028 | 53 | 53.34 | 96.5 = 1.32 (arena method **1.33**) | −1.39 → −1.62 → −1.19 | ≈ +13 (≈ 0.93) | cleared |
| 6 | 4040 (1:07.33) → 4093 | 53 | 53.51 | 90.8 = 1.24 (arena method **1.20**, rms 0.004 H) | +0.3 → +1.65 → stop | **+6.7…+8.2 (0.55–0.64)** | **HIT**: flash 4049–4051, −20 |
| 7 | 7680 (2:08.00) → 7733 | 53 | 53.20 | 97.3 = 1.33 | (−1.8,−2.0) → (−0.1,−2.0) → (0.1,−1.4) | +23.7 (1.22) | cleared |
| 8 | 8609 (2:23.48) → 8662 | 53 | 53.50 | 86.3 = 1.18 | (2.9,0.8) → (3.7,0.1) → (**−1.7,−1.8**) reversed | +10.1 (0.76) | cleared |
| 9 | 9263 (2:34.38) → 9316 | 53 | 52.74 | 83.5 = 1.14 | (2.7,−1.6) → (4.0,−0.5) → stop | **+10.3 (0.77)**, moving parallel to the beam | **HIT**: flash 9278–9284, panel 1,020→1,000 at ≈ 9390 |
| 10 | 9793 (2:43.22) → 9846 | 53 | 53.06 | 87.2 = 1.19 | (3.1,0.1) → (4.0,−0.1) → stop | +25.0 (1.23) | cleared |
| 11 | 10331 (2:52.18) → 10385 | 53–54 | 53.74 | 91.8 = 1.26 | (0.5,0.0) → (3.2,−1.7) → (2.1,0.7) | +17.6 (1.08) | cleared |

Evidence files: `feel-out/win/R*.npz` (registrations) and `feel-out/jumps_roots.txt`. Velocity ramps are reproducible with `python -I feel-tools/vseries.py feel-out/win/R<ref>.npz <bar_x>,580 F0 F1`.

Visual confirmations:
- `feel-out/ks4030.jpg`: on the ground (4030–4040) the shadow touches the feet. During 4052–4076 it sits far below the feet on screen.
- `feel-out/k9256.jpg`: the hit flash of jump 9.
- `feel-out/k4034.jpg`: the hit flash of jump 6.

### Results
| Quantity | Value | Conf. |
|---|---|---|
| **Airtime** | **0.891 ± 0.006 s** (parabola roots: 53.44 ± 0.33 frames, n = 11). Discontinuity count: **53 frames in all 11** (one 53–54), i.e. 0.883 s. Use **0.89 s**. | **H** |
| **Apex (feet)** | **1.23 ± 0.06 H** (sd over n = 11; range 1.14–1.33). Absolute calibration: arena method 1.20 / 1.33 (n = 2), plus ±10% systematic from `Hpx` and the H/arena ratio. At 1.27 m: **1.56 m** (1.45–1.70). | **M** (spread H, scale M) |
| Arc shape | **Symmetric parabola**: the peak is at 50.0 ± 1.5% of the airtime, and a pure parabola fits with 0.3–1.5 px residuals. No apex hang, no fast-fall, no variable height (all 11 are the same height within 5%, so it is a fixed impulse). | **H** |
| Implied physics | g = 8h/T² = **12.4 H/s²** (15.7 m/s² at 1.27 m). Takeoff speed v₀ = 4h/T = **5.5 H/s** (7.0 m/s). | M |
| **Air control** | **None.** (1) The in-air ground track is a straight line at constant speed: the parabola-plus-chord model fits to ≤ 1 px, and any steering would bend it. (2) The in-air velocity equals the takeoff velocity (jumps 1, 3, 4, 5, 10). (3) In **4 of 11 jumps the motion direction reversed exactly at the touchdown frame** (2, 3, 4, 8), and in 2 more the player stopped exactly at touchdown (9, 10). New input is ignored until landing, then applied instantly. | **M/H** |
| Jump and speed | **No boost or penalty**: the in-air horizontal speed equals the run speed (0.223 / 0.228 arena widths/s in the calibrated jumps; lateral jumps 4.0 px/f in the air vs 3.5–4.3 px/f running). Jumping from rest gives a vertical-only jump, unless movement starts on the same frame. | M |
| **Landing lag** | **0 ms.** On the touchdown frame the velocity already takes the new value: reversal at 2409, stop at 4094, 9317, 9847. The next jump is possible right away (jumps 5→6 are 12 frames apart: land 4028, take off 4040). | M |
| Double jump / glide | None. Space in the air shows "Cannot glide in current state." (MECHANICS §2, 2:17.5). | H |

**Timing consequence (the core feel).** In these 11 jumps players took off **0.17–0.42 s before the beam reached them** (crossing at +10…+25 frames). The two hits had the latest timing (crossings at +7…+10 frames with slow closing speed). A late jump is punished, while a jump up to ~0.4 s early still lands after the beam has passed.

---

## 2. Run speed, acceleration, turning

All in the calibrated window via arena coordinates (`feel-out/R3960b.npz` + `A3960.npy`), plus lateral checks in other windows.

| Quantity | Value | Evidence | Conf. |
|---|---|---|---|
| **Run speed** | **0.227 arena widths/s = 2.5 H/s** (3.18 m/s at 14 m) | Air chord of jump 5 = 0.223, air chord of jump 6 = 0.228, free run 4096–4110 = 0.227. Lateral runs (windows 9296/9833) of 3.5–4.3 px/f are consistent. | **M/H** |
| Run / laser speed | **0.76×** (lasers 0.30 arena widths/s) | **The player cannot outrun a beam. Every beam has to be jumped.** | M/H |
| Start from rest | **≤ 2 frames (≤ 33 ms) to full speed** | Lateral velocity 0.3 → 3.7 px/f in one frame (9786→9787) and 0 → −4.2 in one frame (9869→9870) | M |
| Stop | **≤ 2 frames** | 5.6 → 2.2 → 0.5 at the 9316 touchdown; 5.0 → 1.6 → −0.4 at 9846 | M |
| Reversal (left ↔ right) | **≈ 100 ms** to full speed the other way, with a short ~4-frame dwell near zero | 9240–9248: −3.1 −4.0 −2.8 −1.6 −1.7 −0.8 +0.3 0.0 +2.3 … (one sample, noisy) | L |
| Backward (S) | **Turns to face the camera and runs at full speed.** No backpedal: revision 1's "backpedal" was the descent of jump 5. | Jump 6: moving toward the camera at 0.228 arena widths/s with a front view in `ks4030.jpg` / `k4068.jpg` | M |
| Facing | Turns toward the movement direction, ~180° in ≈ 10–14 frames (~0.2 s, ≈ 900°/s); ~90° in 3–4 frames after landing at 4096–4099 | `ks4030.jpg`, `k4068.jpg` | L |
| Diagonal vs straight speed | Not measured | n/a | n/a |

---

## 3. Lasers

Measured on the two-line pattern at 1:04.5–1:10 with emitter positions in arena coordinates (`summary3960.py`).

| Quantity | Value | Conf. |
|---|---|---|
| Sweep speed | Beam A **0.301** arena widths/s (57 samples, residual sd 0.0055). Beam B **0.298** (53 samples). Constant speed. | **H** |
| **Full edge-to-edge pass** | **3.32–3.36 s → 3.34 s**. Beam A left v=0 at frame 3910.5 and reached v=1 at 4109.6. That is **4.19 m/s** at 14 m. | **H** |
| Start hold | ≥ 0.6 s at the start edge (on screen by ≤ 3876, starts moving at ~3911) | M |
| End hold | ≥ 1.1 s at the far edge | M |
| Crossing | Two opposite beams pass through each other (v ≈ 0.51 at ~4011–4019) | H |
| Beam height | Not measured cleanly. Keep ≈ 0.25 H (≈ 0.32 m). | L |

---

## 4. Hits, hitbox, clearance

- **Hit feedback:** an orange-pink burst with sparks on the character for 3–7 frames (4049–4051, 9278–9284). **No knockback, stagger or slowdown**: jumps 6 and 9 continue on the same parabola, and the ground velocity is unchanged. The flash appears **2–5 frames after the beam centre crosses the character**. The score cell updates **0.45–1.9 s later** (server-driven). **[M]**
- **Observed hits during jumps (2):**
  - Jump 6: beam centre crossed at **+6.7 to +8.2 frames** after takeoff. Closing speed 0.526 arena widths/s = **0.096 H/frame** (the beam and the player moved toward each other).
  - Jump 9: crossing at **+10.3 frames**. Koschey was running sideways, parallel to the beam, so the closing speed was just the beam speed, **0.055 H/frame**. **This is equivalent to a standing jump.**
- **Observed clears:** 8 clean ones, with crossings at +10.1 (jump 8, a faster-closing geometry), +13, +15, +17.6, +20.9, +23.3, +23.7 and +25 frames.
- **Model that fits all of them:**
  - The body is a vertical cylinder of radius r, and the beam a horizontal cylinder of half-thickness w whose top is at height **c** (the clearance).
  - Contact starts `(r + w)/v_close` before the centre crossing. A hit happens if the feet are below c at any moment of overlap.
  - With the measured arc, **c ≈ 0.30 H and r + w ≈ 0.40 H** reproduce both hits and all clears:
    - jump 6: contact at +3.0 f, feet at 0.27 H < 0.30 → hit
    - jump 9: contact at +2.9 f, feet at 0.26 H → hit
    - jump 1: contact at +7.7 f, feet at 0.62 H → clear
    - jump 8 needs a closing speed ≥ 0.07 H/f, which is plausible
  - Bounds: **0.3 H ≤ r + w ≤ 0.5 H** if hits are decided at first contact without latency. Allowing ~5 frames of server latency loosens this to 0.1–0.6 H. **[L/M]**
- **Standing jump (the coordinator's question (b)):**
  - No clean zero-velocity jump over a beam was found. The closest equivalent is jump 9 (parallel motion), which was **hit because it was late** (centre crossing only 0.17 s after takeoff).
  - The measured arc settles the question anyway. The feet are above 0.30 H for 87% of the airtime (s ∈ [0.066, 0.934], **0.77 s**). A beam passes a standing body's ±0.40 H zone in 0.8 / 3.3 = **0.24 s**.
  - So **a standing jump clears whenever the beam reaches the body between ≈ 0.06 s and ≈ 0.53 s after takeoff: a timing window of ≈ 0.5 s.** Observed: centre crossings at 0.22–0.42 s after takeoff all cleared, and 0.17 s with slow closing was hit. **[M]**
- **Not a hit:** the bomb itself costs no points (MECHANICS).
- **One hit per beam pass** (MECHANICS), with −40 when two beams hit in quick succession.

---

## 5. Pickup radius

**Not measured.** Geometric estimate: balloon radius (0.37 H) + body radius (≈ 0.3 H) ≈ **0.65 H** (0.83 m), centre to centre, horizontal. **[L]**

---

## 6. Character size vs arena

The character's on-screen height is converted with the local foreshortening of the arena homography: `H/W = h_px / (px_per_u · cos φ)`.
- Frame 4034: 71–76 px, 1025 px per arena width, φ = 38.4° → **11.3 / 10.6 character heights per arena width**.
- Frame 3966: ~80 px → 10.6.

**Arena ≈ 11 ± 0.7 character heights** **[M]**. The clone's 14 m arena therefore needs a **1.27 m** character.

---

## 7. Camera

- **Follow: rigid in X, Y and Z, with no lag.** The own nameplate is pinned to y = 514 px, the head stays within ±5 px through 1.2 H jumps, and the camera translates up with the jump at constant pitch. **[H]**
  - **On screen the character stays still during a jump, and the floor, shadow and beams drop away.** The clone must do the same, or jumps will look and feel different.
  - The boom length does change slowly in other situations (0.86–1.04 arena widths over several seconds in the 1:06 window), which is a mild zoom drift. **[M]**
- **Pitch:** the optical axis is depressed ≈ 31–34°, and the ray to the character 32–38° (high default view). The recorder occasionally rotates the yaw or drops to a low view (1:55–2:03). **[M]**
- **FOV and distance:** a single-plane calibration consistent with the measured depression gives a **vertical FOV ≈ 60–62°**, a camera **≈ 0.9 arena widths ≈ 10 H** from the character, and ≈ 5.4 H above the floor. **[L/M]**

---

## Feel targets

Meters use the clone's scale: **arena 14 m, character 1.27 m (H = 1/11 arena)**.

| Key | Value (14 m arena, 1.27 m character) | Relative truth | Conf. |
|---|---|---|---|
| `JUMP_AIRTIME_S` | **0.89** (0.883–0.897) | 53.4 ± 0.3 frames at 60 fps, n = 11 | **H** |
| `JUMP_HEIGHT_M` (feet apex) | **1.56** (1.45–1.70) | 1.23 ± 0.06 H | M |
| `JUMP_ARC` | **Symmetric parabola**: rise 0.445 s = fall 0.445 s, g = **15.7 m/s²**, v₀ = **7.0 m/s**. Fixed height, no variable jump. | g = 12.4 H/s², v₀ = 5.5 H/s | H (shape) / M (scale) |
| `AIR_CONTROL` | **none**: horizontal velocity locked at takeoff, input ignored until touchdown | 4 reversals and 2 stops exactly at touchdown; straight in-air tracks | M/H |
| `LANDING_LAG_MS` | **0** (new input applies on the touchdown frame; can re-jump at once) | n/a | M |
| `MOVE_SPEED_MPS` | **3.2** | 0.227 arena widths/s = 2.5 H/s = **0.76× laser** | M/H |
| `MOVE_ACCEL` | **≤ 33 ms to full speed** (instant) | ≤ 2 frames | M |
| `MOVE_DECEL_MS` | **≤ 33** (instant) | ≤ 2 frames | M |
| `REVERSE_MS` | **≈ 100** to full speed the other way | 1 noisy sample | L |
| `FACING` | Turn toward the movement direction at ≈ 900°/s (180° in ~0.2 s), no strafing | n/a | L |
| `BACKWARD` | **Turn and run toward the camera at full speed (1.0×)**, no backpedal | n/a | M |
| `LASER_PASS_S` | **3.34** (speed 4.19 m/s) | 0.30 arena widths/s | **H** |
| `LASER_Y_M` (centre) | **0.32** | ≈ 0.25 H (estimate) | L |
| `CLEARANCE_FEET_M` | **0.38** (feet must be above this) | ≈ 0.30 H (fits the hit/clear model) | L/M |
| `HIT_HALF_WIDTH_M` (beam half-thickness + body radius) | **0.51** (0.38–0.64) | 0.40 H (0.3–0.5) | L/M |
| `PICKUP_RADIUS_M` | **0.83** | ≈ 0.65 H (estimate) | L |
| `CHAR_HEIGHT_TO_ARENA` | **1/11** (0.085–0.094) → 1.27 m in a 14 m arena | n/a | M |
| `CAMERA_PITCH_DEG` | **33** | n/a | M |
| `CAMERA_DIST_M` | **12.7** (≈ 10 H) | ≈ 0.9 arena widths | L/M |
| `CAMERA_FOV_DEG` | **60 vertical** (≈ 90 horizontal at 16:9) | n/a | L/M |
| Camera follow | **Rigid in X, Y and Z, including jump height, no lag** | n/a | **H** |

Consistency check: with these numbers, a standing player has a **≈ 0.5 s** window in which a jump clears a beam. A jump taken 0.2–0.4 s before the beam arrives (what players actually did) clears comfortably. A jump less than ~0.15 s before arrival gets hit.

---

## Critic checklist (acceptance tests for the clone)

Run these at 60 fps with physics-state logging or frame stepping.

1. **Airtime:** press Space at rest. Feet leave the ground and land after **0.89 ± 0.03 s (53 ± 2 frames)**, every time. Holding Space doesn't change it.
2. **Height and arc:** feet apex = **1.56 ± 0.15 m (1.23 H)**, reached at **0.445 ± 0.02 s**. The arc is a parabola: at 25% of the airtime the feet are at 75% ± 5% of the apex.
3. **No air control:** jump while holding D, then switch to A at the apex. The ground track stays straight at the takeoff velocity, and the A input takes effect **on the touchdown frame**, reversing within 1–2 frames with no slide.
4. **Speed in the air = run speed:** a running jump covers 3.2 m/s × 0.89 s = **2.8 m (≈ 0.2 arena widths)** horizontally. A jump from rest moves 0 m.
5. **No landing lag:** Space pressed on the touchdown frame starts a new jump on that frame. Movement input applies immediately on landing.
6. **Run speed:** hold W. Steady speed **3.2 ± 0.25 m/s**, so border to border (14 m) takes **4.4 ± 0.3 s**. This must be **slower than a laser** (ratio 0.76 ± 0.06): a player can never outrun a sweeping beam.
7. **Snappy start and stop:** from rest, full speed within **≤ 2 frames**. On release, stopped within **≤ 2 frames** (stopping distance < 0.1 m).
8. **Reversal:** D→A at full speed reaches full speed the other way within **≤ 100 ms**. The body faces the new direction within ~0.1 s for 180°.
9. **Backward:** hold S. The character turns to face the camera and runs at **full speed**. No backpedal animation or speed penalty.
10. **Laser pass:** a beam holds 0.5–1.0 s at the start edge, then crosses the 14 m arena in **3.34 ± 0.1 s** at constant speed. Opposite beams pass through each other.
11. **Hitbox:** standing still without jumping, a beam whose centre comes within **0.51 ± 0.1 m** of the body centre registers a hit (with feet below **0.38 m**).
12. **Standing-jump window:** standing still, jump t seconds before a beam's centre reaches you. **t = 0.2–0.45 s must always clear.** **t ≤ 0.1 s must be hit.** The total clearing window should measure **≈ 0.5 s**.
13. **Running into a beam:** running toward a beam doubles the closing speed (≈ 7.4 m/s). A jump 0.15–0.6 s before contact clears.
14. **Hit feedback:** a 50–120 ms orange burst on the body, −20 points, **no knockback, stun or slowdown**, and at most one hit per beam pass.
15. **Camera:** pitch ≈ 33°, distance ≈ 12.7 m, vertical FOV ≈ 60°. **The camera follows the jump height**: the character keeps the same screen position mid-jump while the floor drops. There is no follow lag on run start or stop.
16. **Scale:** the arena is 11 ± 0.7 character heights wide (14 m / 1.27 m).

---

### Files
- `research/video-hd/video1080.mp4`: 1080p60 main video. `research/video-extra/<id>/`: cross-check videos.
- `research/feel-tools/`:
  - Registration: `reg.py`.
  - Jump detection and measurement: `vseries.py` / `vxseries.py`, `jumpfind.py`, `jumptable.py`, `apex_frame.py`, `airtime_roots.py`, `apex_arena.py`, `campose.py`.
  - Beams and hits: `beamcross.py`, `hpbar.py`, `flashscan.py`, `scorechg.py`, `redscan.py`, `beamy.py`.
  - Arena: `emitters.py` / `emit_ref.py` / `arena3960.py`, `summary3960.py`.
  - Viewing and tracking: `sheet.py`, `stabsheet.py`, `stabcrops.py`, `multicrop.py`, `gridcrop.py`, `track.py`, `camstill.py`.
- `research/feel-out/`: key evidence.
  - `win/R*.npz`: per-window registrations.
  - `jumps_roots.txt`: per-jump airtime and apex.
  - `ks4030.jpg`: shadow detached during jump 6.
  - `k9256.jpg`: hit flash of jump 9.
  - `k4034.jpg`: hit flash of jump 6.
  - `stand_h.jpg`: character height.
  - `panel9020.jpg`: score-cell lag.
  - `em3960.csv`, `A3960.npy`: laser emitters and arena calibration.
