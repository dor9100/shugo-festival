import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOMB_FUSE_MS,
  BOMB_RADIUS,
  BOMB_WAVES,
  COUNTDOWN_MS,
  FEAR_MS,
  FEAR_WANDER_DEG,
  GREEN_OPENING,
  ORB_DIAMETER,
  ORB_POINTS,
  ORB_Y,
  ORB_Y_AIR,
  PLAYER_HEIGHT,
  IMMUNITY_MS,
  LASER_LEAD_MS,
  LASER_PENALTY,
  MAX_PLAYERS,
  OVERTIME_MS,
  PINK_WAVES,
  PLAY_LIMIT,
  RESULTS_MS,
  ROUND_MS,
  SNAP_HZ,
  YELLOW_LIFETIME_AFTER_BOOM_MS,
  YELLOW_PER_BOMB,
  YELLOW_RING_RADIUS,
} from '../shared/config.js';
import { beamActive, beamTimes } from '../shared/lasers.js';
import { PEAK_Y_MS, ROOM_TICK_HZ } from '../shared/room.js';
import { makeRoom } from './_util.js';

function startedRoom(players = ['p1', 'p2'], seed = 1) {
  const r = makeRoom({ seed });
  for (const id of players) r.room.addPlayer(id, id.toUpperCase());
  r.room.handle(players[0], { t: 'start' });
  return r;
}
const toPlaying = (r) => r.advanceTo(() => r.room.phase === 'playing');
const toRoundTime = (r, rt) => r.advanceTo(() => r.clock.t >= r.room.roundStart + rt);
const st = (r, id, x, z, y = 0) => r.room.handle(id, { t: 'st', x, y, z, ry: 0, a: 1 });
const score = (r, id) => r.room.players.get(id).score;
const liveBeam = (r, minLeftMs = 500) =>
  r.room.schedule.find((b) => beamActive(b, r.clock.t) && beamTimes(b).tGone - r.clock.t > minLeftMs);

test('room: phase flow lobby -> countdown -> playing -> results -> lobby', () => {
  const r = makeRoom();
  r.room.addPlayer('p1', 'Ann');
  r.room.addPlayer('p2', 'Ben');
  const w = r.last('p2', 'welcome');
  assert.equal(w.you, 'p2');
  assert.equal(w.hostId, 'p1');
  assert.equal(w.phase, 'lobby');
  assert.equal(w.phaseEnd, 0);
  assert.equal(w.code, 'TEST1');
  assert.equal(w.players.length, 2);
  assert.ok(r.last('p2', 'spawn'), 'spawn on join');

  r.room.handle('p2', { t: 'start' }); // not host
  assert.equal(r.room.phase, 'lobby');
  r.room.handle('p1', { t: 'start' });
  assert.equal(r.room.phase, 'countdown');
  const ph = r.last('p2', 'phase');
  assert.equal(ph.phaseEnd - ph.phaseStart, COUNTDOWN_MS);
  assert.equal(ph.roundStart, ph.phaseEnd);
  assert.equal(r.msgs('p2', 'spawn').length, 2, 'spawn at countdown');
  r.room.handle('p1', { t: 'start' }); // ignored while counting down
  assert.equal(r.msgs('p2', 'phase').length, 1);

  toPlaying(r);
  const play = r.last('p1', 'phase');
  assert.equal(play.phase, 'playing');
  assert.equal(play.phaseStart, ph.roundStart);
  assert.equal(play.phaseEnd, ph.roundStart + ROUND_MS + OVERTIME_MS);

  r.advanceTo(() => r.room.phase === 'results');
  const res = r.last('p2', 'results');
  assert.equal(res.ranking.length, 2);
  assert.equal(r.last('p2', 'phase').phaseEnd - r.last('p2', 'phase').phaseStart, RESULTS_MS);
  assert.equal(r.room.orbs.size, 0);

  r.advanceTo(() => r.room.phase === 'lobby');
  assert.equal(r.last('p1', 'phase').phaseEnd, 0);
  r.room.handle('p1', { t: 'start' });
  assert.equal(r.room.phase, 'countdown', 'can start again');
});

test('room: host can restart from results', () => {
  const r = startedRoom();
  r.advanceTo(() => r.room.phase === 'results');
  r.room.handle('p1', { t: 'start' });
  assert.equal(r.room.phase, 'countdown');
  assert.equal(score(r, 'p1'), 0);
});

