// Transport-agnostic game room (runs on the Node server and inside the P2P host's / solo browser).
// Pure ESM, no Node/DOM APIs: time (`now`), randomness (`rng`) and delivery (`send`) are injected.
import {
  BOMB_AIM_JITTER,
  BOMB_CENTER_LIMIT,
  BOMB_FUSE_MS,
  BOMB_RADIUS,
  BOMB_SPACING,
  BOMB_STAGGER_MS,
  BOMB_WAVES,
  COUNTDOWN_MS,
  FEAR_MS,
  FEAR_WANDER_DEG,
  GREEN_LIFETIME_MS,
  GREEN_MAX_ALIVE,
  GREEN_OPENING,
  GREEN_SPAWN_JITTER_MS,
  GREEN_SPAWN_MS,
  HIT_TIME_TOLERANCE_MS,
  IMMUNITY_MS,
  LASER_ANNOUNCE_MARGIN_MS,
  LASER_LEAD_MS,
  LASER_PENALTY,
  MAX_PLAYERS,
  MAX_ST_Y,
  NAME_MAX_LEN,
  ORB_MIN_SPACING,
  ORB_POINTS,
  ORB_SPAWN_LIMIT,
  OVERTIME_MS,
  GREEN_AIR_CHANCE,
  ORB_Y,
  ORB_Y_AIR,
  PICKUP_TOLERANCE,
  PINK_LIFETIME_MS,
  PINK_MIN_SPACING,
  PINK_WAVES,
  PLAY_LIMIT,
  PROTOCOL_VERSION,
  RESULTS_MS,
  ROUND_MS,
  SCORE_MIN,
  SNAP_HZ,
  SPAWN_RING_RADIUS,
  TICK_HZ,
  YELLOW_LIFETIME_AFTER_BOOM_MS,
  YELLOW_PER_BOMB,
  YELLOW_RING_RADIUS,
} from './config.js';
import { beamTimes, laserHitTest } from './lasers.js';
import { canTouchOrb } from './pickup.js';
import { buildLaserSchedule } from './schedule.js';
import { createRng } from './rng.js';
import { ANIM, C2R, PHASE, R2C } from './protocol.js';
import { BOT_NAMES, createBrain, stepBot } from './bots.js';

/** Rate at which hosts must call room.tick(): snapshots go out from ticks, so never below SNAP_HZ. */
export const ROOM_TICK_HZ = Math.max(TICK_HZ, SNAP_HZ);

/** Robe colors, assigned in order (first free one). */
export const PLAYER_COLORS = [
  '#e8544e', '#3d8be8', '#f2b233', '#3fb67b', '#9a5ad6', '#f17bbf',
  '#25bfc4', '#f08a3c', '#7d8cff', '#9ccc3d', '#a8745a', '#5f7388',
];

const TAU = Math.PI * 2;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

export function cleanName(name, fallback) {
  if (typeof name !== 'string') return fallback;
  const s = name.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LEN).trim();
  return s || fallback;
}

export const PEAK_Y_MS = 500; // how long a jump's peak height counts for pickup validation

export class Room {
  /**
   * @param {{code:string, now:() => number, rng?:ReturnType<typeof createRng>,
   *   send:(playerId:string, msg:object) => void, onEmpty?:() => void}} opts
   * `send` may receive the same message object for several players (serialize, don't mutate).
   */
  constructor({ code, now, rng, send, onEmpty }) {
    this.code = code;
    this._now = now;
    this.rng = rng || createRng();
    this._send = send;
    this.onEmpty = onEmpty;

    this.players = new Map(); // insertion order = join order
    this.hostId = null;
    this.nextId = 1; // orbs, bombs and beams share one id counter (unique for the room's lifetime)
    this.guestNo = 0;
    this.botNo = 0;

    const t = this.time();
    this.phase = PHASE.LOBBY;
    this.phaseStart = t;
    this.phaseEnd = 0;
    this.roundStart = 0;

    this.orbs = new Map();
    this.bombs = new Map();
    this.schedule = [];
    this.beamsById = new Map();
    this.laserIdx = 0;
    this.liveBeams = []; // announced and not gone: {b, gone}
    this.ev = null; // per-round spawn bookkeeping

    this.lastTick = t;
    this.lastSnap = -Infinity;
  }

