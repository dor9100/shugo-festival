// TEMPORARY in-browser fake of the Session API (SPEC "Session API") used until NET's client/src/net/session.js
// exists. Runs a compressed scripted round (default 45 s on the clock; ?fakeRound=<s>) with greens, pinks,
// line / cross / lines / square lasers, one bomb with 3 yellows + fear, simple bots, and validates claims.
import {
  BOMB_FUSE_MS, BOMB_RADIUS, COUNTDOWN_MS, FEAR_MS, FEAR_WANDER_DEG, GREEN_LIFETIME_MS, GREEN_MAX_ALIVE,
  GREEN_OPENING, IMMUNITY_MS, JUMP_VELOCITY, GRAVITY, LASER_LEAD_MS, LASER_PENALTY, MOVE_SPEED, ORB_POINTS,
  OVERTIME_MS, PICKUP_RADIUS, PICKUP_TOLERANCE, PINK_LIFETIME_MS, PLAY_LIMIT, RESULTS_MS, ROOM_CODE_ALPHABET,
  ROOM_CODE_LEN, ROUND_MS, SCORE_MIN, SNAP_HZ, YELLOW_LIFETIME_AFTER_BOOM_MS, YELLOW_PER_BOMB, YELLOW_RING_RADIUS,
  ARENA_HALF,
} from '@shared/config.js';
import { beamState, beamTimes, laserHitTest } from '@shared/lasers.js';

const COLORS = ['#e2574c', '#3d8bfd', '#f4a524', '#8e5cf7', '#22c3a0', '#ff6fb5', '#7cc43a', '#d9d9d9'];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const H = ARENA_HALF;

export async function detectMode() {
  return 'p2p';
}
export async function createRoom({ name, mode }) {
  await delay(120);
  return new FakeSession({ name, host: true, mode: mode === 'solo' ? 'solo' : mode || 'p2p' });
}
export async function joinRoom({ code, name, mode }) {
  await delay(200);
  const c = String(code || '').trim().toUpperCase();
  if (c.length !== ROOM_CODE_LEN || [...c].some((ch) => !ROOM_CODE_ALPHABET.includes(ch)))
    throw new Error(`Room codes are ${ROOM_CODE_LEN} letters/digits.`);
  if (c === 'ZZZZZ') throw new Error(`Room ${c} not found.`);
  return new FakeSession({ name, host: false, code: c, mode: mode || 'p2p' });
}

function code5() {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  return s;
}

class FakeSession {
  constructor({ name, host, code, mode }) {
    const q = new URLSearchParams(location.search);
    this.roundLen = (Number(q.get('fakeRound')) || 45) * 1000;
    this.resultsLen = Number(q.get('fakeResults')) * 1000 || RESULTS_MS;
    this.mode = mode;
    this.code = mode === 'solo' ? 'SOLO' : code || code5();
    this.you = 'p1';
    this._t0 = performance.now() - 100000;
    this._h = new Map();
    this._seq = 0;
    this.hostId = host ? 'p1' : 'h0';
    this.players = new Map();
    this.players.set('p1', { id: 'p1', name: name || 'Player', color: COLORS[0], score: 0, bot: false });
    this.sim = new Map(); // id -> {x,y,z,vy,ry,a,tx,tz,fear}
    this.me = { x: 0, y: 0, z: 0 };
    if (!host) this._addSim({ id: 'h0', name: 'HostFriend', bot: false });
    this.phase = 'lobby';
    this.phaseStart = this.now();
    this.phaseEnd = 0;
    this.roundStart = 0;
    this.orbs = new Map();
    this.bombs = new Map();
    this.lasers = [];
    this.timeline = [];
    this.hits = new Set();
    this.immune = new Map();
    this.welcome = {
      t: 'welcome', you: this.you, code: this.code, hostId: this.hostId, phase: this.phase, phaseStart: this.phaseStart,
      phaseEnd: this.phaseEnd, roundStart: this.roundStart, players: [...this.players.values()], orbs: [], bombs: [], lasers: [], now: this.now(),
    };
    this._lastSnap = 0;
    this._lastTick = this.now();
    this._timer = setInterval(() => this._tick(), 1000 / SNAP_HZ);
    if (!host) setTimeout(() => this._start(), 6000);
  }

  get isHost() {
    return this.hostId === this.you;
  }
  get ping() {
    return this.isHost ? 0 : 38 + Math.round(Math.random() * 6);
  }
  now() {
    return performance.now() - this._t0;
  }
  on(t, fn) {
    if (!this._h.has(t)) this._h.set(t, new Set());
    this._h.get(t).add(fn);
  }
  off(t, fn) {
    this._h.get(t)?.delete(fn);
  }
  _emit(msg, lag = 12) {
    setTimeout(() => {
      if (this._closed) return;
      for (const fn of this._h.get(msg.t) || []) fn(msg);
    }, lag);
  }
  close() {
    this._closed = true;
    clearInterval(this._timer);
  }