test('room: balloons spawn (opening cluster, greens, pinks) and expire', () => {
  const r = startedRoom();
  toPlaying(r);
  toRoundTime(r, GREEN_OPENING.atMs + 60);
  const opening = r.msgs('p1', 'orb');
  assert.equal(opening.length, GREEN_OPENING.count);
  for (const o of opening) {
    assert.equal(o.k, 'green');
    assert.ok(Math.hypot(o.x, o.z) <= GREEN_OPENING.spread + 1e-9);
    assert.ok(o.exp > o.at);
  }
  toRoundTime(r, PINK_WAVES[0].atMs + 60);
  assert.equal(r.msgs('p1', 'orb').filter((o) => o.k === 'pink').length, PINK_WAVES[0].count);
  assert.ok(r.msgs('p1', 'orbGone').some((g) => g.by === undefined), 'unclaimed balloons expire');
  for (const o of r.msgs('p1', 'orb')) assert.ok(Math.abs(o.x) <= PLAY_LIMIT && Math.abs(o.z) <= PLAY_LIMIT);
});

test('room: pickup is first-claim-wins and checks distance', () => {
  const r = startedRoom(['p1', 'p2', 'p3']);
  toPlaying(r);
  toRoundTime(r, GREEN_OPENING.atMs + 60);
  const [o, o2] = r.msgs('p1', 'orb');
  st(r, 'p1', o.x, o.z);
  st(r, 'p2', o.x + 0.3, o.z);
  r.room.handle('p2', { t: 'pickup', id: o.id });
  r.room.handle('p1', { t: 'pickup', id: o.id });
  assert.equal(score(r, 'p2'), 50);
  assert.equal(score(r, 'p1'), 0);
  const gone = r.msgs('p3', 'orbGone').filter((g) => g.id === o.id);
  assert.deepEqual(gone, [{ t: 'orbGone', id: o.id, by: 'p2', pts: 50 }]);
  assert.deepEqual(r.last('p3', 'score'), { t: 'score', id: 'p2', score: 50, d: 50, why: 'orb', k: 'green' });

  // too far away
  st(r, 'p3', o2.x + 5, o2.z + 5);
  r.room.handle('p3', { t: 'pickup', id: o2.id });
  assert.equal(score(r, 'p3'), 0);
  assert.ok(r.room.orbs.has(o2.id));
  r.room.handle('p3', { t: 'pickup', id: 999999 });
  assert.equal(score(r, 'p3'), 0);
});

test('room: air balloons need a jump; pinks always air, yellows never', () => {
  const r = startedRoom();
  toPlaying(r);
  toRoundTime(r, PINK_WAVES[0].atMs + 60);
  assert.ok(ORB_Y_AIR - ORB_DIAMETER / 2 > PLAYER_HEIGHT, 'air balloons are out of reach while standing');
  const pink = r.msgs('p1', 'orb').find((o) => o.k === 'pink');
  assert.equal(pink.y, ORB_Y_AIR);
  st(r, 'p1', pink.x, pink.z, 0);
  r.clock.t += PEAK_Y_MS + 50; // no recent jump peak
  st(r, 'p1', pink.x, pink.z, 0);
  r.room.handle('p1', { t: 'pickup', id: pink.id });
  assert.equal(score(r, 'p1'), 0, 'standing under a pink does not reach it');
  st(r, 'p1', pink.x, pink.z, 0.9);
  st(r, 'p1', pink.x, pink.z, 0.2); // claim arrives on the way down: the recent peak still counts
  r.room.handle('p1', { t: 'pickup', id: pink.id });
  assert.equal(score(r, 'p1'), ORB_POINTS.pink);

  toRoundTime(r, BOMB_WAVES[0].atMs + 100);
  const orbs = r.msgs('p1', 'orb');
  assert.ok(orbs.filter((o) => o.k === 'yellow').length > 0 && orbs.filter((o) => o.k === 'yellow').every((o) => o.y === ORB_Y));
  assert.ok(orbs.filter((o) => o.k === 'green').every((o) => o.y === ORB_Y || o.y === ORB_Y_AIR));
});

