// Builds a whole round's laser beams from a seed (deterministic). Timeline per SPEC "Round script":
// tutorial line at LASER_FIRST_AT_MS, then LASER_SEGMENTS (chains / patterns with shrinking gaps), nothing in between.
// Every pattern gets a speed tier (slow / fast, CRITIC P0-1); each beam carries its own `spd`.
import {
  ARENA_HALF,
  LASER_CHAIN_SPEED_RANGE,
  LASER_END_HOLD_MS,
  LASER_FIRST_AT_MS,
  LASER_SEGMENT_GAP_MS,
  LASER_TUTORIAL_END_HOLD_MS,
  LASER_GAP_JITTER_MS,
  LASER_GAP_MAX_STRETCH_MS,
  LASER_MAX_BEAMS,
  LASER_SEGMENTS,
  LASER_SPAWN_HOLD_MS,
  LASER_SPEED,
  LASER_SPEED_SLOW,
  LASER_TUTORIAL_TIER,
} from './config.js';
import { beamTimes } from './lasers.js';
import { createRng } from './rng.js';

const H = ARENA_HALF;
const SAFETY_MS = 20; // keeps rounding from spilling past a window end

export const LASER_TIERS = { slow: LASER_SPEED_SLOW, fast: LASER_SPEED };

// A pattern is a list of [axis, startSide]: the beam starts at startSide*H and sweeps to the opposite edge.
export const PATTERNS = {
  line: (r) => [[r.pick(['x', 'z']), r.sign()]],
  lines: (r) => {
    const ax = r.pick(['x', 'z']);
    return [[ax, -1], [ax, 1]];
  },
  cross: (r) => [['x', r.sign()], ['z', r.sign()]],
  square: () => [['x', -1], ['x', 1], ['z', -1], ['z', 1]],
};

const passMs = (spd) => ((2 * H) / spd) * 1000;
const lifeMs = (spd) => LASER_SPAWN_HOLD_MS + passMs(spd) + LASER_END_HOLD_MS;
const linkMs = (spd) => LASER_SPAWN_HOLD_MS + passMs(spd); // pattern start -> beams reach the far side
const roundSpd = (v) => Math.ceil(v * 1000) / 1000; // round up -> never longer than planned

/**
 * @param {number} seed
 * @param {number} roundStartMs room time of round start; beam t0s are absolute room times
 * @returns {Array<{id:number, ax:'x'|'z', from:number, to:number, t0:number, spd:number, endHold?:number}>}
 */
