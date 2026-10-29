// Real-browser checks of client/src/net/session.js (Playwright chromium + test/harness page served by Vite).
// The P2P part needs the PeerJS cloud signalling server (internet); it is skipped, with the reason, if unreachable.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { freePort, ROOT, startServer } from './_util.js';
const PUBLIC_URL = 'https://dor9100.github.io/shugo-festival/'; // mirrors client/src/net/session.js

let server;
let vite;
let browser;
let baseUrl;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(page, fn, arg, timeout = 15000, label = 'condition') {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
  } catch {
    throw new Error(`timed out waiting for ${label}`);
  }
}

async function openPage(query = '') {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`${baseUrl}/${query}`);
  await page.waitForFunction(() => window.harnessReady === true);
  return page;
}

async function peerCloudReachable() {
  try {
    const res = await fetch('https://0.peerjs.com/peerjs/id', { signal: AbortSignal.timeout(6000) });
    return res.ok;
  } catch {
    return false;
  }
}

before(async () => {
  server = await startServer();
  const port = await freePort();
  vite = await createServer({
    configFile: false,
    root: path.join(ROOT, 'test/harness'),
    logLevel: 'error',
    resolve: { alias: { '@shared': path.join(ROOT, 'shared') } },
    optimizeDeps: { include: ['peerjs'] },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      fs: { allow: [ROOT] },
      proxy: {
        '/ws': { target: `ws://127.0.0.1:${server.port}`, ws: true },
        '/api': `http://127.0.0.1:${server.port}`,
      },
    },
  });
  await vite.listen();
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
});

after(async () => {
  await browser?.close();
  await vite?.close();
  await server?.stop();
});

test('browser: P2P is the default mode; ?mode=server opts in; local invites point at the public site', async () => {
  const page = await openPage();
  assert.equal(await page.evaluate(() => net.detectMode()), 'p2p');
  assert.equal(await page.evaluate(() => net.inviteLink('XYZ23')), `${PUBLIC_URL}?room=XYZ23`);
  const forced = await openPage('?mode=server&room=ABCDE');
  assert.equal(await forced.evaluate(() => net.detectMode()), 'server');
  assert.match(await forced.evaluate(() => net.inviteLink('XYZ23')), /^http:\/\/127\.0\.0\.1:\d+\/.*\?room=XYZ23&mode=server$/);
  await page.context().close();
  await forced.context().close();
});

test('browser: solo session (local room, loopback, bots, worker ticker)', async () => {
  const page = await openPage();
  const i = await page.evaluate(() => net.create({ name: 'Solo', mode: 'solo' }));
  assert.equal(typeof i, 'number', JSON.stringify(i));
  let info = await page.evaluate((i) => net.info(i), i);
  assert.equal(info.mode, 'solo');
  assert.equal(info.code, 'SOLO');
  assert.equal(info.isHost, true);
  assert.equal(info.ping, 0);
  assert.equal(info.counts.welcome, 1, 'welcome is delivered to handlers registered after await');
  await page.evaluate((i) => net.send(i, { t: 'bot', add: true }), i);
  await until(page, (i) => net.info(i).last.roster?.players.length === 2, i, 5000, 'bot in roster');
  await page.evaluate((i) => net.send(i, { t: 'start' }), i);
  await until(page, (i) => net.info(i).last.phase?.phase === 'countdown', i, 5000, 'countdown');
  const before = (await page.evaluate((i) => net.info(i), i)).counts.snap ?? 0;
  await wait(1000);
  info = await page.evaluate((i) => net.info(i), i);
  assert.ok(info.counts.snap - before >= 12, `~20 snaps/s expected, got ${info.counts.snap - before}`);
  assert.equal(info.last.spawn.id, info.you);
  await page.evaluate((i) => net.close(i), i);
  await page.context().close();
});

