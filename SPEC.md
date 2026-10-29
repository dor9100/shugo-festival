# Shugo Festival – Jump Jump (web clone) — Build Spec

Practice clone of Aion 2's Shugo Festival "Jump Jump" minigame. 3D, multiplayer, play with friends by sharing a room code.
**Read `research/MECHANICS.md` first** (mechanics from the real game video) and look at `research/key-frames/*.jpg` for the look.
All numbers live in `shared/config.js` — never hard-code gameplay numbers elsewhere.

## Tech decisions

| Concern | Choice | Why |
|---|---|---|
| Rendering | **Three.js** (r186, `three/addons/...` for postprocessing & CSS2DRenderer) | True 3D + free orbit camera. |
| Bundler | **Vite 8** (root = `client/`, `base: './'`, alias `@shared` → `shared/`) | Static build that works on any sub-path (GitHub Pages). |
| Game logic | **`shared/room.js`** – one transport-agnostic `Room` class (pure ESM, no Node/DOM APIs, time + rng injected) | Same code runs on the Node server *and* inside the host's browser. |
| Online mode A (primary) | **P2P via PeerJS** (`peerjs` npm; WebRTC data channels; PeerJS cloud signalling + its default STUN/TURN). Host's browser runs `Room`. | Static site only (GitHub Pages) → permanent URL, nothing to keep running. Friend only needs the code. |
| Online mode B | **Node server** (`server/index.js`, `ws`) serving the client + `/ws` + `/api/info` | Local dev (`npm run dev`), LAN, Render-style hosting, bots/tests. |
| Solo practice | Same `Room` run locally via in-memory loopback (no network at all), optional bots | Practice offline. |
| Net model | Own movement client-authoritative (zero input lag for jumping). Room authoritative for phase, timer, balloons, bombs, scores. Lasers are deterministic descriptors + a synced clock; each client detects its own laser hits and balloon touches and sends *claims* that the room validates. | Fair from the jumper's point of view; friends-only game, light validation is enough. |

Client mode selection: `?mode=p2p|server|solo` overrides; otherwise `fetch('./api/info')` → 200 JSON `{server:true}` ⇒ server mode, else P2P.

## Repo layout & ownership (agents must only edit files they own)

```
package.json, vite.config.js, SPEC.md            (lead)  ask lead via NOTES-<agent>.md for changes
shared/config.js, shared/lasers.js                (lead)  contracts — read-only for agents (NET may add new constants at the end of config.js)
shared/rng.js, schedule.js, room.js, bots.js, protocol.js   (NET)
server/**, scripts/**, test/** (unit/integration)         (NET)
client/src/net/**                                         (NET)   session API below
client/src/world/**                                       (WORLD) all 3D look: renderer, arena, mascot, lasers/balloons/bombs/effects views
client/index.html, client/src/main.js, client/src/game/**, client/src/ui/**, client/src/style.css, client/public/**   (GAME)
e2e/**                                                    (QA, later)
```
If you need a contract change, write it to `NOTES-<agent>.md` at repo root and keep the existing contract working. Each agent leaves a short `NOTES-<agent>.md` describing what it built, how to run/test, and known gaps.

## Session API — `client/src/net/session.js` (NET implements, GAME consumes)

```js
export async function createRoom({ name, mode })     // -> Session. mode: 'p2p' | 'server' | 'solo' | undefined (auto)
export async function joinRoom({ code, name, mode })  // -> Session. throws Error with a user-readable message (bad code, full, unreachable)
export async function detectMode()                    // -> 'server' | 'p2p'
// Session
session.you            // my player id (string)
session.code           // room code: ROOM_CODE_LEN chars from ROOM_CODE_ALPHABET ('SOLO' for solo)
session.mode           // 'p2p' | 'server' | 'solo'
session.isHost         // getter; host can start rounds, add/remove bots
session.now()          // synced ROOM clock in ms — use for ALL timing (lasers, expiries, fear, immunity, timer)
session.ping           // smoothed RTT ms (0 for host/solo)
session.on(type, fn)   // room→client messages by `t`; also 'close' ({reason}) and 'error'
session.off(type, fn)
session.send(msg)      // client→room message object
session.close()
```
- Invite link: `${location.origin}${location.pathname}?room=CODE` (plus `&mode=` if it was forced). Opening it pre-fills the code.
- P2P: host peer id `shugojj-v1-<CODE>`; JSON over a reliable data channel. Host's own client talks to its local `Room` through an in-memory loopback with the same message shapes. Host ticks the room at `TICK_HZ` with a Worker-based timer (not throttled like rAF/setInterval). If the host leaves, others get `closed`.
- Time sync: `ping` every 2 s (every 250 ms for the first 2 s); offset from the lowest-RTT samples (median of best 5).