  // ---------------------------------------------------------------- client -> room
  send(m) {
    if (this._closed) return;
    const p1 = this.players.get('p1');
    switch (m.t) {
      case 'st':
        Object.assign(this.me, { x: m.x, y: m.y, z: m.z, ry: m.ry, a: m.a });
        break;
      case 'start':
        if (!this.isHost) return this._emit({ t: 'err', msg: 'Only the host can start.' });
        if (this.phase === 'lobby' || this.phase === 'results') this._start();
        break;
      case 'bot':
        if (!this.isHost) return;
        if (m.add) {
          const n = [...this.players.values()].filter((p) => p.bot).length;
          if (this.players.size >= 8) return this._emit({ t: 'err', msg: 'Room is full.' });
          this._addSim({ id: `b${++this._seq}`, name: ['Pip', 'Mochi', 'Tofu', 'Bean', 'Nori', 'Yuzu'][n % 6] + ' (bot)', bot: true });
        } else {
          const b = [...this.players.values()].reverse().find((p) => p.bot);
          if (b) {
            this.players.delete(b.id);
            this.sim.delete(b.id);
          }
        }
        this._roster();
        break;
      case 'pickup': {
        const o = this.orbs.get(m.id);
        if (o && Math.hypot(o.x - this.me.x, o.z - this.me.z) <= PICKUP_RADIUS + PICKUP_TOLERANCE) this._take(o, 'p1');
        break;
      }
      case 'hit': {
        const b = this.lasers.find((l) => l.id === m.id);
        const key = `p1:${m.id}`;
        if (!b || this.hits.has(key) || (this.immune.get('p1') || 0) > this.now()) return;
        this.hits.add(key);
        this._score(p1, LASER_PENALTY, 'laser');
        break;
      }
      case 'name':
        p1.name = String(m.name).slice(0, 16);
        this._roster();
        break;
      default:
    }
  }