test('browser: server session (create/join, roster, clock sync, errors)', async () => {
  const a = await openPage();
  const b = await openPage();
  const ia = await a.evaluate(() => net.create({ name: 'Ann', mode: 'server' }));
  assert.equal(typeof ia, 'number', JSON.stringify(ia));
  const A = await a.evaluate((i) => net.info(i), ia);
  assert.equal(A.mode, 'server');
  assert.equal(A.isHost, true);
  assert.match(A.code, /^[A-Z2-9]{5}$/);

  const ib = await b.evaluate((code) => net.join({ code: code.toLowerCase(), name: 'Ben', mode: 'server' }), A.code);
  assert.equal(typeof ib, 'number', JSON.stringify(ib));
  await until(a, (i) => net.info(i).last.roster?.players.length === 2, ia, 5000, 'roster of 2');
  const B = await b.evaluate((i) => net.info(i), ib);
  assert.equal(B.isHost, false);
  assert.equal(B.code, A.code);

  await wait(2200); // fast pings for 2 s
  const [nowA, nowB] = await Promise.all([a.evaluate((i) => net.info(i).now, ia), b.evaluate((i) => net.info(i).now, ib)]);
  assert.ok(Math.abs(nowA - nowB) < 40, `room clocks differ by ${nowA - nowB} ms`);
  assert.ok((await b.evaluate((i) => net.info(i).ping, ib)) >= 0);

  // B's state shows up in A's snapshots
  await b.evaluate((i) => net.send(i, { t: 'st', x: 2.5, y: 0, z: -1.25, ry: 1, a: 1 }), ib);
  await until(a, ([i, id]) => net.info(i).last.snap?.p.some((r) => r[0] === id && r[1] === 2.5 && r[3] === -1.25), [ia, B.you], 3000, 'B in snapshot');

  const bad = await b.evaluate(() => net.join({ code: 'ZZZZZ', name: 'X', mode: 'server' }));
  assert.deepEqual(bad, { error: 'Room not found — check the code' });
  const malformed = await b.evaluate(() => net.join({ code: 'hi', name: 'X' }));
  assert.match(malformed.error, /5 letters/);

  // host leaves -> B becomes host
  await a.evaluate((i) => net.close(i), ia);
  await until(b, (i) => net.info(i).isHost === true, ib, 5000, 'host migration');
  await a.context().close();
  await b.context().close();
});

test('browser: P2P via PeerJS (two browser contexts)', async (t) => {
  if (!(await peerCloudReachable())) {
    t.skip('PeerJS cloud signalling (0.peerjs.com) unreachable from this machine');
    return;
  }
  const host = await openPage('?mode=p2p');
  const guest = await openPage('?mode=p2p');
  const ih = await host.evaluate(() => net.create({ name: 'Hosty' }));
  assert.equal(typeof ih, 'number', `host failed: ${JSON.stringify(ih)}`);
  const H = await host.evaluate((i) => net.info(i), ih);
  assert.equal(H.mode, 'p2p');
  assert.equal(H.isHost, true);
  assert.equal(H.ping, 0);
  assert.match(H.code, /^[A-Z2-9]{5}$/);

  const ig = await guest.evaluate((code) => net.join({ code, name: 'Guesty' }), H.code);
  assert.equal(typeof ig, 'number', `join failed: ${JSON.stringify(ig)}`);
  const G = await guest.evaluate((i) => net.info(i), ig);
  assert.equal(G.mode, 'p2p');
  assert.equal(G.isHost, false);
  assert.equal(G.welcome.players.length, 2);
  await until(host, (i) => net.info(i).last.roster?.players.length === 2, ih, 5000, 'host roster of 2');

  // guest -> host state, host -> guest snapshots, clock sync
  await guest.evaluate((i) => net.send(i, { t: 'st', x: -3, y: 0, z: 4, ry: 0, a: 1 }), ig);
  await until(host, ([i, id]) => net.info(i).last.snap?.p.some((r) => r[0] === id && r[1] === -3 && r[3] === 4), [ih, G.you], 5000, 'guest in host snapshot');
  await wait(2200);
  const [nowH, nowG] = await Promise.all([host.evaluate((i) => net.info(i).now, ih), guest.evaluate((i) => net.info(i).now, ig)]);
  assert.ok(Math.abs(nowH - nowG) < 60, `room clocks differ by ${nowH - nowG} ms`);
  const gInfo = await guest.evaluate((i) => net.info(i), ig);
  assert.ok(gInfo.counts.pong > 0 && gInfo.ping >= 0, 'guest gets pongs and has a ping');

  // host starts a round; guest follows the phase and gets its spawn
  await host.evaluate((i) => net.send(i, { t: 'start' }), ih);
  await until(guest, (i) => net.info(i).last.phase?.phase === 'countdown', ig, 5000, 'guest countdown');
  await until(guest, (i) => net.info(i).counts.spawn >= 2, ig, 5000, 'guest spawn');

  // wrong code -> readable error
  const third = await openPage('?mode=p2p');
  const bad = await third.evaluate(() => net.join({ code: 'QQQQQ', name: 'Nobody' }));
  assert.deepEqual(bad, { error: 'Room not found — check the code' });
  await third.context().close();

  // host leaves -> guest gets `close`
  await host.evaluate((i) => net.close(i), ih);
  await until(guest, (i) => net.info(i).counts.close === 1, ig, 10000, 'guest close event');
  const reason = await guest.evaluate((i) => net.info(i).last.close.reason, ig);
  assert.match(reason, /host/i);
  await host.context().close();
  await guest.context().close();
});
