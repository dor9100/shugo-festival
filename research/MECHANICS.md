# "Jump Jump" (Shugo Festival mini-game, AION 2): mechanics spec

Source: YouTube `HDwM-UsNnvo`, "AION 2 Jump Jump Guide | Shugo Festival Mini-Game, 1st Place Run" by GAC Film Room
(uploaded 2026-09-30, 3:48 long, 1080p60, downloaded at 720p60). One full round with 4 players: Koschey (the recorder), Ostayeam, Percy and Nemesis.
No subtitles or auto-captions exist. The video description lists the in-game rules. Metadata is in `research/video/metadata.json`.

All timestamps are **video time** (mm:ss.s). Round time is video time minus about 15.7 s. Confidence levels:
**[H]** high (seen directly or read off the HUD), **[M]** medium (inferred from several frames), **[L]** low (rough estimate or guess).

> **Video overlays are not game UI.** The gold-on-dark captions in the bottom-left ("Touch the Balloons", "Jump the Lasers",
> "Crosses and Squares", "Watch the Bombs", "Halfway", "Ostayeam Takes the Lead", "Down to the Wire", "First Place",
> "Monster Cube") and the intro title cards (0:00–0:15) were added by the YouTuber. The game UI is described in §2.

> **Naming and terminology.** The game calls the pickups **balloons**: green, **pink** and yellow. The brief calls them
> "orbs" and the pink one "purple". The in-game rules say *green balloons give points, jump lasers with Space (a hit costs points),
> pink balloons give temporary invincibility, bombs "make you jump by surprise", and you can only move (WASD) and jump (Space)*.

> **IP note for the clone.** The mascot, names ("Shugo", "Aion"), UI art and NPC art belong to NCSoft. The character notes
> in §8 are only a reference for proportions, readability and feel. Design an **original** mascot and use original names in the shipped game.

---

## 1. Round flow

