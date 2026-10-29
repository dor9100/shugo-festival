# NOTES-NET

**Status: done.** Solo, server and P2P sessions all work and are tested in real Chromium (P2P over the PeerJS cloud). `npm test` result: 32/32 pass in about 21 s.

## What exists

| File | What |
|---|---|
| `shared/rng.js` | mulberry32 + `createRng(seed)` → `next, range, int, chance, sign, pick, weighted, shuffle, fork` |
| `shared/protocol.js` | `C2R`, `R2C`, `PHASE`, `ANIM`, `ORB_KINDS` + JSDoc message shapes |
| `shared/schedule.js` | `buildLaserSchedule(seed, roundStartMs)` → beam descriptors for the whole round. `maxConcurrentBeams(beams)` |
| `shared/room.js` | `Room` (phases, host and migration, colors, spawns, balloons, bombs/fear, laser and pickup validation, ranking, snapshots, bots). `PLAYER_COLORS`, `cleanName` |
| `shared/bots.js` | `createBrain`, `stepBot`, `BOT_NAMES` (bots are simulated inside the Room) |
| `server/index.js` | http + `/api/info` + ws `/ws` rooms. `--dev` = Vite middleware + HMR on the same port, else serves `dist/` |
| `client/src/net/session.js` | Session API: `createRoom`, `joinRoom`, `detectMode`, plus `inviteLink`, `inviteCode`, `normalizeCode` |
| `client/src/net/{p2p,local-host,clock,ticker}.js` | PeerJS transport, in-tab Room + loopback, clock sync, Worker ticker |
| `test/*.test.js`, `test/_util.js`, `test/harness/index.html`, `test/index.js` | tests (see below) |

Constants were appended at the end of `shared/config.js` (nothing existing was changed): `LASER_TUTORIAL_TIER`, `LASER_SEGMENTS` (timeline windows, pattern mix, speed-tier mix), `LASER_GAP_JITTER_MS`, `LASER_GAP_MAX_STRETCH_MS`, `LASER_CHAIN_SPEED_RANGE`, `LASER_ANNOUNCE_MARGIN_MS`, `NAME_MAX_LEN`, `SPAWN_RING_RADIUS`, `ORB_SPAWN_LIMIT`, `ORB_MIN_SPACING`, `PINK_MIN_SPACING`, `BOMB_CENTER_LIMIT`, `BOMB_AIM_JITTER`, `BOMB_SPACING`, `MAX_ST_Y`, `BOT_*`.

### Laser timeline (round time)
Every beam carries its own `spd` from one of two tiers, following CRITIC P0-1: slow = `LASER_SPEED_SLOW` (2.9 m/s, 4.8 s pass) and fast = `LASER_SPEED` (4.4 m/s, 3.2 s pass). Chains scale their speeds by one factor of at most ±7% (`LASER_CHAIN_SPEED_RANGE`) to fit their window.

| Round time | Content | Speed |
|---|---|---|
| 10 s | tutorial line | slow |
| 21.7 s | first chain of 3 patterns; it may overrun its window to about 38.5 s | slow |
| about 38.5–47 s | one pattern | slow |
| about 48.8 s | one pattern (matches CRITIC's 1:05 track) | fast |
| 55–74 s | break, no lasers | – |
| 74–144 s | gaps shrinking from 4 s to 2 s | 30% slow / 70% fast |
| 146 s → 160.5 s | final non-stop chain, ending exactly 4.5 s before the end | 15% slow / 85% fast |

- Max 4 beams at any time.
- Hosts tick rooms at `ROOM_TICK_HZ = max(TICK_HZ, SNAP_HZ)`, so snapshots go out at `SNAP_HZ` (30 Hz).
- Bots time each jump from the beam's own speed. Their lead is clamped into the physical clear window for that beam.

## For GAME: using the Session

```js
import { createRoom, joinRoom, detectMode, inviteLink, inviteCode } from './net/session.js';
const session = await createRoom({ name, mode });   // 'solo' | 'server' | 'p2p' | undefined (auto)
session.on('welcome', ...); session.on('snap', ...); session.on('close', ({ reason }) => ...);
```
- **Buffering:** all room messages, `welcome` included, are held until the first `session.on(...)`, then delivered on the next macrotask. Register handlers synchronously right after the `await`. `session.welcome` also holds the welcome message.
- `session.you / code / mode / hostId / isHost / ping / now()`. `'close'` `{reason}` fires once when the room ends for you, but not when you call `session.close()` yourself. `'error'` `{msg}` is non-fatal; today it only fires when a P2P host loses the signalling server, meaning new players can't join for a while.
- Join errors (exact strings): `Room not found — check the code`, `Room is full`, `Room codes are 5 letters/numbers — check the code`, `Can't reach the game server`, `Can't reach the P2P server — check your internet connection`.
- `welcome.players[]` = `{id,name,color,score,bot,x,y,z,ry,a,immune,fear}`. `immune` and `fear` are room-ms "until" values (0 = none). `phaseEnd` is 0 in lobby. `ranking` is included if you join during results. `lasers` = beams already announced and still alive.
- `spawn {id,x,z,ry}` is sent to you on join and at every countdown. `snap` rows are `[id,x,y,z,ry,a]`, 2 decimals, 20 Hz in all phases, bots included. Colors are `'#rrggbb'`.
- `score` is only sent when the score changes. A laser claim at 0 points sends nothing but still counts the beam as hit. Pickups are validated against your last `st` position (2.2 m), so keep sending `st`.
- FYI: the built client requests `/sfx/sfx/jump.mp3` and `/sfx/sfx/land.mp3`, and both return 404 (doubled `sfx/` path).

## How to run

- `npm run dev`: one port (47820) serves the client, `/ws` and Vite HMR. LAN URLs are printed.
- `npm run build && npm start`: serves `dist/` (correct MIME types, SPA fallback, immutable `assets/`).
- Server env vars: `PORT` (default 47820), `HOST` (default all interfaces), `TIME_SCALE` (tests only; speeds up the room clock).
- Solo and P2P need only static hosting (GitHub Pages works). P2P host peer id is `shugojj-v1-<CODE>`.
- `npm test`: unit tests (schedule, room, bots); server integration (real process on an OS-assigned free 127.0.0.1 port, 3 ws clients play a TIME_SCALE=20 round to results, plus a `--dev` check); browser tests (Playwright Chromium + `test/harness` via Vite: solo, server and P2P with two contexts). The P2P test skips itself, and says why, if `0.peerjs.com` is unreachable.

## Known gaps / risks

- **Node 24 + `node --test test/`:** Node treats `test/` as a module path. `test/index.js` is a directory entry that imports every `*.test.js`, so the current script works. Lead: `node --test "test/*.test.js"` also works and runs each file in its own process.
- P2P depends on the PeerJS cloud (signalling and TURN). There is no self-hosted PeerServer option. The room dies with the host (no host migration in P2P). Joiners notice within about 0–8 s, depending on whether the host tab's `pagehide` ran.
- Light anti-cheat by design: movement is client-authoritative, and hit claims are checked against beam timing, not beam position.
- Bots take laser hits on about 25–30% of their beam crossings: a 20% misjudge rate plus crosses and squares that catch them mid-landing. Tune with `BOT_JUMP_FAIL` and `BOT_JUMP_LEAD_S`.