## Protocol (JSON, field `t` = type) — `shared/protocol.js` mirrors this

Client → Room
| t | fields | notes |
|---|---|---|
| `hello` | `name, v` | first message (`v` = PROTOCOL_VERSION) |
| `ping` | `c` | → `pong {c, s}` |
| `st` | `x,y,z,ry,a` | own state at `CLIENT_SEND_HZ`. y = feet height (0 on floor). `a`: 0 idle, 1 run, 2 air, 3 feared |
| `pickup` | `id` | balloon claim. Valid if alive and last known x,z within `PICKUP_RADIUS + PICKUP_TOLERANCE` |
| `hit` | `id` | laser claim on myself. Valid if beam present at room time (± `HIT_TIME_TOLERANCE_MS`), I'm not immune, and this beam hasn't hit me yet (max one hit per beam per player) |
| `start` | – | host only; from `lobby` or `results` → `countdown` |
| `name` | `name` | rename (lobby/results only) |
| `bot` | `add: bool` | host only; add/remove a bot (bots are simulated inside Room) |

Room → Client
| t | fields | notes |
|---|---|---|
| `welcome` | `you, code, hostId, phase, phaseStart, phaseEnd, roundStart, players[], orbs[], bombs[], lasers[], now` | full snapshot on join. Late joiners join the running round immediately with 0 points |
| `pong` | `c, s` | |
| `roster` | `players:[{id,name,color,score,bot}], hostId` | on join/leave/rename/host change |
| `phase` | `phase, phaseStart, phaseEnd, roundStart` | `lobby` (free run, nothing spawns) → `countdown` (`COUNTDOWN_MS`) → `playing` (`ROUND_MS` + `OVERTIME_MS`) → `results` (`RESULTS_MS`) → `lobby` |
| `snap` | `s, p:[[id,x,y,z,ry,a,at],...]` (at = sample time of the row) | `SNAP_HZ`; all players incl. bots; clients ignore their own row and interpolate others `INTERP_DELAY_MS` behind |
| `spawn` | `id, x, z` | at countdown start, per player; that client teleports there (others just see it in snaps) |
| `laser` | `l` (beam descriptor, see shared/lasers.js) | sent ≥ `LASER_LEAD_MS` before `l.t0` |
| `orb` | `id, k ('green'\|'pink'\|'yellow'), x, y, z, at, exp, bomb?` | `y` = center height (`ORB_Y` on the ground, `ORB_Y_AIR` = needs a jump); `exp` = expiry room ms; yellows carry their `bomb` id |
| `orbGone` | `id, by?, pts?` | taken (`by`, `pts`) or expired (no `by`) |
| `bomb` | `id, x, z, at, boomAt` | ground circle radius `BOMB_RADIUS` |
| `boom` | `id, x, z, feared:[{id, dx, dz, until}]` | everyone within `BOMB_RADIUS` (room's last known pos; immunity does NOT protect). dx,dz = unit flee vector (away from bomb ± `FEAR_WANDER_DEG`) |
| `score` | `id, score, d, why ('orb'\|'laser'), k?` | every score change (floating "+50"/"−20" text, rank panel) |
| `immune` | `id, until` | pink balloon |
| `results` | `ranking:[{id,name,score,rank}]` | ties share rank |
| `err` | `msg` | |
| `closed` | `msg` | room ended (P2P host left / server shutdown) |

## Round script (Room + `shared/schedule.js`; all from config)

Round time `rt` = room time − `roundStart`. Timer shown = `ceil((ROUND_MS − rt)/1000)` as `mm:ss`, clamped at 00:00.
- Balloons: `GREEN_OPENING` cluster at 1 s near center; then a green every `GREEN_SPAWN_MS ± jitter` while fewer than `GREEN_MAX_ALIVE` alive; random spots inside `PLAY_LIMIT - 0.5`. `PINK_WAVES` at fixed times. All have lifetimes (config).
- Lasers: `schedule.js` builds the whole round's beam list from a seed at round start (room then announces each beam `LASER_LEAD_MS` ahead). Patterns (all beams full edge-to-edge passes): **line** (1 beam), **lines** (2 beams from opposite edges crossing at center), **cross** (one x-beam + one z-beam moving together → "+" travels diagonally), **square** (4 beams on the 4 edges moving inward → "#" → out to opposite edges). Never more than `LASER_MAX_BEAMS` present at once. Timeline modelled on the video: tutorial single line at `LASER_FIRST_AT_MS`; chain ~22–37 s; patterns with 1–2.5 s gaps until ~55 s; **no lasers ~55–74 s** (bomb wave 1 at 63 s); 74–146 s patterns with 2–4 s gaps (bomb wave 2 at 112 s overlaps lasers); **non-stop chain ~146 s → `ROUND_MS − LASER_STOP_BEFORE_END_MS`**. Gaps shrink over time.
- Bombs: `BOMB_WAVES`; bombs land in the central area near players (e.g. around the player centroid ± jitter, kept inside the arena, waves' bombs offset from each other ~1.5–3 m), staggered `BOMB_STAGGER_MS`. **3 yellow balloons spawn with each bomb** on a ring of `YELLOW_RING_RADIUS` around it, expiring `YELLOW_LIFETIME_AFTER_BOOM_MS` after the boom.
- Scoring: balloon points per `ORB_POINTS`; pink also grants `IMMUNITY_MS` immunity to lasers. Laser hit `LASER_PENALTY`, max once per beam per player, never below `SCORE_MIN`. Bombs cost no points.
- Fear: feared player runs along (dx,dz) at `FEAR_SPEED` until `until`, no input, no jumping, slides along the arena clamp; can still pick up balloons and still be hit by lasers.
- Bots (`shared/bots.js`): simple AI simulated by the Room at `TICK_HZ`: walk toward the nearest balloon, jump when a low beam is about to reach them (with human-ish random failure ~15–25%), obey fear. They use the same hit rules.

## Gameplay feel (client, GAME agent)

- Movement: WASD/arrows, camera-relative, `MOVE_SPEED`, quick accel (no ice-skating), face movement direction (smooth turn). Clamp |x|,|z| ≤ `PLAY_LIMIT`.
- Jump: Space when grounded → `JUMP_VELOCITY` under `GRAVITY`. Space in mid-air → red top-center system message "Cannot glide in current state." (faithful detail). No double jump. Can't jump while feared.
- Each frame: swept laser test vs every known beam (`laserHitTest`), claim once per beam (`hit`), show local feedback immediately (red flash + "−20" float) but only update the score from `score` messages. Skip while immune. Balloon touch → `pickup` claim, hide it optimistically (restore if the room doesn't confirm in ~1 s).
- Camera: free MMO orbit around own mascot. Mouse drag (left or right button) yaw 360° / pitch 10°–85°, wheel zoom 4–24 m, default pitch ~50°, distance ~14 (whole arena visible). Smooth follow. Optional keys Q/E rotate yaw. Pointer stays visible.
- HUD (style after the game, own original art): top-right **Rank panel** (own row pinned with teal highlight, then sorted list with 1/2/3 medal badges, ties share rank, thousands separators, "No Point acquisition information." when empty, footer "Displayed when points are acquired"), under it an **event tracker** "Jump Jump ⏱ 02:45". Right-edge **key hints** (Jump Space, Forward W, Back S, Left A, Right D). **NPC tip bubble** bottom-center at rule moments: start "Touch the balloons to earn points!", ~8 s "Jump over the lasers with Space — touching them costs points!", first pink "Pink balloons grant temporary invincibility!", bomb wave "Watch out for the bombs — they'll make you jump in surprise!". Countdown "3,2,1, Start!" big center text; "Time!" at 00:00. Own score change floats over head. Ping + room code + invite button in a small top-left panel.
- Results screen: "Jump Jump / Event Complete / Event Results" table Rank · Name · Points, own row highlighted, host "Play again" button, auto back to lobby after `RESULTS_MS`.
- Lobby screen (before joining): name input (localStorage), **Create room**, **Join** with code field, **Solo practice**; shows mode (P2P/server). In-room lobby phase: players can run around the empty arena; overlay with room code (big, copy button + copy invite link), player list, host "Start" + "Add bot"/"Remove bot", non-host "Waiting for host…".
- Tab (hold) = full scoreboard; Esc = small menu (leave room, sensitivity, volume, graphics quality).
- Sound: small WebAudio synthesized SFX (jump, pickup by color, laser hit buzz, bomb tick + boom, countdown beeps) — no external audio files needed.

## World API — `client/src/world/` (WORLD implements, GAME consumes)

```js
// renderer.js
export function createRenderer(container)  // -> { renderer, scene, camera, labelRenderer, render(), resize(), setQuality('high'|'medium'|'low') }
//    WebGLRenderer (antialias, ACES tone mapping, sRGB, shadows), PerspectiveCamera(50°), bloom via EffectComposer (UnrealBloomPass, subtle),
//    CSS2DRenderer overlay for nameplates. Pixel ratio capped at 2 (1 on 'low'). resize() handles window size.
// arena.js
export function createArena(scene)          // -> { update(dt, now) }  floor, rails, border, walkway, balustrade, posts, lawn, sky, festival props, spectators, Festival Manager NPC, lights
// mascot.js  (original cute "shugo-like" critter built from primitives: ~1 m, big head ~40%, tall ears, cream fur, robe in player color, bushy tail)
export function createMascot({ color, name, title, isLocal }) // -> Mascot
//    mascot.root: THREE.Group, origin at feet center, faces +Z at ry=0
//    mascot.update(dt, { moving, speed, airborne, vy, feared, immune, fearLeftMs })  // run cycle, hop squash/stretch, fear wobble, immunity pale-gold glow
//    mascot.setName(name), mascot.setColor(hex), mascot.flashHit()  // red flash
//    mascot.label: CSS2DObject nameplate (title line + name; own = green name + small red/blue bar; fear "2"/"1" badge under it); mascot.dispose()
// lasers.js
export class LaserView { constructor(scene); update(beams /*descriptor array*/, now) ; dispose() }
//    uses beamSegment() from @shared/lasers.js; glowing red-orange beam with white core, bright emitter nodes at both ends on the border,
//    red light spill on the floor, pop-in on appear, fade on vanish. Must handle 0–4+ beams cheaply (pool meshes).
// orbs.js
export class OrbView { constructor(scene); add(orb /* {id,k,x,z,at,exp} */); remove(id, { taken }); update(dt, now); dispose() }
//    glossy glowing translucent balloons (green/pink/yellow), bob, faint light shaft to floor (pink: tall pillar), blink in last 1.5 s before exp,
//    pop/sparkle burst when taken.
// bombs.js
export class BombView { constructor(scene); add(bomb /* {id,x,z,at,boomAt} */); explode(id); update(dt, now); dispose() }
//    pearl-white sphere with pink glow on the floor, orange translucent ground circle (radius BOMB_RADIUS) with bright rim and inner disc filling
//    over the fuse, magenta light pillar in the last BOMB_PILLAR_MS, purple flash + lingering smoke on explode.
// effects.js
export class Effects { constructor(scene); floatText(pos /*Vector3*/, text, color); burst(pos, color); update(dt); }
```
WORLD also builds `client/world-preview.html` + `client/src/world/preview.js`: a standalone page that shows the arena with a few mascots, animated fake beams/balloons/bombs, so the look can be checked without networking.

## Visual direction

Bright sunny festival plaza like the key frames: grey stone floor with raked-sand swirl/fan pattern (procedural canvas texture, generated at load), two dark low cross rails splitting 4 quadrants, copper/brown toothed border rail, outer stone walkway (≈2.5 m) with low balustrade and posts with pointed finials + draped cloth, lawn, flower beds, a few festival props (egg-shaped red huts, yellow banners), sky gradient + distant soft clouds/islands (cheap: billboards or low-poly). Spectator mascots (normal-size humanoid silhouettes optional; simple is fine) around the walkway; a "Shugo Festival Manager" NPC with red hat and teal nameplate at the far-right corner. Lasers bloom red and tint the floor; balloons saturated green/pink/gold. Target ≥60 fps on mid hardware with 8 players. No external asset downloads: everything procedural or generated in code (canvas textures), so the build is self-contained.

## Controls summary

WASD/arrows move · Space jump · mouse drag orbit · wheel zoom · Q/E rotate · Tab scoreboard · Esc menu.
