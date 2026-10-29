import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_HALF,
  LASER_CHAIN_SPEED_RANGE,
  LASER_FIRST_AT_MS,
  LASER_MAX_BEAMS,
  LASER_SEGMENTS,
  LASER_SPEED,
  LASER_SPEED_SLOW,
  LASER_STOP_BEFORE_END_MS,
  ROUND_MS,
} from '../shared/config.js';
import { beamActive, beamTimes } from '../shared/lasers.js';
import { buildLaserSchedule, maxConcurrentBeams } from '../shared/schedule.js';
import { createRng, mulberry32 } from '../shared/rng.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => (i * 2654435761) >>> 0);
const START = 123456; // arbitrary room time of round start

const activeAt = (beams, t) => beams.filter((b) => beamActive(b, t)).length;

test('rng is deterministic and in range', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  const r = createRng(3);
  for (let i = 0; i < 200; i++) {
    const v = r.int(2, 5);
    assert.ok(v >= 2 && v <= 5 && Number.isInteger(v));
  }
  assert.deepEqual(createRng(9).shuffle([1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5]);
});

test('never more than LASER_MAX_BEAMS at once (sampled every 50 ms, many seeds)', () => {
  for (const seed of SEEDS) {
    const beams = buildLaserSchedule(seed, START);
    for (let t = START; t <= START + ROUND_MS; t += 50) {
      const n = activeAt(beams, t);
      assert.ok(n <= LASER_MAX_BEAMS, `seed ${seed}: ${n} beams at rt=${t - START}`);
    }
    assert.ok(maxConcurrentBeams(beams) <= LASER_MAX_BEAMS);
  }
});

const [kLo, kHi] = LASER_CHAIN_SPEED_RANGE;
const tierOf = (spd) => {
  if (spd >= LASER_SPEED_SLOW * kLo - 1e-6 && spd <= LASER_SPEED_SLOW * kHi + 1e-3) return 'slow';
  if (spd >= LASER_SPEED * kLo - 1e-6 && spd <= LASER_SPEED * kHi + 1e-3) return 'fast';
  return null;
};
// the long laser-free stretch between two windows (the bomb-wave break)
const BREAK = LASER_SEGMENTS.slice(1)
  .map((s, i) => ({ from: LASER_SEGMENTS[i].to, to: s.from }))
  .sort((a, b) => b.to - b.from - (a.to - a.from))[0];
const OVERRUN_MS = 2000; // anchor:'start' chains may run this far past their window

test('timeline windows: slow tutorial line, first chain at 21.7 s, break, stop before the end', () => {
  const firstChain = LASER_SEGMENTS[0];
  assert.equal(firstChain.kind, 'chain');
  assert.ok(BREAK.to - BREAK.from >= 15000, 'there is a long break');
  for (const seed of SEEDS) {
    const beams = buildLaserSchedule(seed, START);
    const first = beams[0];
    assert.equal(first.t0, START + LASER_FIRST_AT_MS, 'first beam at LASER_FIRST_AT_MS');
    assert.equal(beams.filter((b) => b.t0 === first.t0).length, 1, 'tutorial is a single line');
    assert.equal(first.spd, LASER_SPEED_SLOW, 'tutorial line is slow');
    // nothing else until the first chain, which starts exactly at its window start (~21.7 s like the real game)
    assert.equal(beams[1].t0, START + firstChain.from, `seed ${seed}: first chain at ${beams[1].t0 - START}`);
    // the mid-round break
    for (let t = START + BREAK.from; t < START + BREAK.to; t += 50) assert.equal(activeAt(beams, t), 0, `rt=${t - START}`);
    // everything gone LASER_STOP_BEFORE_END_MS before the end
    for (const b of beams) assert.ok(beamTimes(b).tGone <= START + ROUND_MS - LASER_STOP_BEFORE_END_MS);
    // every beam starts inside a window and ends inside it (start-anchored chains may overrun a little)
    for (const b of beams.slice(1)) {
      const rt = b.t0 - START;
      const seg = LASER_SEGMENTS.find((s) => rt >= s.from && rt < s.to);
      assert.ok(seg, `beam at rt=${rt} outside every window`);
      const slack = seg.anchor === 'start' ? OVERRUN_MS : 0;
      assert.ok(beamTimes(b).tGone - START <= seg.to + slack, `beam at rt=${rt} spills past ${seg.to}`);
    }
  }
});

