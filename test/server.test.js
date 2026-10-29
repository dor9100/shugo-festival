// Integration: the real server process on a localhost port, 3 ws clients, one full (time-scaled) round.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { beamTimes } from '../shared/lasers.js';
import { startServer, wsClient } from './_util.js';

const TIME_SCALE = 20; // 166.5 s round -> ~8.3 s real
let server;
let wsUrl;

before(async () => {
  server = await startServer({ timeScale: TIME_SCALE });
  wsUrl = `ws://127.0.0.1:${server.port}/ws`;
});
after(() => server?.stop());

test('server: /api/info and static fallback', async () => {
  const info = await (await fetch(`${server.url}/api/info`)).json();
  assert.equal(info.server, true);
  assert.equal(typeof info.version, 'string');
  const page = await fetch(`${server.url}/some/spa/route`);
  assert.ok(page.status === 200 || page.status === 404);
  if (page.status === 200) assert.match(page.headers.get('content-type'), /text\/html/);
  const asset = await fetch(`${server.url}/missing-file.js`);
  assert.equal(asset.status, 404);
  const traversal = await fetch(`${server.url}/..%2f..%2fpackage.json`);
  assert.notEqual(traversal.status, 200);
});

test('server: 3 clients create/join/start/play to results', { timeout: 60000 }, async () => {
  const A = wsClient(wsUrl);
  const B = wsClient(wsUrl);
  const C = wsClient(wsUrl);
  const X = wsClient(wsUrl);
  await Promise.all([A.opened, B.opened, C.opened, X.opened]);

  A.send({ t: 'create', name: 'Ann', v: 1 });
  const wa = await A.waitFor((m) => m.t === 'welcome', 5000, 'A welcome');
  assert.match(wa.code, /^[A-Z2-9]{5}$/);
  assert.equal(wa.hostId, wa.you);

  B.send({ t: 'join', code: wa.code.toLowerCase(), name: 'Ben', v: 1 });
  C.send({ t: 'join', code: wa.code, name: 'Cat', v: 1 });
  X.send({ t: 'join', code: 'ZZZZZ', name: 'Nobody', v: 1 });
  const [wb, wc] = await Promise.all([
    B.waitFor((m) => m.t === 'welcome', 5000, 'B welcome'),
    C.waitFor((m) => m.t === 'welcome', 5000, 'C welcome'),
  ]);
  assert.deepEqual(await X.waitFor((m) => m.t === 'err'), { t: 'err', msg: 'Room not found — check the code' });
  assert.equal(wb.code, wa.code);
  await A.waitFor((m) => m.t === 'roster' && m.players.length === 3, 5000, 'roster of 3');

  // garbage doesn't hurt
  A.ws.send('not json');
  A.ws.send(Buffer.from([1, 2, 3]));
  A.send({ t: 'st', x: 'NaN' });
  B.send({ t: 'start' }); // not host
  A.send({ t: 'ping', c: 1 });
  await A.waitFor((m) => m.t === 'pong', 3000, 'pong');

  A.send({ t: 'start' });
  await Promise.all([A, B, C].map((c) => c.waitFor((m) => m.t === 'phase' && m.phase === 'countdown', 3000, 'countdown')));
  assert.equal(B.of('phase').filter((m) => m.phase === 'countdown').length, 1);
  await Promise.all([A, B, C].map((c) => c.waitFor((m) => m.t === 'spawn' && m.id === (c === A ? wa : c === B ? wb : wc).you, 3000, 'spawn')));
  await B.waitFor((m) => m.t === 'phase' && m.phase === 'playing', 5000, 'playing');

  // B and C each claim a balloon (state first, then the claim; same socket keeps the order)
  const claim = async (client, who, nth) => {
    await client.waitFor(() => client.of('orb').length > nth, 5000, 'orbs');
    const orb = client.of('orb')[nth];
    client.send({ t: 'st', x: orb.x, y: orb.y > 1 ? 0.9 : 0, z: orb.z, ry: 0, a: orb.y > 1 ? 2 : 1 }); // jump for air balloons
    client.send({ t: 'pickup', id: orb.id });
    return client.waitFor((m) => m.t === 'score' && m.id === who && m.why === 'orb', 3000, `${who} orb score`);
  };
  const [sb, sc] = await Promise.all([claim(B, wb.you, 0), claim(C, wc.you, 1)]);
  assert.ok(sb.score >= 50 && sc.score >= 50);

  // C claims a laser hit on a beam that's live right now (room time from the latest snapshot)
  const beam = await (async () => {
    for (;;) {
      const snap = C.of('snap').at(-1);
      const live = C.of('laser').map((m) => m.l).find((b) => b.t0 <= snap.s && beamTimes(b).tGone - snap.s > 2500);
      if (live) return live;
      await C.waitFor((m) => m.t === 'snap' && m.s > snap.s, 3000, 'next snap');
    }
  })();
  const before = C.of('score').filter((m) => m.id === wc.you).at(-1).score;
  C.send({ t: 'hit', id: beam.id });
  C.send({ t: 'hit', id: beam.id });
  const hit = await C.waitFor((m) => m.t === 'score' && m.id === wc.you && m.why === 'laser', 3000, 'laser score');
  assert.equal(hit.score, before - 20);

  const res = await A.waitFor((m) => m.t === 'results', 20000, 'results');
  assert.equal(res.ranking.length, 3);
  const byId = Object.fromEntries(res.ranking.map((r) => [r.id, r]));
  assert.ok(byId[wb.you].score >= 50);
  assert.equal(C.of('score').filter((m) => m.id === wc.you && m.why === 'laser').length, 1, 'one hit per beam');
  for (const c of [A, B, C]) {
    assert.ok(c.of('laser').length > 20, 'lasers announced');
    assert.ok(c.of('snap').length > 50, 'snapshots');
    assert.ok(c.of('bomb').length >= 2 && c.of('boom').length >= 2, 'bomb waves');
  }
  await A.waitFor((m) => m.t === 'phase' && m.phase === 'lobby', 5000, 'back to lobby');

  // leaving: B drops, then the host leaves -> C is host
  B.close();
  await A.waitFor((m) => m.t === 'roster' && m.players.length === 2, 3000, 'roster after B left');
  A.close();
  const roster = await C.waitFor((m) => m.t === 'roster' && m.players.length === 1, 3000, 'roster after A left');
  assert.equal(roster.hostId, wc.you);
  C.close();
  X.close();
});

test('server --dev: Vite middleware, game ws and HMR ws share one port', { timeout: 60000 }, async () => {
  const dev = await startServer({ dev: true });
  try {
    const vite = await fetch(`${dev.url}/@vite/client`);
    assert.equal(vite.status, 200);
    assert.match(vite.headers.get('content-type'), /javascript/);
    const page = await fetch(`${dev.url}/`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('/@vite/client'), 'index.html is transformed by Vite');
    assert.equal((await (await fetch(`${dev.url}/api/info`)).json()).server, true);

    const game = wsClient(`ws://127.0.0.1:${dev.port}/ws`);
    await game.opened;
    game.send({ t: 'create', name: 'Dev', v: 1 });
    assert.equal((await game.waitFor((m) => m.t === 'welcome')).phase, 'lobby');
    game.close();

    const hmr = new WebSocket(`ws://127.0.0.1:${dev.port}/`, 'vite-hmr');
    const first = await new Promise((resolve, reject) => {
      hmr.once('message', (d) => resolve(JSON.parse(d)));
      hmr.once('error', reject);
    });
    assert.equal(first.type, 'connected');
    hmr.close();
  } finally {
    await dev.stop();
  }
});