test('room: pink immunity blocks laser hits until it runs out', () => {
  const r = startedRoom();
  toPlaying(r);
  toRoundTime(r, PINK_WAVES[0].atMs + 60);
  const pink = r.msgs('p1', 'orb').find((o) => o.k === 'pink');
  st(r, 'p1', pink.x, pink.z, 1.0); // pinks float up high: grabbed mid-jump
  r.room.handle('p1', { t: 'pickup', id: pink.id });
  assert.equal(score(r, 'p1'), 60);
  const imm = r.last('p2', 'immune');
  assert.equal(imm.id, 'p1');
  assert.equal(imm.until, r.clock.t + IMMUNITY_MS);

  r.advanceTo(() => liveBeam(r) && r.clock.t < imm.until);
  r.room.handle('p1', { t: 'hit', id: liveBeam(r).id });
  assert.equal(score(r, 'p1'), 60, 'immune');

  r.advanceTo(() => r.clock.t >= imm.until && liveBeam(r) && !r.room.players.get('p1').hitBeams.has(liveBeam(r).id));
  r.room.handle('p1', { t: 'hit', id: liveBeam(r).id });
  assert.equal(score(r, 'p1'), 60 + LASER_PENALTY);
  assert.deepEqual(r.last('p2', 'score'), { t: 'score', id: 'p1', score: 40, d: -20, why: 'laser' });
});

test('room: one hit per beam, score floor, time window', () => {
  const r = startedRoom();
  toPlaying(r);
  toRoundTime(r, GREEN_OPENING.atMs + 60);
  const o = r.msgs('p1', 'orb')[0];
  st(r, 'p1', o.x, o.z);
  r.room.handle('p1', { t: 'pickup', id: o.id }); // p1: 50
  r.advanceTo(() => liveBeam(r, 1000));
  const b = liveBeam(r, 1000);
  r.room.handle('p1', { t: 'hit', id: b.id });
  r.room.handle('p1', { t: 'hit', id: b.id });
  assert.equal(score(r, 'p1'), 30, 'second claim for the same beam ignored');

  const before = r.msgs('p2', 'score').length;
  r.room.handle('p2', { t: 'hit', id: b.id }); // p2 has 0 points
  assert.equal(score(r, 'p2'), 0);
  assert.equal(r.msgs('p2', 'score').length, before, 'no score message when nothing changes');

  // a beam far in the future can't be claimed yet
  const future = r.room.schedule.find((x) => x.t0 > r.clock.t + 10000);
  r.room.handle('p1', { t: 'hit', id: future.id });
  assert.equal(score(r, 'p1'), 30);

  // floor: drop p1 to 0 with more beams, never below
  for (const x of r.room.schedule) {
    r.clock.t = x.t0 + 100;
    r.room.handle('p1', { t: 'hit', id: x.id });
  }
  assert.equal(score(r, 'p1'), 0);
});