test('two speed tiers: slow opening, both tiers later, each tier near-constant', () => {
  const seen = { slow: 0, fast: 0 };
  const late = { slow: 0, fast: 0 };
  for (const seed of SEEDS) {
    const beams = buildLaserSchedule(seed, START);
    for (const b of beams) {
      const tier = tierOf(b.spd);
      assert.ok(tier, `beam speed ${b.spd} is not within ${kLo}-${kHi}x of a tier`);
      seen[tier]++;
      const rt = b.t0 - START;
      if (rt < 40000) assert.equal(tier, 'slow', `seed ${seed}: fast beam at rt=${rt} (first ~40 s are slow)`);
      if (rt >= 74000) late[tier]++;
    }
  }
  assert.ok(seen.slow > 0 && seen.fast > 0, 'both tiers present');
  assert.ok(late.fast > late.slow && late.slow > 0, `after the break mostly fast with some slow (${JSON.stringify(late)})`);
});

test('chains are non-stop and the final chain runs to the stop time', () => {
  for (const seed of SEEDS) {
    const beams = buildLaserSchedule(seed, START);
    for (const seg of LASER_SEGMENTS.filter((s) => s.kind === 'chain')) {
      const segBeams = beams.filter((b) => b.t0 - START >= seg.from && b.t0 - START < seg.to);
      const from = Math.min(...segBeams.map((b) => b.t0));
      const to = Math.max(...segBeams.map((b) => beamTimes(b).tGone));
      for (let t = from; t < to; t += 50) assert.ok(activeAt(beams, t) > 0, `seed ${seed}: hole in chain at rt=${t - START}`);
    }
    const end = Math.max(...beams.map((b) => beamTimes(b).tGone)) - START;
    assert.ok(end > ROUND_MS - LASER_STOP_BEFORE_END_MS - 500, `final chain ends early (${end})`);
  }
});

test('beams are full edge-to-edge passes with unique numeric ids', () => {
  for (const seed of SEEDS) {
    const beams = buildLaserSchedule(seed, START);
    const ids = new Set();
    for (const b of beams) {
      assert.equal(typeof b.id, 'number');
      ids.add(b.id);
      assert.ok(b.ax === 'x' || b.ax === 'z');
      assert.equal(Math.abs(b.from), ARENA_HALF);
      assert.equal(b.to, -b.from);
    }
    assert.equal(ids.size, beams.length);
    assert.ok(beams.length >= 25, `only ${beams.length} beams`);
  }
});

test('patterns: squares, crosses and opposite lines all appear', () => {
  const kinds = new Set();
  for (const seed of SEEDS.slice(0, 10)) {
    const beams = buildLaserSchedule(seed, START);
    const groups = Map.groupBy(beams, (b) => b.t0);
    for (const g of groups.values()) {
      if (g.length === 4) kinds.add('square');
      else if (g.length === 2 && g[0].ax !== g[1].ax) kinds.add('cross');
      else if (g.length === 2) {
        kinds.add('lines');
        assert.equal(g[0].from, -g[1].from, 'lines start on opposite edges');
      } else if (g.length === 1) kinds.add('line');
    }
  }
  assert.deepEqual([...kinds].sort(), ['cross', 'line', 'lines', 'square']);
});

test('deterministic per seed, different across seeds', () => {
  assert.deepEqual(buildLaserSchedule(42, START), buildLaserSchedule(42, START));
  assert.notDeepEqual(buildLaserSchedule(42, START), buildLaserSchedule(43, START));
  const shifted = buildLaserSchedule(42, 0);
  buildLaserSchedule(42, START).forEach((b, i) => assert.equal(b.t0 - START, shifted[i].t0));
});