  time() {
    return Math.round(this._now());
  }

  get humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  // ---------------------------------------------------------------- membership

  /** Adds a human. Sends `welcome` + `spawn` to them and `roster` to all. Returns false (and sends `err`) if full. */
  addPlayer(id, name) {
    if (this.players.has(id)) return false;
    if (this.players.size >= MAX_PLAYERS) {
      this._send(id, { t: R2C.ERR, msg: 'Room is full' });
      return false;
    }
    const p = this._newPlayer(id, cleanName(name, `Player ${++this.guestNo}`), false);
    if (!this.hostId) this.hostId = id;
    this._send(id, this._welcome(id));
    this._send(id, { t: R2C.SPAWN, id, x: p.x, z: p.z, ry: p.ry });
    this._broadcastRoster();
    return true;
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    if (this.hostId === id) {
      this.hostId = null;
      for (const p of this.players.values()) {
        if (!p.bot) {
          this.hostId = p.id;
          break;
        }
      }
    }
    if (!this.hostId) {
      this.onEmpty?.();
      return;
    }
    this._broadcastRoster();
  }

  _newPlayer(id, name, bot) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? this.rng.pick(PLAYER_COLORS);
    const ang = this.rng.range(0, TAU);
    const x = r2(Math.cos(ang) * SPAWN_RING_RADIUS);
    const z = r2(Math.sin(ang) * SPAWN_RING_RADIUS);
    const p = {
      id, name, color, bot, score: 0,
      x, y: 0, z, ry: r2(Math.atan2(-x, -z)), a: ANIM.IDLE,
      immuneUntil: 0, fearUntil: 0, fearDx: 0, fearDz: 0,
      peakY: 0, peakYAt: 0, // highest recent feet height: air-balloon claims arrive after the jump's apex
      hitBeams: new Set(),
      brain: bot ? createBrain(this.rng) : null,
    };
    this.players.set(id, p);
    return p;
  }

  _addBot(byId) {
    if (this.players.size >= MAX_PLAYERS) {
      this._send(byId, { t: R2C.ERR, msg: 'Room is full' });
      return;
    }
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.botNo + 1}`;
    this._newPlayer(`b${++this.botNo}`, name, true);
    this._broadcastRoster();
  }

  _removeBot() {
    const bots = [...this.players.values()].filter((p) => p.bot);
    if (!bots.length) return;
    this.players.delete(bots[bots.length - 1].id);
    this._broadcastRoster();
  }

  // ---------------------------------------------------------------- client messages

  handle(id, msg) {
    const p = this.players.get(id);
    if (!p || p.bot || !msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case C2R.PING:
        if (isNum(msg.c)) this._send(id, { t: R2C.PONG, c: msg.c, s: this.time() });
        break;
      case C2R.ST:
        this._onState(p, msg);
        break;
      case C2R.PICKUP:
        this._claimOrb(p, msg.id, false);
        break;
      case C2R.HIT:
        this._laserHit(p, msg.id, false);
        break;
      case C2R.START:
        if (id === this.hostId && (this.phase === PHASE.LOBBY || this.phase === PHASE.RESULTS)) this._startCountdown();
        break;
      case C2R.NAME:
        if (this.phase === PHASE.LOBBY || this.phase === PHASE.RESULTS) {
          const name = cleanName(msg.name, p.name);
          if (name !== p.name) {
            p.name = name;
            this._broadcastRoster();
          }
        }
        break;
      case C2R.BOT:
        if (id !== this.hostId) break;
        if (msg.add === true) this._addBot(id);
        else if (msg.add === false) this._removeBot();
        break;
      default: // hello (transport-level) and unknown types are ignored
    }
  }

  _onState(p, { x, y, z, ry, a }) {
    if (!isNum(x) || !isNum(y) || !isNum(z) || !isNum(ry)) return;
    p.x = clamp(x, -PLAY_LIMIT, PLAY_LIMIT);
    p.z = clamp(z, -PLAY_LIMIT, PLAY_LIMIT);
    p.y = clamp(y, 0, MAX_ST_Y);
    p.ry = wrapAngle(ry);
    p.a = Number.isInteger(a) && a >= ANIM.IDLE && a <= ANIM.FEARED ? a : ANIM.IDLE;
    p.stAt = this.time(); // when this state arrived; sent as the snapshot row's sample time
    if (p.y >= p.peakY || p.stAt - p.peakYAt > PEAK_Y_MS) [p.peakY, p.peakYAt] = [p.y, p.stAt];
  }

  /** `exact`: the room checked the touch itself (bots); otherwise allow latency slack around the last known state. */
  _claimOrb(p, id, exact) {
    if (this.phase !== PHASE.PLAYING) return false;
    const o = this.orbs.get(id);
    const now = this.time();
    if (!o || now < o.at || now >= o.exp) return false;
    const touch = exact
      ? canTouchOrb(o, p.x, p.z, p.y)
      : canTouchOrb(o, p.x, p.z, now - p.peakYAt <= PEAK_Y_MS ? Math.max(p.y, p.peakY) : p.y, PICKUP_TOLERANCE, 0.35);
    if (!touch) return false;
    this.orbs.delete(id);
    const pts = ORB_POINTS[o.k];
    this._broadcast({ t: R2C.ORB_GONE, id, by: p.id, pts });
    this._addScore(p, pts, 'orb', o.k);
    if (o.k === 'pink') {
      p.immuneUntil = now + IMMUNITY_MS;
      this._broadcast({ t: R2C.IMMUNE, id: p.id, until: p.immuneUntil });
    }
    return true;
  }

  /** `exact`: the room detected the hit itself (bots), so skip the time-tolerance check. */
  _laserHit(p, beamId, exact) {
    if (this.phase !== PHASE.PLAYING) return false;
    const b = this.beamsById.get(beamId);
    const now = this.time();
    if (!b || now < p.immuneUntil || p.hitBeams.has(b.id)) return false;
    if (!exact && (b.t0 > now + HIT_TIME_TOLERANCE_MS || beamTimes(b).tGone < now - HIT_TIME_TOLERANCE_MS)) return false;
    p.hitBeams.add(b.id);
    this._addScore(p, LASER_PENALTY, 'laser');
    return true;
  }

  _addScore(p, delta, why, k) {
    const score = Math.max(SCORE_MIN, p.score + delta);
    const d = score - p.score;
    if (!d) return;
    p.score = score;
    const msg = { t: R2C.SCORE, id: p.id, score, d, why };
    if (k) msg.k = k;
    this._broadcast(msg);
  }

  // ---------------------------------------------------------------- simulation

  tick() {
    const now = this.time();
    const dt = clamp(now - this.lastTick, 0, 250);
    this.lastTick = now;

    this._advancePhase(now);
    if (this.phase === PHASE.COUNTDOWN || this.phase === PHASE.PLAYING) this._announceLasers(now);
    if (this.phase === PHASE.PLAYING) {
      this._roundEvents(now);
      for (const b of this.bombs.values()) if (now >= b.boomAt) this._boom(b, now);
      for (const o of this.orbs.values()) {
        if (now >= o.exp) {
          this.orbs.delete(o.id);
          this._broadcast({ t: R2C.ORB_GONE, id: o.id });
        }
      }
    }
    if (dt > 0) this._stepBots(now, dt);
    if (this.liveBeams.length) this.liveBeams = this.liveBeams.filter((e) => e.gone > now);

    if (now - this.lastSnap >= 750 / SNAP_HZ) { // 3/4 period: tick jitter never halves the rate
      this.lastSnap = now;
      const rows = [];
      // row[6] = sample time of that row (state arrival for humans, this tick for bots) so clients interpolate exactly
      for (const q of this.players.values()) rows.push([q.id, r2(q.x), r2(q.y), r2(q.z), r2(q.ry), q.a, Math.round(q.bot ? now : q.stAt ?? now)]);
      this._broadcast({ t: R2C.SNAP, s: now, p: rows });
    }
  }

  _advancePhase(now) {
    for (;;) {
      if (this.phase === PHASE.COUNTDOWN && now >= this.phaseEnd) {
        this._setPhase(PHASE.PLAYING, this.roundStart, this.roundStart + ROUND_MS + OVERTIME_MS);
      } else if (this.phase === PHASE.PLAYING && now >= this.phaseEnd) {
        this._endRound();
      } else if (this.phase === PHASE.RESULTS && now >= this.phaseEnd) {
        this._setPhase(PHASE.LOBBY, this.phaseEnd, 0);
      } else return;
    }
  }

  _setPhase(phase, start, end) {
    this.phase = phase;
    this.phaseStart = start;
    this.phaseEnd = end;
    this._broadcast({ t: R2C.PHASE, phase, phaseStart: start, phaseEnd: end, roundStart: this.roundStart });
  }

  _startCountdown() {
    const now = this.time();
    this.roundStart = now + COUNTDOWN_MS;
    this.schedule = buildLaserSchedule(this.rng.fork(), this.roundStart);
    this.beamsById.clear();
    for (const b of this.schedule) {
      b.id = this.nextId++;
      this.beamsById.set(b.id, b);
    }
    this.laserIdx = 0;
    this.liveBeams = [];
    this.orbs.clear();
    this.bombs.clear();
    this.ev = {
      opening: false,
      nextGreen: GREEN_OPENING.atMs + this._greenInterval(),
      pink: 0,
      bombs: BOMB_WAVES.flatMap((w, wave) =>
        Array.from({ length: w.count }, (_, i) => ({ at: w.atMs + i * BOMB_STAGGER_MS, wave })),
      ).sort((a, b) => a.at - b.at),
      bombIdx: 0,
      wavePos: BOMB_WAVES.map(() => []),
    };

    const list = [...this.players.values()];
    const base = this.rng.range(0, TAU);
    list.forEach((p, i) => {
      const ang = base + (i * TAU) / list.length;
      p.score = 0;
      p.immuneUntil = 0;
      p.fearUntil = 0;
      p.hitBeams.clear();
      p.x = r2(Math.cos(ang) * SPAWN_RING_RADIUS);
      p.z = r2(Math.sin(ang) * SPAWN_RING_RADIUS);
      p.y = 0;
      p.ry = r2(Math.atan2(-p.x, -p.z)); // face the center
      p.a = ANIM.IDLE;
      if (p.brain) p.brain = createBrain(this.rng);
    });

    this._setPhase(PHASE.COUNTDOWN, now, this.roundStart);
    this._broadcastRoster();
    for (const p of list) if (!p.bot) this._send(p.id, { t: R2C.SPAWN, id: p.id, x: p.x, z: p.z, ry: p.ry });
  }

  _endRound() {
    const end = this.phaseEnd;
    for (const id of this.orbs.keys()) this._broadcast({ t: R2C.ORB_GONE, id });
    this.orbs.clear();
    this.bombs.clear();
    this._setPhase(PHASE.RESULTS, end, end + RESULTS_MS);
    this._broadcast({ t: R2C.RESULTS, ranking: this.ranking() });
  }

  /** Sorted by score; ties share a rank (1, 1, 3). */
  ranking() {
    const list = [...this.players.values()];
    const order = new Map(list.map((p, i) => [p.id, i]));
    list.sort((a, b) => b.score - a.score || order.get(a.id) - order.get(b.id));
    let rank = 0;
    return list.map((p, i) => {
      if (i === 0 || p.score !== list[i - 1].score) rank = i + 1;
      return { id: p.id, name: p.name, score: p.score, rank };
    });
  }

  _announceLasers(now) {
    while (this.laserIdx < this.schedule.length) {
      const b = this.schedule[this.laserIdx];
      if (b.t0 - now > LASER_LEAD_MS + LASER_ANNOUNCE_MARGIN_MS) break;
      this.laserIdx++;
      this.liveBeams.push({ b, gone: beamTimes(b).tGone });
      this._broadcast({ t: R2C.LASER, l: b });
    }
  }

  _greenInterval() {
    return GREEN_SPAWN_MS + this.rng.range(-1, 1) * GREEN_SPAWN_JITTER_MS;
  }

  _roundEvents(now) {
    const rt = now - this.roundStart;
    if (rt >= ROUND_MS) return; // nothing new spawns after 00:00
    const ev = this.ev;
    if (!ev.opening && rt >= GREEN_OPENING.atMs) {
      ev.opening = true;
      for (let i = 0; i < GREEN_OPENING.count; i++) {
        const s = this._freeSpot(ORB_MIN_SPACING, { radius: GREEN_OPENING.spread });
        this._spawnOrb('green', s.x, s.z, now, GREEN_LIFETIME_MS);
      }
    }
    if (ev.opening && rt >= ev.nextGreen) {
      let alive = 0;
      for (const o of this.orbs.values()) if (o.k === 'green') alive++;
      if (alive < GREEN_MAX_ALIVE) {
        const s = this._freeSpot(ORB_MIN_SPACING);
        this._spawnOrb('green', s.x, s.z, now, GREEN_LIFETIME_MS);
      }
      ev.nextGreen = rt + this._greenInterval();
    }
    while (ev.pink < PINK_WAVES.length && rt >= PINK_WAVES[ev.pink].atMs) {
      for (let i = 0; i < PINK_WAVES[ev.pink].count; i++) {
        const s = this._freeSpot(PINK_MIN_SPACING, { kind: 'pink' });
        this._spawnOrb('pink', s.x, s.z, now, PINK_LIFETIME_MS);
      }
      ev.pink++;
    }
    while (ev.bombIdx < ev.bombs.length && rt >= ev.bombs[ev.bombIdx].at) {
      this._spawnBomb(ev.bombs[ev.bombIdx++].wave, now);
    }
  }

  /** Random balloon spot (in a disc of `radius` around the center, else anywhere), away from other balloons. */
  _freeSpot(spacing, { radius, kind } = {}) {
    const L = ORB_SPAWN_LIMIT;
    let best = null;
    let bestD = -1;
    for (let i = 0; i < 20; i++) {
      let x = this.rng.range(-L, L);
      let z = this.rng.range(-L, L);
      if (radius) {
        const a = this.rng.range(0, TAU);
        const r = radius * Math.sqrt(this.rng.next());
        x = clamp(Math.cos(a) * r, -L, L);
        z = clamp(Math.sin(a) * r, -L, L);
      }
      let d = Infinity;
      for (const o of this.orbs.values()) if (!kind || o.k === kind) d = Math.min(d, Math.hypot(o.x - x, o.z - z));
      if (d >= spacing) return { x, z };
      if (d > bestD) [best, bestD] = [{ x, z }, d];
    }
    return best;
  }

  _spawnOrb(k, x, z, now, life, bombId) {
    // pinks always float up high, greens sometimes, yellows never: air balloons need a jump to touch
    const air = k === 'pink' || (k === 'green' && this.rng.chance(GREEN_AIR_CHANCE));
    const o = { id: this.nextId++, k, x: r2(x), y: air ? ORB_Y_AIR : ORB_Y, z: r2(z), at: now, exp: Math.round(now + life) };
    if (bombId) o.bomb = bombId;
    this.orbs.set(o.id, o);
    this._broadcast({ t: R2C.ORB, ...o });
    return o;
  }

  _spawnBomb(wave, now) {
    const placed = this.ev.wavePos[wave];
    const pos = this._bombSpot(placed);
    placed.push(pos);
    const b = { id: this.nextId++, x: r2(pos.x), z: r2(pos.z), at: now, boomAt: now + BOMB_FUSE_MS };
    this.bombs.set(b.id, b);
    this._broadcast({ t: R2C.BOMB, ...b });
    const base = this.rng.range(0, TAU);
    for (let i = 0; i < YELLOW_PER_BOMB; i++) {
      const a = base + (i * TAU) / YELLOW_PER_BOMB;
      const x = clamp(b.x + Math.cos(a) * YELLOW_RING_RADIUS, -ORB_SPAWN_LIMIT, ORB_SPAWN_LIMIT);
      const z = clamp(b.z + Math.sin(a) * YELLOW_RING_RADIUS, -ORB_SPAWN_LIMIT, ORB_SPAWN_LIMIT);
      this._spawnOrb('yellow', x, z, now, b.boomAt + YELLOW_LIFETIME_AFTER_BOOM_MS - now, b.id);
    }
  }

  /** First bomb of a wave near the players' centroid; later ones BOMB_SPACING away from an earlier one. */
  _bombSpot(placed) {
    const L = BOMB_CENTER_LIMIT;
    if (!placed.length) {
      let cx = 0;
      let cz = 0;
      for (const p of this.players.values()) {
        cx += p.x / this.players.size;
        cz += p.z / this.players.size;
      }
      const j = BOMB_AIM_JITTER;
      return { x: clamp(cx + this.rng.range(-j, j), -L, L), z: clamp(cz + this.rng.range(-j, j), -L, L) };
    }
    let best = null;
    let bestD = -1;
    for (let i = 0; i < 24; i++) {
      const ref = this.rng.pick(placed);
      const a = this.rng.range(0, TAU);
      const r = this.rng.range(BOMB_SPACING[0], BOMB_SPACING[1]);
      const x = clamp(ref.x + Math.cos(a) * r, -L, L);
      const z = clamp(ref.z + Math.sin(a) * r, -L, L);
      const d = Math.min(...placed.map((q) => Math.hypot(q.x - x, q.z - z)));
      if (d >= BOMB_SPACING[0]) return { x, z };
      if (d > bestD) [best, bestD] = [{ x, z }, d];
    }
    return best;
  }

  _boom(b, now) {
    this.bombs.delete(b.id);
    const feared = [];
    const wander = (FEAR_WANDER_DEG * Math.PI) / 180;
    for (const p of this.players.values()) {
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > BOMB_RADIUS) continue;
      const a = (d > 0.01 ? Math.atan2(dz, dx) : this.rng.range(0, TAU)) + this.rng.range(-wander, wander);
      p.fearUntil = now + FEAR_MS;
      p.fearDx = Math.cos(a);
      p.fearDz = Math.sin(a);
      feared.push({ id: p.id, dx: r3(p.fearDx), dz: r3(p.fearDz), until: p.fearUntil });
    }
    this._broadcast({ t: R2C.BOOM, id: b.id, x: b.x, z: b.z, feared });
  }

  _stepBots(now, dt) {
    const world = { now, phase: this.phase, orbs: this.orbs, bombs: this.bombs, beams: this.liveBeams.map((e) => e.b) };
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      const px = p.x;
      const pz = p.z;
      stepBot(p, world, dt, this.rng);
      if (this.phase !== PHASE.PLAYING) continue;
      for (const o of this.orbs.values()) {
        if (canTouchOrb(o, p.x, p.z, p.y)) this._claimOrb(p, o.id, true);
      }
      if (now < p.immuneUntil) continue;
      for (const b of world.beams) {
        if (!p.hitBeams.has(b.id) && laserHitTest(b, now - dt, px, pz, now, p.x, p.z, p.y)) this._laserHit(p, b.id, true);
      }
    }
  }

  // ---------------------------------------------------------------- outgoing

  _broadcast(msg) {
    for (const p of this.players.values()) if (!p.bot) this._send(p.id, msg);
  }

  _rosterEntry(p) {
    return { id: p.id, name: p.name, color: p.color, score: p.score, bot: p.bot };
  }

  _broadcastRoster() {
    this._broadcast({ t: R2C.ROSTER, players: [...this.players.values()].map((p) => this._rosterEntry(p)), hostId: this.hostId });
  }

  _welcome(id) {
    const msg = {
      t: R2C.WELCOME,
      v: PROTOCOL_VERSION,
      you: id,
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      phaseStart: this.phaseStart,
      phaseEnd: this.phaseEnd,
      roundStart: this.roundStart,
      players: [...this.players.values()].map((p) => ({
        ...this._rosterEntry(p),
        x: r2(p.x), y: r2(p.y), z: r2(p.z), ry: r2(p.ry), a: p.a,
        immune: p.immuneUntil, fear: p.fearUntil,
      })),
      orbs: [...this.orbs.values()],
      bombs: [...this.bombs.values()],
      lasers: this.liveBeams.map((e) => e.b),
      now: this.time(),
    };
    if (this.phase === PHASE.RESULTS) msg.ranking = this.ranking();
    return msg;
  }
}