  // ---------------------------------------------------------------- room internals
  _addSim(p) {
    const color = COLORS[this.players.size % COLORS.length];
    this.players.set(p.id, { id: p.id, name: p.name, color, score: 0, bot: !!p.bot });
    this.sim.set(p.id, { x: rnd(-4, 4), y: 0, z: rnd(-4, 4), vy: 0, ry: 0, a: 0, tx: 0, tz: 0, fear: null, wander: 0 });
    this._roster();
  }
  _roster() {
    this._emit({ t: 'roster', hostId: this.hostId, players: [...this.players.values()] });
  }
  _phase(phase, dur, roundStart = this.roundStart) {
    this.phase = phase;
    this.phaseStart = this.now();
    this.phaseEnd = dur ? this.phaseStart + dur : 0;
    this.roundStart = roundStart;
    this._emit({ t: 'phase', phase, phaseStart: this.phaseStart, phaseEnd: this.phaseEnd, roundStart });
  }
  _start() {
    const now = this.now();
    this.orbs.clear();
    this.bombs.clear();
    this.lasers = [];
    this.hits.clear();
    this.immune.clear();
    for (const p of this.players.values()) p.score = 0;
    this._roster();
    const playStart = now + COUNTDOWN_MS;
    // The fake round is compressed: shift roundStart so the HUD clock reads `roundLen` at the start.
    this._phase('countdown', COUNTDOWN_MS, playStart - (ROUND_MS - this.roundLen));
    this.playStart = playStart;
    let i = 0;
    for (const p of this.players.values()) {
      const a = (i++ / this.players.size) * Math.PI * 2;
      const x = Math.round(Math.sin(a) * 3 * 10) / 10;
      const z = Math.round(-Math.cos(a) * 3 * 10) / 10;
      this._emit({ t: 'spawn', id: p.id, x, z });
      const s = this.sim.get(p.id);
      if (s) Object.assign(s, { x, z, y: 0 });
    }
    const P = playStart;
    const T = [];
    T.push({ at: P + GREEN_OPENING.atMs, fn: () => this._opening() });
    const beam = (rel, ax, from, to) => T.push({ at: P + rel - LASER_LEAD_MS, fn: () => this._laser({ id: `L${++this._seq}`, ax, from, to, t0: P + rel }) });
    beam(4000, 'z', -H, H); // tutorial line from the camera side
    beam(12000, 'x', -H, H); // cross
    beam(12000, 'z', H, -H);
    beam(19000, 'x', -H, H); // two lines crossing
    beam(19000, 'x', H, -H);
    for (const [ax, f, t] of [['x', -H, H], ['x', H, -H], ['z', -H, H], ['z', H, -H]]) beam(29000, ax, f, t); // square
    beam(36000, 'z', H, -H);
    T.push({ at: P + 8000, fn: () => this._pinks(2) });
    T.push({ at: P + 22000, fn: () => this._bomb() });
    T.push({ at: P, fn: () => this._phase('playing', this.roundLen + OVERTIME_MS, this.roundStart) });
    T.push({ at: P + this.roundLen + OVERTIME_MS, fn: () => this._results() });
    this.timeline = T.sort((a, b) => a.at - b.at);
    this.nextGreen = P + GREEN_OPENING.atMs + 3500;
  }
  _results() {
    this.orbs.clear();
    this.bombs.clear();
    const list = [...this.players.values()].sort((a, b) => b.score - a.score);
    let prev = null;
    let rank = 0;
    const ranking = list.map((p, i) => {
      if (p.score !== prev) rank = i + 1;
      prev = p.score;
      return { id: p.id, name: p.name, score: p.score, rank };
    });
    this._emit({ t: 'results', ranking });
    this._phase('results', this.resultsLen);
    this.timeline = [{ at: this.now() + this.resultsLen, fn: () => this._phase('lobby', 0) }];
  }
  _orb(k, x, z, life, extra = {}) {
    const now = this.now();
    const o = { id: `o${++this._seq}`, k, x: clamp(x, -(PLAY_LIMIT - 0.5), PLAY_LIMIT - 0.5), z: clamp(z, -(PLAY_LIMIT - 0.5), PLAY_LIMIT - 0.5), at: now, exp: now + life, ...extra };
    this.orbs.set(o.id, o);
    this._emit({ t: 'orb', ...o });
    return o;
  }
  _opening() {
    for (let i = 0; i < GREEN_OPENING.count; i++) {
      const a = (i / GREEN_OPENING.count) * Math.PI * 2;
      this._orb('green', Math.sin(a) * GREEN_OPENING.spread * 0.6, Math.cos(a) * GREEN_OPENING.spread * 0.6, GREEN_LIFETIME_MS);
    }
  }
  _pinks(n) {
    for (let i = 0; i < n; i++) this._orb('pink', rnd(-5, 5), rnd(-5, 5), PINK_LIFETIME_MS);
  }
  _bomb() {
    const now = this.now();
    const bx = clamp(this.me.x + rnd(-1, 1), -H + 2, H - 2);
    const bz = clamp(this.me.z + rnd(-1, 1), -H + 2, H - 2);
    const b = { id: `B${++this._seq}`, x: bx, z: bz, at: now, boomAt: now + BOMB_FUSE_MS };
    this.bombs.set(b.id, b);
    this._emit({ t: 'bomb', ...b });
    for (let i = 0; i < YELLOW_PER_BOMB; i++) {
      const a = (i / YELLOW_PER_BOMB) * Math.PI * 2 + 0.4;
      this._orb('yellow', bx + Math.sin(a) * YELLOW_RING_RADIUS, bz + Math.cos(a) * YELLOW_RING_RADIUS, BOMB_FUSE_MS + YELLOW_LIFETIME_AFTER_BOOM_MS, { bomb: b.id });
    }
    this.timeline.push({ at: b.boomAt, fn: () => this._boom(b) });
    this.timeline.sort((x, y) => x.at - y.at);
  }
  _boom(b) {
    const feared = [];
    const now = this.now();
    const check = (id, x, z) => {
      const d = Math.hypot(x - b.x, z - b.z);
      if (d > BOMB_RADIUS) return;
      let ang = d > 0.01 ? Math.atan2(x - b.x, z - b.z) : Math.random() * Math.PI * 2;
      ang += ((Math.random() * 2 - 1) * FEAR_WANDER_DEG * Math.PI) / 180;
      const f = { id, dx: Math.sin(ang), dz: Math.cos(ang), until: now + FEAR_MS };
      feared.push(f);
      const s = this.sim.get(id);
      if (s) s.fear = f;
    };
    check('p1', this.me.x, this.me.z);
    for (const [id, s] of this.sim) check(id, s.x, s.z);
    this.bombs.delete(b.id);
    this._emit({ t: 'boom', id: b.id, x: b.x, z: b.z, feared });
  }
  _laser(l) {
    this.lasers.push(l);
    this._emit({ t: 'laser', l });
  }
  _take(o, by) {
    this.orbs.delete(o.id);
    const p = this.players.get(by);
    const pts = ORB_POINTS[o.k];
    this._emit({ t: 'orbGone', id: o.id, by, pts });
    this._score(p, pts, 'orb', o.k);
    if (o.k === 'pink') {
      const until = this.now() + IMMUNITY_MS;
      this.immune.set(by, until);
      this._emit({ t: 'immune', id: by, until });
    }
  }
  _score(p, d, why, k) {
    const before = p.score;
    p.score = Math.max(SCORE_MIN, p.score + d);
    this._emit({ t: 'score', id: p.id, score: p.score, d: p.score - before, why, k });
  }

