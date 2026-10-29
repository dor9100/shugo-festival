// Snapshot interpolation for remote players (and bots): render INTERP_DELAY_MS (shared/config.js, read by game.js)
// behind the room clock, extrapolate a little past the newest snapshot when packets are late.
//
// Smoothing: snapshot rows carry the sender's LATEST `st` (sent at CLIENT_SEND_HZ) stamped with the room tick time
// (TICK_HZ), so each position is 0..1/CLIENT_SEND_HZ older than its stamp -> raw interpolation wobbles the speed by
// up to ~±60 %. Horizontal samples therefore go through an alpha-beta (constant-velocity) filter in snapshot time,
// with exact resets when the player stops (repeated sample) or reverses, and on teleport-sized jumps. Measured
// offline on that pipeline: frame-to-frame speed sd 28 % -> 11 %, no extra delay, <= ~3 cm stop overshoot.
// Feet height (y) stays unfiltered so jump arcs are exact. If a row carries a 7th element (per-player sample
// time, room ms), it is used instead of the snapshot stamp and the filter is bypassed.
import { FEEL } from './tuning.js';

const SMOOTH = { alpha: 0.5, beta: 0.2, stopEps: 1e-3, teleport: 2.5 };

const TWO_PI = Math.PI * 2;
function lerpAngle(a, b, k) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return a + d * k;
}

export class RemoteTrack {
  constructor() {
    this.buf = []; // [{t,x,y,z,ry,a}] ascending t
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.ry = 0;
    this.a = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.has = false;
    this.f = null; // alpha-beta state {t, x, z, vx, vz, rx, rz}
  }

  /** Filter a raw horizontal sample (x,z) taken at snapshot time t (ms). */
  _smooth(t, x, z) {
    const f = this.f;
    if (!f || t <= f.t || Math.hypot(x - f.rx, z - f.rz) > SMOOTH.teleport) {
      this.f = { t, x, z, vx: 0, vz: 0, rx: x, rz: z };
      return [x, z];
    }
    const dt = (t - f.t) / 1000;
    const dx = x - f.rx;
    const dz = z - f.rz;
    if (Math.hypot(dx, dz) < SMOOTH.stopEps) {
      // stopped (same sample repeated): exact, no overshoot
      Object.assign(f, { x, z, vx: 0, vz: 0 });
    } else {
      for (const [p, v, d, raw] of [['x', 'vx', dx, x], ['z', 'vz', dz, z]]) {
        if (f[v] !== 0 && Math.sign(d) !== Math.sign(f[v]) && Math.abs(d) > SMOOTH.stopEps) {
          f[p] = raw; // reversed on this axis: restart from the raw sample
          f[v] = d / dt;
        } else {
          const pred = f[p] + f[v] * dt;
          const r = raw - pred;
          f[p] = pred + SMOOTH.alpha * r;
          f[v] += (SMOOTH.beta / dt) * r;
        }
      }
    }
    f.t = t;
    f.rx = x;
    f.rz = z;
    return [f.x, f.z];
  }

  push(t, x, y, z, ry, a, sampleT) {
    const last = this.buf[this.buf.length - 1];
    if (Number.isFinite(sampleT)) t = sampleT; // exact per-player sample time from the room (if provided)
    if (last && t <= last.t) {
      if (t === last.t) Object.assign(last, { x, y, z, ry, a });
      return;
    }
    if (!Number.isFinite(sampleT)) [x, z] = this._smooth(t, x, z);
    this.buf.push({ t, x, y, z, ry, a });
    if (!this.has) {
      Object.assign(this, { x, y, z, ry, a });
      this.has = true;
    }
    // keep ~1.5 s of history
    while (this.buf.length > 2 && this.buf[1].t < t - 1500) this.buf.shift();
  }

  /** Large jump (spawn teleport): drop history so we don't slide across the arena. */
  reset(x, z) {
    this.buf.length = 0;
    this.f = null;
    this.x = x;
    this.z = z;
    this.y = 0;
    this.has = false;
  }

  /** Sample at render time rt (room ms). dt for velocity estimate. */
  sample(rt, dt) {
    const b = this.buf;
    if (!b.length) return;
    const px = this.x;
    const py = this.y;
    const pz = this.z;
    let x;
    let y;
    let z;
    let ry;
    let a;
    if (rt <= b[0].t) {
      ({ x, y, z, ry, a } = b[0]);
    } else if (rt >= b[b.length - 1].t) {
      const n = b[b.length - 1];
      const p = b.length > 1 ? b[b.length - 2] : null;
      const over = Math.min(rt - n.t, FEEL.extrapolateMaxMs);
      ({ ry, a } = n);
      if (p && n.t > p.t) {
        const k = over / (n.t - p.t);
        x = n.x + (n.x - p.x) * k;
        z = n.z + (n.z - p.z) * k;
        y = Math.max(0, n.y + (n.y - p.y) * k);
      } else {
        ({ x, y, z } = n);
      }
    } else {
      let i = b.length - 2;
      while (i > 0 && b[i].t > rt) i--;
      const p = b[i];
      const n = b[i + 1];
      const k = (rt - p.t) / (n.t - p.t);
      x = p.x + (n.x - p.x) * k;
      y = p.y + (n.y - p.y) * k;
      z = p.z + (n.z - p.z) * k;
      ry = lerpAngle(p.ry, n.ry, k);
      a = k < 0.5 ? p.a : n.a;
    }
    // ignore teleport-sized jumps for velocity
    if (dt > 0 && Math.hypot(x - px, z - pz) < 3) {
      const kv = 1 - Math.exp(-12 * dt);
      this.vx += ((x - px) / dt - this.vx) * kv;
      this.vz += ((z - pz) / dt - this.vz) * kv;
      this.vy += ((y - py) / dt - this.vy) * kv;
    }
    this.x = x;
    this.y = y;
    this.z = z;
    this.ry = ry;
    this.a = a;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /** Movement direction relative to body facing (radians), for strafe animation. */
  get moveAngle() {
    if (this.speed < 0.3) return 0;
    const a = Math.atan2(this.vx, this.vz) - this.ry;
    return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
  }
}