test('room: bombs spawn yellows, boom fears players in radius only, yellows expire', () => {
  const r = startedRoom(['p1', 'p2', 'p3']);
  toPlaying(r);
  const wave = BOMB_WAVES[0];
  toRoundTime(r, wave.atMs + 10);
  const first = r.last('p1', 'bomb');
  assert.ok(first, 'bomb spawned');
  assert.equal(first.boomAt - first.at, BOMB_FUSE_MS);
  // p1 next to the first bomb, p2 / p3 in far corners
  st(r, 'p1', first.x + 1, first.z);
  st(r, 'p2', -Math.sign(first.x || 1) * PLAY_LIMIT, -Math.sign(first.z || 1) * PLAY_LIMIT);
  st(r, 'p3', -Math.sign(first.x || 1) * PLAY_LIMIT, Math.sign(first.z || 1) * PLAY_LIMIT);
  const pos = { p1: [first.x + 1, first.z], p2: [r.room.players.get('p2').x, r.room.players.get('p2').z], p3: [r.room.players.get('p3').x, r.room.players.get('p3').z] };

  r.advanceTo(() => r.msgs('p1', 'boom').length === wave.count);
  const bombs = r.msgs('p1', 'bomb');
  assert.equal(bombs.length, wave.count);
  for (const b of bombs) {
    const ys = r.msgs('p1', 'orb').filter((o) => o.bomb === b.id);
    assert.equal(ys.length, YELLOW_PER_BOMB);
    for (const y of ys) {
      assert.equal(y.k, 'yellow');
      assert.equal(y.at, b.at, 'spawned with the bomb');
      assert.equal(y.exp, b.boomAt + YELLOW_LIFETIME_AFTER_BOOM_MS);
      assert.ok(Math.hypot(y.x - b.x, y.z - b.z) <= YELLOW_RING_RADIUS + 0.02);
    }
  }
  for (const boom of r.msgs('p1', 'boom')) {
    const expected = Object.entries(pos)
      .filter(([, [x, z]]) => Math.hypot(x - boom.x, z - boom.z) <= BOMB_RADIUS)
      .map(([id]) => id);
    assert.deepEqual(boom.feared.map((f) => f.id).sort(), expected.sort());
    for (const f of boom.feared) {
      const [x, z] = pos[f.id];
      const away = Math.atan2(z - boom.z, x - boom.x);
      const dir = Math.atan2(f.dz, f.dx);
      const diff = Math.abs(((dir - away + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      assert.ok(diff <= (FEAR_WANDER_DEG * Math.PI) / 180 + 0.01, `flee direction off by ${diff}`);
      assert.ok(Math.abs(Math.hypot(f.dx, f.dz) - 1) < 0.01);
    }
  }
  const firstBoom = r.msgs('p1', 'boom')[0];
  assert.equal(firstBoom.id, first.id);
  assert.ok(firstBoom.feared.some((f) => f.id === 'p1' && f.until === first.boomAt + FEAR_MS));

  // yellows expire YELLOW_LIFETIME_AFTER_BOOM_MS after their boom
  const lastExp = Math.max(...r.msgs('p1', 'orb').filter((o) => o.k === 'yellow').map((o) => o.exp));
  r.advanceTo(() => r.clock.t >= lastExp + 60);
  for (const y of r.msgs('p1', 'orb').filter((o) => o.k === 'yellow')) assert.ok(!r.room.orbs.has(y.id));
});

test('room: host migration, bots never host, empty callback', () => {
  const r = makeRoom();
  r.room.addPlayer('p1', 'A');
  r.room.addPlayer('p2', 'B');
  r.room.addPlayer('p3', 'C');
  r.room.handle('p2', { t: 'bot', add: true }); // not host: ignored
  assert.equal(r.room.players.size, 3);
  r.room.handle('p1', { t: 'bot', add: true });
  assert.equal(r.room.players.size, 4);
  assert.ok(r.last('p2', 'roster').players.some((p) => p.bot && p.name === 'Bot Pip'));

  r.room.removePlayer('p1');
  assert.equal(r.last('p3', 'roster').hostId, 'p2');
  r.room.handle('p3', { t: 'start' });
  assert.equal(r.room.phase, 'lobby');
  r.room.handle('p2', { t: 'start' });
  assert.equal(r.room.phase, 'countdown');
  r.room.removePlayer('p2');
  assert.equal(r.last('p3', 'roster').hostId, 'p3');
  assert.equal(r.emptied, 0);
  r.room.removePlayer('p3');
  assert.equal(r.emptied, 1, 'only bots left -> empty');
});

test('room: late joiner gets full state and plays with 0 points', () => {
  const r = startedRoom();
  toPlaying(r);
  toRoundTime(r, 30000);
  r.room.addPlayer('p9', 'Late');
  const w = r.last('p9', 'welcome');
  assert.equal(w.phase, 'playing');
  assert.equal(w.roundStart, r.room.roundStart);
  assert.equal(w.players.length, 3);
  assert.equal(w.players.find((p) => p.id === 'p9').score, 0);
  assert.ok(w.lasers.length > 0, 'announced beams included');
  assert.deepEqual(w.orbs.map((o) => o.id).sort(), [...r.room.orbs.keys()].sort());
  assert.ok(Math.abs(w.now - r.clock.t) < 1);
  assert.ok(r.last('p9', 'spawn'));
  const o = [...r.room.orbs.values()][0];
  st(r, 'p9', o.x, o.z, 1.0); // mid-jump reaches ground and air balloons alike
  r.room.handle('p9', { t: 'pickup', id: o.id });
  assert.ok(score(r, 'p9') > 0);
  r.advanceTo(() => r.room.phase === 'results');
  r.room.addPlayer('p10', 'Later');
  assert.ok(r.last('p10', 'welcome').ranking.length === 4);
});

test('room: lasers are announced at least LASER_LEAD_MS ahead', () => {
  const r = startedRoom();
  let seen = 0;
  while (r.room.phase !== 'results') {
    r.clock.t += 50;
    r.room.tick();
    const lasers = r.msgs('p1', 'laser');
    for (const m of lasers.slice(seen)) assert.ok(m.l.t0 - r.clock.t >= LASER_LEAD_MS, `lead ${m.l.t0 - r.clock.t}`);
    seen = lasers.length;
  }
  assert.equal(seen, r.room.schedule.length);
});

test('room: snapshots are compact arrays at SNAP_HZ', () => {
  const r = makeRoom();
  r.room.addPlayer('p1', 'A');
  st(r, 'p1', 1.23456, -2.34567, 0.5);
  assert.ok(ROOM_TICK_HZ >= SNAP_HZ, 'hosts tick at least as fast as snapshots go out');
  r.advance(1000, 1000 / ROOM_TICK_HZ);
  const snaps = r.msgs('p1', 'snap');
  assert.ok(Math.abs(snaps.length - SNAP_HZ) <= 1, `${snaps.length} snaps/s, expected ${SNAP_HZ}`);
  // with a jittery tick (+-5 ms) the rate holds
  const r2 = makeRoom();
  r2.room.addPlayer('p1', 'A');
  for (let i = 0; i < ROOM_TICK_HZ * 2; i++) r2.advance(1000 / ROOM_TICK_HZ + (i % 2 ? 5 : -5), 1000);
  const n2 = r2.msgs('p1', 'snap').length / 2;
  assert.ok(Math.abs(n2 - SNAP_HZ) <= 1, `${n2} snaps/s with jitter`);
  const row = snaps.at(-1).p[0];
  assert.deepEqual(row.slice(0, 6), ['p1', 1.23, 0.5, -2.35, 0, 1]);
  // row[6]: when that state arrived (before any snapshot went out), not the snapshot time
  assert.ok(Number.isInteger(row[6]) && row[6] <= snaps[0].s, `sample time ${row[6]} vs first snap ${snaps[0].s}`);
});

test('room: malformed messages are ignored, st is clamped', () => {
  const r = makeRoom();
  r.room.addPlayer('p1', 'A');
  const bad = [null, undefined, 'x', 5, [], {}, { t: 5 }, { t: 'nope' }, { t: 'st', x: NaN, y: 0, z: 0, ry: 0 },
    { t: 'st', x: '1', y: 0, z: 0, ry: 0 }, { t: 'st' }, { t: 'pickup' }, { t: 'pickup', id: { a: 1 } },
    { t: 'hit', id: [] }, { t: 'bot', add: 'yes' }, { t: 'name', name: 42 }, { t: 'ping', c: 'x' }];
  for (const m of bad) r.room.handle('p1', m);
  r.room.handle('ghost', { t: 'start' });
  assert.equal(r.room.players.size, 1);
  assert.equal(r.room.phase, 'lobby');
  assert.equal(r.room.players.get('p1').name, 'A');
  assert.equal(r.msgs('p1', 'pong').length, 0);

  r.room.handle('p1', { t: 'st', x: 100, y: -5, z: -Infinity, ry: 0, a: 1 });
  assert.notEqual(r.room.players.get('p1').z, -Infinity, 'Infinity rejected');
  r.room.handle('p1', { t: 'st', x: 100, y: -5, z: -100, ry: 7, a: 9 });
  const p = r.room.players.get('p1');
  assert.deepEqual([p.x, p.y, p.z, p.a], [PLAY_LIMIT, 0, -PLAY_LIMIT, 0]);
  assert.ok(Math.abs(p.ry) <= Math.PI);
  r.room.handle('p1', { t: 'ping', c: 12.5 });
  assert.equal(r.last('p1', 'pong').c, 12.5);
});

test('room: names are cleaned, renames only outside rounds, full room refused', () => {
  const r = makeRoom();
  r.room.addPlayer('p1', '  <b>Al\u0007ice</b>  with a very long name ');
  assert.equal(r.room.players.get('p1').name, 'bAlice/b with a');
  r.room.addPlayer('p2', '');
  assert.equal(r.room.players.get('p2').name, 'Player 2');
  r.room.handle('p2', { t: 'name', name: 'Bo' });
  assert.equal(r.room.players.get('p2').name, 'Bo');
  r.room.handle('p1', { t: 'start' });
  r.room.handle('p2', { t: 'name', name: 'Nope' });
  assert.equal(r.room.players.get('p2').name, 'Bo');

  const colors = new Set([...r.room.players.values()].map((p) => p.color));
  assert.equal(colors.size, 2);
  for (let i = 3; i <= MAX_PLAYERS; i++) assert.equal(r.room.addPlayer(`p${i}`, `P${i}`), true);
  assert.equal(new Set([...r.room.players.values()].map((p) => p.color)).size, MAX_PLAYERS, 'distinct colors');
  assert.equal(r.room.addPlayer('p99', 'Extra'), false);
  assert.deepEqual(r.last('p99', 'err'), { t: 'err', msg: 'Room is full' });
});

test('room: ranking ties share a rank', () => {
  const r = makeRoom();
  for (const id of ['p1', 'p2', 'p3', 'p4']) r.room.addPlayer(id, id);
  const set = { p1: 100, p2: 300, p3: 100, p4: 0 };
  for (const [id, s] of Object.entries(set)) r.room.players.get(id).score = s;
  assert.deepEqual(
    r.room.ranking().map((x) => [x.id, x.rank]),
    [['p2', 1], ['p1', 2], ['p3', 2], ['p4', 4]],
  );
});