export function buildLaserSchedule(seed, roundStartMs = 0) {
  const rng = createRng(seed);
  const beams = []; // t0 is round-relative while building
  let lastName = null;
  let lastGone = 0;

  const choose = (mix) => {
    const w = { ...mix };
    if (lastName && w[lastName]) w[lastName] /= 2.5; // fewer repeats
    return (lastName = rng.weighted(w));
  };
  const tierSpeed = (speedMix) => LASER_TIERS[rng.weighted(speedMix)];

  const place = (name, t0, spd) => {
    const group = PATTERNS[name](rng).map(([ax, side]) => ({ id: 0, ax, from: side * H, to: -side * H, t0: Math.ceil(t0), spd }));
    beams.push(...group);
    return group;
  };
  const goneOf = (group) => beamTimes(group[0]).tGone;
  // Next pattern pops in as the previous one reaches the far side; if both together would exceed the cap,
  // the previous beams vanish on arrival instead of holding at the edge.
  const link = (prev, next) => {
    if (prev.length + next.length > LASER_MAX_BEAMS) for (const b of prev) b.endHold = 0;
  };

  function chain(seg) {
    const start = Math.max(seg.from, lastGone);
    const span = seg.to - start - SAFETY_MS;
    // Draw (pattern, tier) items up front, then pick how many fit best with one speed factor k in range.
    const items = [];
    for (let nominal = LASER_END_HOLD_MS; nominal < span * 1.5 && items.length < 12; ) {
      const item = { name: choose(seg.mix), spd: tierSpeed(seg.speed) };
      items.push(item);
      nominal += linkMs(item.spd);
    }
    const [kLo, kHi] = LASER_CHAIN_SPEED_RANGE;
    let best = null;
    let passSum = 0;
    for (let n = 1; n <= items.length; n++) {
      passSum += passMs(items[n - 1].spd);
      const fixed = n * LASER_SPAWN_HOLD_MS + LASER_END_HOLD_MS;
      const k = Math.min(kHi, Math.max(kLo, passSum / Math.max(1, span - fixed)));
      const total = fixed + passSum / k;
      if (seg.anchor === 'end' && total > span) continue; // must not start before `start`
      const miss = Math.abs(total - span);
      if (!best || miss < best.miss - 1 || (miss < best.miss + 1 && Math.abs(Math.log(k)) < Math.abs(Math.log(best.k)))) {
        best = { n, k, total, miss };
      }
    }
    if (!best) return;
    let t = seg.anchor === 'end' ? start + span - best.total : start;
    let prev = null;
    for (const item of items.slice(0, best.n)) {
      const group = place(item.name, t, roundSpd(item.spd * best.k));
      if (prev) link(prev, group);
      t = Math.ceil(beamTimes(group[0]).tArrive);
      prev = group;
    }
    lastGone = goneOf(prev);
  }

  function gaps(seg) {
    const groups = [];
    const pauses = []; // pauses[i] = true if a gap (not a chain link) follows groups[i]
    const fastest = Math.max(...Object.keys(seg.speed).filter((k) => seg.speed[k] > 0).map((k) => LASER_TIERS[k]));
    const end = seg.to - SAFETY_MS;
    let t = Math.max(seg.from, lastGone + LASER_SEGMENT_GAP_MS); // a breather even if the previous chain overran
    for (;;) {
      const name = choose(seg.mix);
      let spd = tierSpeed(seg.speed);
      if (t + lifeMs(spd) > end) spd = fastest; // a slow pattern doesn't fit: try the fastest allowed tier
      if (t + lifeMs(spd) > end) break;
      const group = place(name, t, spd);
      const prev = groups[groups.length - 1];
      if (prev && !pauses[groups.length - 1]) link(prev, group);
      groups.push(group);
      if (rng.chance(seg.chain ?? 0)) {
        pauses.push(false);
        t = Math.ceil(beamTimes(group[0]).tArrive);
      } else {
        pauses.push(true);
        const k = (t - seg.from) / (seg.to - seg.from);
        const gap = seg.gapMs[0] + (seg.gapMs[1] - seg.gapMs[0]) * k + rng.range(-1, 1) * LASER_GAP_JITTER_MS;
        t = Math.ceil(goneOf(group) + Math.max(0, gap));
      }
    }
    if (!groups.length) return;
    // Spread part of the unused tail over the pauses so the segment ends nearer its window end.
    const nPauses = pauses.slice(0, -1).filter(Boolean).length;
    const slack = end - goneOf(groups[groups.length - 1]);
    const extra = Math.floor(Math.min(LASER_GAP_MAX_STRETCH_MS, slack / (nPauses + 1)));
    let shift = 0;
    groups.forEach((g, i) => {
      for (const b of g) b.t0 += shift;
      if (pauses[i]) shift += extra;
    });
    lastGone = goneOf(groups[groups.length - 1]);
  }

  // the real tutorial beam starts sweeping the moment it appears and vanishes almost on arrival
  const tutorial = place('line', LASER_FIRST_AT_MS, LASER_TIERS[LASER_TUTORIAL_TIER]);
  for (const b of tutorial) Object.assign(b, { hold: 0, endHold: LASER_TUTORIAL_END_HOLD_MS });
  lastGone = goneOf(tutorial);
  lastName = 'line';
  for (const seg of LASER_SEGMENTS) (seg.kind === 'chain' ? chain : gaps)(seg);

  beams.sort((a, b) => a.t0 - b.t0);
  beams.forEach((b, i) => {
    b.id = i + 1;
    b.t0 += roundStartMs;
  });
  return beams;
}

/** Highest number of beams present at the same time (exact, via interval sweep). */
export function maxConcurrentBeams(beams) {
  const ev = [];
  for (const b of beams) {
    const { tGone } = beamTimes(b);
    ev.push([b.t0, 1], [tGone, -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ends before starts at equal times ([t0, tGone) intervals)
  let cur = 0;
  let max = 0;
  for (const [, d] of ev) max = Math.max(max, (cur += d));
  return max;
}
