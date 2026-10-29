// Laser beam math shared by the room (validation, bots) and the client (rendering, own hit detection).
//
// Beam descriptor (plain JSON, sent in `laser` messages):
//   { id, ax: 'x'|'z', from, to, t0, hold?, spd?, endHold? }
//   ax = 'x' -> the beam is the line  x = pos(t), spanning z in [-ARENA_HALF, ARENA_HALF]
//   ax = 'z' -> the beam is the line  z = pos(t), spanning x in [-ARENA_HALF, ARENA_HALF]
//   t0 = room time (ms) the beam appears at `from`; it holds `hold` ms, travels to `to` at `spd` m/s,
//   holds `endHold` ms at `to`, then is gone.
import {
  ARENA_HALF,
  LASER_END_HOLD_MS,
  LASER_HIT_HALF,
  LASER_SPAWN_HOLD_MS,
  LASER_SPEED,
  LASER_Y,
  PLAYER_RADIUS,
} from './config.js';

export function beamTimes(b) {
  const hold = b.hold ?? LASER_SPAWN_HOLD_MS;
  const spd = b.spd ?? LASER_SPEED;
  const tMove = b.t0 + hold;
  const tArrive = tMove + (Math.abs(b.to - b.from) / spd) * 1000;
  const tGone = tArrive + (b.endHold ?? LASER_END_HOLD_MS);
  return { tMove, tArrive, tGone };
}

/** @returns {{pos:number, phase:'hold'|'move'|'end', progress:number} | null} null when not present at time t */
export function beamState(b, t) {
  if (t < b.t0) return null;
  const { tMove, tArrive, tGone } = beamTimes(b);
  if (t >= tGone) return null;
  if (t < tMove) return { pos: b.from, phase: 'hold', progress: 0 };
  if (t < tArrive) {
    const k = (t - tMove) / (tArrive - tMove);
    return { pos: b.from + (b.to - b.from) * k, phase: 'move', progress: k };
  }
  return { pos: b.to, phase: 'end', progress: 1 };
}

export function beamActive(b, t) {
  return beamState(b, t) !== null;
}

/** World-space endpoints of the beam at time t (y = LASER_Y), or null. Handy for rendering. */
export function beamSegment(b, t) {
  const s = beamState(b, t);
  if (!s) return null;
  const H = ARENA_HALF;
  return b.ax === 'x'
    ? { ax: b.ax, pos: s.pos, phase: s.phase, a: [s.pos, LASER_Y, -H], b: [s.pos, LASER_Y, H] }
    : { ax: b.ax, pos: s.pos, phase: s.phase, a: [-H, LASER_Y, s.pos], b: [H, LASER_Y, s.pos] };
}

/** True if the player's feet are low enough to be touched by a beam. */
export function feetLow(feetY) {
  return feetY < LASER_Y + LASER_HIT_HALF;
}

/**
 * Swept hit test between two samples (prev -> now). Catches beams that jump past the player between frames.
 * Pass the player's horizontal position at both samples and feet height now.
 */
export function laserHitTest(b, prevT, prevX, prevZ, t, x, z, feetY) {
  if (!feetLow(feetY)) return false;
  const now = beamState(b, t);
  if (!now) return false;
  const R = LASER_HIT_HALF + PLAYER_RADIUS;
  const dNow = (b.ax === 'x' ? x : z) - now.pos;
  if (Math.abs(dNow) < R) return true;
  const prev = beamState(b, prevT);
  if (!prev) return false;
  const dPrev = (b.ax === 'x' ? prevX : prevZ) - prev.pos;
  return Math.sign(dPrev) !== Math.sign(dNow);
}