  _tick() {
    if (this._closed) return;
    const now = this.now();
    const dt = Math.min(0.1, (now - this._lastTick) / 1000);
    const prevT = this._lastTick;
    this._lastTick = now;
    while (this.timeline.length && this.timeline[0].at <= now) this.timeline.shift().fn();
    if (this.phase === 'playing') {
      for (const [id, o] of this.orbs) {
        if (o.exp <= now) {
          this.orbs.delete(id);
          this._emit({ t: 'orbGone', id });
        }
      }
      const greens = [...this.orbs.values()].filter((o) => o.k === 'green').length;
      if (now >= this.nextGreen && greens < GREEN_MAX_ALIVE && now < this.playStart + this.roundLen) {
        this._orb('green', rnd(-6, 6), rnd(-6, 6), GREEN_LIFETIME_MS);
        this.nextGreen = now + 3500 + rnd(-1000, 1000);
      }
      this.lasers = this.lasers.filter((l) => beamTimes(l).tGone > now - 2000);
    }
    // simple bots: chase the nearest balloon, hop over low beams (sometimes too late)
    for (const [id, s] of this.sim) {
      const px = s.x;
      const pz = s.z;
      let tx = 0;
      let tz = 0;
      if (s.fear && s.fear.until > now) {
        tx = s.fear.dx * MOVE_SPEED;
        tz = s.fear.dz * MOVE_SPEED;
      } else {
        s.fear = null;
        let best = null;
        let bd = 1e9;
        for (const o of this.orbs.values()) {
          const d = Math.hypot(o.x - s.x, o.z - s.z);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        if (best) {
          tx = ((best.x - s.x) / bd) * MOVE_SPEED * 0.75;
          tz = ((best.z - s.z) / bd) * MOVE_SPEED * 0.75;
        } else if (this.phase === 'lobby') {
          s.wander += dt * 0.6;
          tx = Math.cos(s.wander + id.length) * 2;
          tz = Math.sin(s.wander + id.length) * 2;
        }
      }
      s.x = clamp(s.x + tx * dt, -PLAY_LIMIT, PLAY_LIMIT);
      s.z = clamp(s.z + tz * dt, -PLAY_LIMIT, PLAY_LIMIT);
      if (Math.hypot(tx, tz) > 0.3) s.ry = Math.atan2(tx, tz);
      if (s.y <= 0) {
        for (const l of this.lasers) {
          const st = beamState(l, now + 120);
          if (st && Math.abs((l.ax === 'x' ? s.x : s.z) - st.pos) < 0.7 && Math.random() < 0.8) {
            s.vy = JUMP_VELOCITY;
            s.y = 0.001;
            break;
          }
        }
      }
      if (s.y > 0) {
        s.y += s.vy * dt - 0.5 * GRAVITY * dt * dt;
        s.vy -= GRAVITY * dt;
        if (s.y <= 0) s.y = s.vy = 0;
      }
      s.a = s.fear ? 3 : s.y > 0 ? 2 : Math.hypot(tx, tz) > 0.3 ? 1 : 0;
      const p = this.players.get(id);
      if (!p) continue;
      for (const o of [...this.orbs.values()]) if (Math.hypot(o.x - s.x, o.z - s.z) < PICKUP_RADIUS) this._take(o, id);
      for (const l of this.lasers) {
        const key = `${id}:${l.id}`;
        if (!this.hits.has(key) && laserHitTest(l, prevT, px, pz, now, s.x, s.z, s.y) && !((this.immune.get(id) || 0) > now)) {
          this.hits.add(key);
          this._score(p, LASER_PENALTY, 'laser');
        }
      }
    }
    const p = [[this.you, this.me.x, this.me.y, this.me.z, this.me.ry || 0, this.me.a || 0]];
    for (const [id, s] of this.sim) p.push([id, +s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2), +s.ry.toFixed(2), s.a]);
    this._emit({ t: 'snap', s: now, p }, 25);
  }
}