| Video time | Round time | Event | Conf. |
|---|---|---|---|
| 0:15.2 | – | Fade in from black. The player is already a mascot inside the arena with the other players. No countdown on screen (the video may be trimmed here). | H |
| 0:15.7 | 0:00 | The event tracker reads **"Jump Jump · 02:45"** and counts down 1 per second. The rank panel says *"No Point acquisition information."* | H |
| 0:15.6–0:24 | 0–8 | The NPC bubble ("Shugo Jump Researcher", bottom-center with portrait) explains the rules in sequence: touch balloons for points, laser touch costs points. A bomb line appears later at 1:18. | H |
| 0:16.5–0:17 | +1 | **First balloons: a cluster of about 5 green balloons near the center.** All 4 players score +50 or +100 by 0:19. | H |
| 0:26.0 | +10.3 | **First laser**: one line sweeps near edge → far edge (tutorial wave). | H |
| 0:36.1 | +20.4 | **First pink balloons (2).** Picked up at 0:37.5 for +60 each. | H |
| 0:37.4–0:52.8 | +22–37 | First continuous laser chain (crosses and squares) lasting 15 s, with green balloons. | H |
| 0:53.9–1:10.4 | +38–55 | More patterns (square, cross, a pair of lines) with gaps of 1–2.5 s. | H |
| 1:10.4–1:29.9 | +55–74 | **No lasers for about 19 s.** NPC: bombs "make you jump in surprise". **Bomb wave 1 (2 bombs + 6 yellow balloons) at 1:18.4, exploding at 1:21.8.** | H |
| 1:27.3 | +71.6 | Pink balloons (3) plus 1 green. | H |
| 1:29.9–2:56.2 | +74–160.5 | Lasers with gaps of 2–4 s (one gap of 8 s) and steady green spawns. **Bomb wave 2 (3 bombs + 9 yellow balloons) at 2:07.4–2:08.4, while lasers are active.** Pink pair around 2:19.5. | H |
| 2:41.6–2:56.2 | +146–160.5 | **Final continuous laser chain of about 15 s** (squares, # grids, crosses). | H |
| 2:56.2–3:00.7 | +160.5–165 | Lasers stop. The last 4–5 s are calm. | H |
| 3:00.7 | 165 | Timer reads 00:00. Play continues for about 1.5 s. | H |
| 3:02.25 | +166.5 | Screen dims. Results panel **"Jump Jump / Event Complete / Event Results"** with columns Rank · Name · Legion · Points. Own row highlighted. A gold **Reward** button sits over a 30 s countdown (00:29). An "Achievement Unlocked" banner flashes. | H |
| 3:08 | – | **Monster Cube** reward screen: 5 face-down cards, "Can select 4 time(s)", 25 s timer, buttons *Cancel Selection* and *Selection Complete*. 1st place gets 4 picks and 3rd place gets 3 (per the description). | H |

- **Round length: 165 s** as shown by the timer (02:45 → 00:00) [H]. A short pre-phase might have been trimmed, since the video starts at 02:45 rather than 03:00 [L].
- **End condition: the timer only.** There are no lives and no elimination. Highest score wins and tied scores share a rank badge [H].
- Final standings: Koschey **1,040**, Ostayeam **1,020**, Percy 570, Nemesis 170 [H].

## 2. HUD (game UI)

- **Rank panel (top-right, left of the minimap)** [H]. Header "Rank" with a "View All" button. The player's own row is pinned at the top with a teal highlight. Below it is the sorted list: round rank-medal icon (1 / 2 / 3, ties share a number), name, and points with a thousands separator ("1,040"). About 4 rows are visible and the list scrolls. Before anyone scores it shows "No Point acquisition information." The footer reads "Displayed when points are…" (truncated, probably "…acquired"). The panel updates instantly on every score change.
- **Event tracker (below the minimap)** [H]: event icon, "Jump Jump", clock icon and **mm:ss countdown**.
- **Key hints (right edge)** [H]: Change Control, Show Cursor, **Jump (Space), Forward W, Back S, Left A, Right D**, and "Hide <Jump Jump>".
- **NPC tip bubble (bottom-center)** [H]: portrait, NPC name in teal, and a one-line tip. It appears at rule introductions (0:15.6 balloons, 0:22 lasers, 1:18 bombs).
- **Red system message (top-center)** "Cannot glide in current state." appears when Space is pressed in mid-air (2:17.5). There is **no double jump and no glide** [H].
- The normal MMO hotbar and HP/MP bars stay on screen but are unused, because skills are disabled during the event [M].
- I could not find a separate game "+50" popup at 720p. Score feedback is the pickup sparkle plus the rank-panel update [M].

## 3. Arena

- **Square floor**, grey stone with a raked-sand (zen-garden) swirl pattern [H]. **Size about 13–14 mascot heights per side** [M/L]. I measured it at three camera angles: arena width at a given depth is about 13–14 times a character's apparent height after correcting for camera pitch.
- **Dark cross-shaped rails**: two thin, dark, low rails through the center, parallel to the edges, splitting the floor into **4 equal quadrants** [H]. Players walk over them, so they are decorative and serve as orientation cues [M]. Balloons and lasers ignore them [H].
- **Border**: a raised copper/brown **toothed rail** (comb-like teeth) about 0.3 m wide around the square [H]. The laser emitters slide along it (§4).
- **Outside the border**: a stone walkway about 2–3 m wide around the arena (octagonal outline) with a low balustrade and decorative posts (pointed finials with draped cloth) [H]. **Spectators** (normal-size, untransformed players) stand on the walkway [H]. The **"Shugo Festival Manager"** NPC (teal nameplate, red hat) stands on the walkway at the far-right corner [H].
- Scenery: lawn, red egg-shaped festival huts with teal ornaments, tall yellow banners, floating islands, hot-air balloons, a sea of clouds and a bright sunny sky [H].
- Participants appear to stay inside the square. I never saw anyone leave it, so it is probably bounded [M].

## 4. Lasers

**Look** [H]: a bright red-orange core with heavy pink/red bloom that tints the floor red. At each end, where the beam meets the border rail, sits a **white-hot glowing emitter node**. There are no physical posts: the beam is strung between two glowing points that **slide along the border rail**. Core thickness is about 0.1 m and glow width about 0.3–0.4 m [M]. Beams **float low**, at roughly shin height of the mascot, **about 0.2–0.3 m above the floor** [M]. Every beam **spans the whole arena** from edge to edge, so the only way to avoid one is to jump it (or be on the far side when it stops).

**Orientation** [H]: always parallel to an arena edge. The "X" shapes seen from rotated or low cameras are perpendicular '+' crosses viewed in perspective (checked against the rails at 0:47.0 and 0:58.5). No diagonal or rotating beams appear.

**Patterns** (the description says lines, crosses and full squares) [H]:
1. **Line**: 1 beam, or 2 parallel beams starting at opposite edges. Each sweeps perpendicular to itself across the whole arena. In the 2-beam version they converge, pass through each other at the center, and continue to the opposite edges (1:04.6–1:10.4).
2. **Cross**: one beam on each axis, both sweeping at once, so the "+" intersection travels diagonally across the arena (0:57.5–0:59.0 corner to corner; 2:52).
3. **Square**: 4 beams on the 4 edges (a perimeter square) that all move inward. The square shrinks into a "#" grid, the beams cross at the center, then expand out to the opposite edges (0:49.5–0:54.5; 2:41.5–2:45.5; 2:46.5–2:49).
- Up to **4 beams at once** (square/#) [H]. Patterns chain directly into each other in the long waves [H].

**Lifecycle and timing**:
- **No separate warning beam** [H]. Beams pop in at full brightness at the starting edge (0:26.0, frame by frame). They usually **hold about 0.5–1 s at the edge** before moving, and that hold is the telegraph [M].
- **Sweep speed**: a full edge-to-edge pass takes **about 3.5–4 s**, roughly 0.25–0.28 arena widths per second, or **about 3.7 m/s** if the arena is 14 m [M]. Examples: the first line went near edge 0:26.0 → center about 0:27.9 → far edge about 0:29.5. One square went edge → center in about 1.8 s (0:50.5 → 0:52.3) and center → edges in about 2 s. Speed looked constant; the apparent slowing near the far edge is perspective.
- At the end of a sweep the beam **holds about 1 s at the far edge**, then vanishes (0:29.5–0:30.8; 1:08–1:10.3) [M].
- **Laser-on segments** from red-pixel analysis (`frames/color_timeline_10hz.csv`) [H]:
  26.1–30.8 · 37.4–52.8 · 53.9–62.1 · 64.6–70.4 · *(break 70.4–89.9)* · 89.9–95.0 · 98.7–104.3 · 112.4–116.0 · 118.2–132.3 · 134.5–140.2 · 142.4–148.1 · 152.5–158.3 · 161.6–176.2.
- **Escalation** [M]: one tutorial line, then chains of crosses and squares, then a break for bomb wave 1. In the second half bombs overlap with lasers, gaps shrink to about 2–4 s, and the last 15 s is a non-stop chain. I could not see the sweep speed itself increase [L].

**Jumping** [M/L]: a quick, short hop, roughly 0.5–0.8 m at the apex, with **about 0.6–0.7 s** of airtime. That clears the low beam easily if timed. It was hard to measure at 720p, so treat both numbers as **[L]**. Space in mid-air does nothing except show the glide error.

## 5. Balloons (pickups)

The game calls them balloons. All three types are glossy, translucent glowing spheres **about 0.7–0.8 m in diameter** (about ¾ of the mascot's height). Each **hovers at about head height** (center about 0.6–0.9 m above the floor) with a gentle bob and a faint vertical light shaft down to the floor that marks its ground position [M]. Touching one gives an instant pickup with a sparkle burst in the balloon's color around the player [H]. Pickup radius is about body contact, roughly 0.6–0.8 m from the player's center [L]. Jumping is not needed.

| Type | Points | Effect | Spawning observed | Conf. |
|---|---|---|---|---|
| **Green** | **+50** | – | Opening cluster of about 5 at the center (0:17). After that **1–3 on the field at a time**, a new one about every 3–5 s at random spots inside the square. They keep spawning during laser waves. Usually grabbed within 1–4 s, so I could not observe their lifetime. | +50 H; spawn rate M |
| **Pink** (magenta, "purple" in the brief) | **+60** | **Temporary invincibility to lasers** | Waves of 2–3: **0:36.1 (2), 1:27.3 (3), about 2:19.5 (2)**, roughly every 50 s. Each has a tall pink light pillar, so it is visible from afar. | +60 H; timing H |
| **Yellow** (gold) | **+70** | – | **3 per bomb, spawned at the same moment as the bomb**, placed around it **inside its blast circle** (about 1–1.5 m from the bomb) as bait. They **persist after the explosion**: the last ones were collected about 2.2–2.9 s after their bomb exploded, and I never saw one expire. | +70 H; 3/bomb H; lifetime M/L |

- **Pink invincibility look** [M]: the character turns pale, slightly translucent and gold-white glowing (0:38.5–0:43.5). It was gone by 0:46.5, consistent with the brief's **8 s** (pickup 0:37.5 → about 0:45.5). Koschey kept 160 points through dense lasers during that window.
- Score evidence [H]: 0:17 Ostayeam 0→50 (green). 0:37–0:38 Koschey/Ostayeam 100→160 (pink +60). 1:23 Koschey 320→460 (two yellow, +140). 1:23–1:25 Ostayeam 240→380→450 (three yellow). 2:10–2:14 wave 2 yellows: Koschey +210, Ostayeam +210 and +70, Percy +140, which is 9 yellows for 3 bombs.

## 6. Bombs

- **Waves** [H]: **wave 1 at 1:18.4 (round +62.7 s, about 1:42 left)** had 2 bombs, during a laser break. **Wave 2 at 2:07.4–2:08.4 (round +112 s, about 0:53 left)** had 3 bombs spawned in a staggered way (about 0.3–0.5 s apart) **while lasers were active**. Both waves spawned in the **central area**, overlapping, around where most players were [M]. They may target player positions [L].
- **Look** [H]: a pearl-white sphere (about 0.5 m) with a pink glow, sitting on the floor. Beneath it is an **orange translucent ground circle** with a bright rim and an **inner disc that grows to the rim over the fuse**, a classic fill telegraph. In the **last ~1 s a tall magenta light pillar** shoots up from the bomb (2:08.7–2:09.4).
- **Fuse: about 3.2–3.5 s** [M/H]. The orange circle appears at 1:18.4 and the explosion comes at 1:21.8. In wave 2, the first circle appears at 2:07.5 and the first explosion comes at about 2:09.8; the later bombs exploded about 2:10.4 and 2:11.1.
- **Blast radius: about 0.22–0.24 arena widths, roughly 3 m** [M]. The circle's diameter is about 48% of the arena width at the same depth (1:20.3). The two wave-1 circles overlapped heavily.
- **Explosion** [H]: a purple/magenta flash, then a purple smoke cloud filling the circle that lingers about 1–1.5 s.
- **Effect: "fear" / "jump in surprise"** [M/H]. Players inside the circle **lose control and run around for about 2.3 s**. A small countdown badge (**"2" → "1"**) appears under the player's own nameplate, and the bar under the name turns green for the duration (1:22.0 → 1:24.15). **No points are lost** to the bomb itself [H]. Pickups still work while feared: Koschey collected 2 yellows (+140) mid-fear at 1:22.5–1:23.4 [H]. The flee direction looked like away from the blast but was hard to confirm [L]. Lasers presumably still hit feared players [L].

## 7. Damage and scoring

- **Laser hit = −20** [H]. Seen many times: 0:54 Koschey 210→190, 0:58 Ostayeam 260→240, 0:58/1:00 Nemesis 110→90→70, 1:08 Koschey 240→220, 2:08, 2:18, 2:20, 2:36 …
- **−40 drops** appear when two beams cross a player within about 1 s, for example 2:01–2:02 Ostayeam 580→540, or the description's "dropped 40 points with 6 seconds to go" [H]. Beams sweep past quickly, so a continuous "stand in it" tick never happens. The data fits **one hit per beam pass**, or a hit cooldown of about 1 s [M].
- **Hit feedback** [M]: no knockback, stun or flinch is visible. The character keeps running, the beam passes through, and the rank panel drops by 20. At 720p I could not make out any floating "−20" text.
- **Negative score**: I never saw it. The lowest score was 50–70 early [–]. Recommend clamping at 0 [L].
- Balloons +50 / +60 / +70 and bombs 0 [H].

## 8. Player character (reference only; build an original mascot)

- Players are transformed into **small (about 1 m) furry, bipedal, rodent-like mascots** with a **big head (about 40% of total height)**, **tall upright ears**, a pale cream/white head, a **dark maroon/brown robe-like body** and a bushy tail [M]. NPC versions wear red hats [H].
- Animation: quick, scurrying, forward-leaning run and a springy little hop [M].
- **Nameplates** [H]: optional legion in angle brackets (for example `<LEGION>`), then a title line, then the name. Other players' names are white. **The player's own title and name are green** and have a **red HP bar over a blue MP bar** under the name. The fear countdown badge appears under that bar. NPC names are teal-green.
- For the clone: keep the readable silhouette (tiny body, oversized head and ears, distinct tail) and per-player tint colors, but design the creature, palette details and names ourselves.

## 9. Camera

- A standard MMO third-person **orbit camera that follows the player**, with mouse-controlled yaw and pitch [H]. The recorder mostly kept a high three-quarter view, **pitch about 35–50° down**, at a distance that frames almost the whole arena. Occasionally they rotated 45° or dropped to a low angle (1:55–2:03) [H].
- Clone recommendation: a fixed-yaw follow camera at about 50° pitch that keeps the whole square in view, with a little lerp toward the player. Optionally allow Q/E rotation in 90° steps.

## 10. Game-feel notes

- The core tension is **greed versus safety**: balloons sit in a laser's path, and yellows sit inside the bomb circle.
- The edge-spawn hold of about 0.5–1 s and the big glowing emitter nodes make lasers readable without a separate warning.
- The lasers' red bloom on the floor and the purple bomb smoke dominate the palette against the grey floor. The balloons' saturated green, pink and gold read clearly against both.
- The live leaderboard creates comeback drama: the lead changed several times and the final margin was 20 points, a single laser hit.
- Controls are limited to WASD and Space, with no skills and no glide, so there is a single verb besides running.
- The ending has a calm tail of about 5 s, a results screen about 1.5 s after 00:00, then a reward pick (4/3/... picks by placement).

---

## Recommended constants

Units: meters, seconds. "Est." marks my best guess where the video could not settle the number.

| Constant | Value | Basis / confidence |
|---|---|---|
| `ROUND_SECONDS` | **165** | Timer 02:45 → 00:00 [H]. Use 180 if you want a 15 s intro phase. |
| `RESULTS_DELAY` | 1.5 | 00:00 → results panel [H] |
| `RESULTS_CLAIM_SECONDS` | 30 | Reward button countdown [H] |
| `CHARACTER_HEIGHT` | 1.0 | From the brief (mascot ≈ 1 m) |
| `ARENA_SIZE_M` | **14** (square, ±7) | About 13–14 mascot heights [M/L] |
| `BORDER_RAIL_WIDTH` | 0.3 | [L] |
| `WALKWAY_WIDTH` | 2.5 | Spectator ring outside the border [L] |
| `PLAYER_SPEED` | 5.0 | Est. [L]. Must exceed laser speed. |
| `PLAYER_RADIUS` | 0.35 | Est. [L] |
| `JUMP_HEIGHT` (apex) | 0.8 | Est. [L]. Must clear laser top (about 0.4) with margin. |
| `JUMP_DURATION` | 0.65 | Est. [L]. Single jump, no double jump or glide [H]. |
| `LASER_HEIGHT` (center) | 0.25 | Shin height [M] |
| `LASER_HIT_HALF_THICKNESS` | 0.15 | Collides if feet below 0.4 and within 0.15 + `PLAYER_RADIUS` of the line [L] |
| `LASER_SPEED` | **3.7 m/s** (≈0.27 arena/s) | Full pass 3.5–4 s [M] |
| `LASER_SPAWN_HOLD` | 0.75 | Hold at start edge before moving [M] |
| `LASER_END_HOLD` | 1.0 | Hold at end edge before vanishing [M] |
| `LASER_MAX_BEAMS` | 4 | Square/# pattern [H] |
| `LASER_PATTERNS` | line(1), lines(2 opposite), cross(+), square(4→#→4) | [H] |
| `LASER_WAVE_GAP` | 6 → 2 s (shrinks over the round) | Observed 6.6/2.5 early, 2.2–4.4 late [M] |
| `LASER_FIRST_AT` | 10 s | [H] |
| `LASER_FINAL_CHAIN` | last ~15 s non-stop, lasers stop 4.5 s before end | [H] |
| `LASER_PENALTY` | **−20** | [H] |
| `LASER_HIT_COOLDOWN` | 1.0 (per beam: max 1 hit per pass) | [M] |
| `SCORE_MIN` | 0 | Est. [L] |
| `BALLOON_DIAMETER` | 0.75 | [M] |
| `BALLOON_HOVER_HEIGHT` (center) | 0.75, bob ±0.08 at 0.5 Hz | [M]/[L] |
| `PICKUP_RADIUS` | 0.7 (center to center, horizontal) | Est. [L] |
| `GREEN_POINTS` | **50** | [H] |
| `GREEN_OPENING_CLUSTER` | 5 at t=1 s near center | [H] |
| `GREEN_SPAWN_INTERVAL` | 3.5 (±1 random) | [M] |
| `GREEN_MAX_ALIVE` | 3 | [M] |
| `GREEN_LIFETIME` | 10 | Est. [L] (never saw one expire) |
| `PINK_POINTS` | **60** | [H] |
| `PINK_IMMUNITY` | **8** | From the brief; visual matches about 8 s [M] |
| `PINK_WAVES_AT` | 20, 72, 124 s (2–3 each) | [H] |
| `PINK_LIFETIME` | 8 | Est. [L] |
| `BOMB_WAVES_AT` | 63 s (2 bombs, laser break), 112 s (3 bombs, with lasers) | [H] |
| `BOMB_STAGGER` | 0.4 | Between bombs in a wave [M] |
| `BOMB_FUSE` | **3.3** | [M/H] |
| `BOMB_PILLAR_WARNING` | last 1.0 s of fuse | [M] |
| `BOMB_RADIUS` | **3.0** | ≈0.22 arena width [M] |
| `BOMB_SMOKE_LINGER` | 1.2 | Visual only [M] |
| `FEAR_DURATION` | **2.3** | Badge "2"→"1" [M/H] |
| `FEAR_RUN_SPEED` | = `PLAYER_SPEED`, away from blast, ±30° random wander | [L] |
| `FEAR_CAN_PICKUP` | true; jump disabled | Pickup [H], jump [L] |
| `YELLOW_POINTS` | **70** | [H] |
| `YELLOW_PER_BOMB` | **3**, at radius 1.2 around the bomb, spawned with the bomb | [H]/[M] |
| `YELLOW_LIFETIME_AFTER_EXPLOSION` | **3.0** | Collected up to about 2.9 s after the blast and never seen expiring [M/L] |
| `CAMERA_PITCH_DEG` | 50 | [M] |
| `CAMERA_DISTANCE` | 14 | Frames the whole arena [L] |

---

### Evidence files
- `research/video/video.mp4` (720p60) and `research/video/metadata.json`
- `research/key-frames/` holds 14 representative frames: arena overview, single line, edge square, converging #-grid, cross, green cluster, pink trio, pink immunity glow, bombs with yellow balloons and AoE circles, explosion and fear, wave-2 bombs, HUD/low camera, results, and reward cards.
- `research/frames/sheets/` holds 3×3 contact sheets every 2 s with timestamps. `frames/dense/` holds 2–20 fps zoomed sheets (lasers, bombs, fear, jumps, hits). `frames/rank/` holds 1 fps crops of the rank panel used for the score timeline. `frames/hud/` holds timer, NPC bubble and results crops.
- `research/frames/color_timeline_10hz.csv` has red/yellow/green/magenta/orange pixel counts at 10 Hz, used to time laser waves, bomb circles and balloon presence.
