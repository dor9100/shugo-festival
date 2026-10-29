import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA_HALF, BOT_JUMP_LEAD_S, FEAR_SPEED, LASER_SPEED, LASER_SPEED_SLOW, PLAY_LIMIT } from '../shared/config.js';
import { beamTimes, laserHitTest } from '../shared/lasers.js';
import { createBrain, stepBot } from '../shared/bots.js';
import { createRng } from '../shared/rng.js';
import { makeRoom } from './_util.js';

const bot = (rng, x = 0, z = 0) => ({ id: 'b1', x, y: 0, z, ry: 0, a: 0, immuneUntil: 0, fearUntil: 0, fearDx: 0, fearDz: 0, brain: createBrain(rng) });

/** Runs one beam over a lone bot with a forced jump plan; returns whether it got hit and whether it jumped. */
function beamOverBot(fail, spd = LASER_SPEED, lead = 0.2) {
  const rng = createRng(1);
  const p = bot(rng);
  p.brain.tx = p.x; // stand still
  p.brain.tz = p.z;
  p.brain.restUntil = Infinity;
  const beam = { id: 7, ax: 'x', from: -ARENA_HALF, to: ARENA_HALF, t0: 0, spd };
  p.brain.plans.set(beam.id, { lead, fail });
  const world = { phase: 'lobby', orbs: new Map(), bombs: new Map(), beams: [beam] };
  let hit = false;
  let jumped = false;
  for (let t = 50; t < beamTimes(beam).tGone; t += 50) {
    const [px, pz] = [p.x, p.z];
    world.now = t;
    stepBot(p, world, 50, rng);
    jumped ||= p.y > 0;
    hit ||= laserHitTest(beam, t - 50, px, pz, t, p.x, p.z, p.y);
  }
  return { hit, jumped };
}

test('bots: jump over an approaching beam (and get hit when they misjudge)', () => {
  // every configured reaction lead clears both speed tiers (timing uses each beam's own speed)
  for (const spd of [LASER_SPEED, LASER_SPEED_SLOW]) {
    for (const lead of [BOT_JUMP_LEAD_S[0], (BOT_JUMP_LEAD_S[0] + BOT_JUMP_LEAD_S[1]) / 2, BOT_JUMP_LEAD_S[1], 0.05, 0.9]) {
      assert.deepEqual(beamOverBot(false, spd, lead), { hit: false, jumped: true }, `spd ${spd}, lead ${lead}`);
    }
    assert.deepEqual(beamOverBot(true, spd), { hit: true, jumped: false });
  }
});

test('bots: obey fear (run along the flee vector, no jumping) and stay in the arena', () => {
  const rng = createRng(2);
  const p = bot(rng, 5, 0);
  p.fearUntil = 2000;
  p.fearDx = 1;
  p.fearDz = 0;
  const beam = { id: 1, ax: 'x', from: ARENA_HALF, to: -ARENA_HALF, t0: 0 };
  const world = { phase: 'playing', orbs: new Map(), bombs: new Map(), beams: [beam] };
  world.now = 50;
  stepBot(p, world, 50, rng);
  assert.ok(Math.abs(p.x - (5 + FEAR_SPEED * 0.05)) < 1e-9, 'moves at FEAR_SPEED right away');
  for (let t = 100; t < 2000; t += 50) {
    world.now = t;
    stepBot(p, world, 50, rng);
    assert.equal(p.y, 0, 'no jumping while feared');
    assert.equal(p.a, 3);
  }
  assert.equal(p.x, PLAY_LIMIT, 'slides along the clamp');
});

test('bots: chase balloons (special ones first)', () => {
  const rng = createRng(3);
  const p = bot(rng);
  const orbs = new Map([
    [1, { id: 1, k: 'green', x: 2, z: 0, at: 0, exp: 99999 }],
    [2, { id: 2, k: 'yellow', x: 0, z: -2.5, at: 0, exp: 99999 }],
  ]);
  const world = { now: 50, phase: 'playing', orbs, bombs: new Map(), beams: [] };
  p.brain.greed = 1;
  stepBot(p, world, 50, rng);
  assert.equal(p.brain.tz, -2.5, 'yellow preferred over a slightly closer green');
});

test('bots: full simulated round with 6 bots', () => {
  const r = makeRoom({ seed: 11 });
  r.room.addPlayer('p1', 'Host');
  for (let i = 0; i < 6; i++) r.room.handle('p1', { t: 'bot', add: true });
  assert.equal(r.room.players.size, 7);
  r.room.handle('p1', { t: 'start' });
  let airborne = 0;
  let idle = 0;
  let samples = 0;
  while (r.room.phase !== 'results') {
    r.clock.t += 50;
    r.room.tick();
    for (const p of r.room.players.values()) {
      if (!p.bot) continue;
      assert.ok(Math.abs(p.x) <= PLAY_LIMIT && Math.abs(p.z) <= PLAY_LIMIT, 'inside the arena');
      assert.ok(Number.isFinite(p.x + p.y + p.z + p.ry));
      if (p.y > 0) airborne++;
      if (r.room.phase === 'playing') {
        samples++;
        if (p.a === 0) idle++;
      }
    }
  }
  const { ranking } = r.last('p1', 'results');
  assert.equal(ranking.length, 7);
  const scores = r.msgs('p1', 'score');
  const orbsByBot = new Map();
  for (const s of scores.filter((s) => s.why === 'orb')) orbsByBot.set(s.id, (orbsByBot.get(s.id) ?? 0) + 1);
  const hits = scores.filter((s) => s.why === 'laser').length;
  assert.ok(orbsByBot.size >= 5, `only ${orbsByBot.size} bots picked balloons`);
  assert.ok(ranking.filter((x) => x.id.startsWith('b')).every((x) => x.score >= 0));
  assert.ok(ranking[0].score > 200, `top bot only scored ${ranking[0].score}`);
  assert.ok(airborne > 0, 'bots jump');
  const crossings = r.room.schedule.length * 6;
  assert.ok(hits > 0 && hits < crossings * 0.6, `${hits} hits out of ~${crossings} beam crossings`);
  assert.ok(r.msgs('p1', 'boom').some((b) => b.feared.length > 0), 'bots get feared by bombs');
  assert.ok(idle / samples < 0.15, `bots idle ${Math.round((idle / samples) * 100)}% of the round`);
});
