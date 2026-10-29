// Two browser contexts in one room via SERVER mode (BASE_URL=http://localhost:47820/, server: PORT=47820 node server/index.js).
// Verifies: join via invite link, both see each other move, same beams at the same room time, consistent scores,
// leave -> roster update, server shutdown -> back to menu with a message (if KILL_CMD given, run manually).
import { launch, openPage, shot, sleep, waitFor, sent } from './game-lib.mjs';
import { installAutopilot } from './game-autopilot.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:47820/';
const MODE = process.env.MODE || 'server';
const browser = await launch();
const A = await openPage(browser, `${BASE}?mode=${MODE}`, { width: 1280, height: 760 });
const ok = (c, msg) => console.log(`${c ? 'PASS' : 'FAIL'}: ${msg}`);

await A.page.fill('.menu-card input.field:not(.code-field)', 'Alice');
await A.page.click('text=Create room');
await waitFor(A.page, () => window.__jj && window.__jj.game && window.__jj.game.players.size > 0, null, 20000);
const code = await A.page.evaluate(() => window.__jj.game.code);
const invite = await A.page.evaluate(() => window.__jj.game.inviteUrl);
console.log('room', code, 'invite', invite);

const B = await openPage(browser, invite, { width: 1280, height: 760 });
const prefilled = await B.page.inputValue('.code-field');
ok(prefilled === code, `invite link pre-fills the code (${prefilled})`);
await B.page.fill('.menu-card input.field:not(.code-field)', 'Bob');
await B.page.click('button:has-text("Join")');
await waitFor(B.page, () => window.__jj && window.__jj.game && window.__jj.game.players.size >= 2, null, 20000);
await waitFor(A.page, () => window.__jj.game.players.size >= 2, null, 10000);
ok(true, 'both clients see 2 players');
const nonHostUi = await B.page.evaluate(() => getComputedStyle(document.querySelector('.lp-wait')).display !== 'none');
ok(nonHostUi, 'non-host sees "Waiting for host…"');

// ---- movement visible on the other client (lobby: free run)
const before = await B.page.evaluate(() => {
  const g = window.__jj.game;
  const a = [...g.players.values()].find((p) => p.name === 'Alice');
  return { x: a.mascot.root.position.x, z: a.mascot.root.position.z };
});
await A.page.keyboard.down('KeyD');
await sleep(900);
await A.page.keyboard.up('KeyD');
await sleep(500);
const aPos = await A.page.evaluate(() => ({ x: window.__jj.game.local.x, z: window.__jj.game.local.z }));
const seen = await B.page.evaluate(() => {
  const g = window.__jj.game;
  const a = [...g.players.values()].find((p) => p.name === 'Alice');
  return { x: a.mascot.root.position.x, z: a.mascot.root.position.z };
});
const moved = Math.hypot(seen.x - before.x, seen.z - before.z);
const err = Math.hypot(seen.x - aPos.x, seen.z - aPos.z);
ok(moved > 2 && err < 0.25, `Bob sees Alice move (moved ${moved.toFixed(2)} m, error vs Alice's own pos ${err.toFixed(3)} m)`);
await shot(A.page, 'multi-lobby-A');
await shot(B.page, 'multi-lobby-B');

// ---- start round, same beams
await A.page.click('text=Start round');
await waitFor(B.page, () => window.__jj.game.phase === 'countdown', null, 10000);
ok(true, 'Bob sees countdown');
await waitFor(A.page, () => window.__jj.game.phase === 'playing', null, 10000);
await installAutopilot(A.page, { jump: true, chase: true });
await installAutopilot(B.page, { jump: true, chase: true });
await waitFor(A.page, () => window.__jj.game.beamList.length > 0, null, 20000);
await sleep(300);
// sample both clocks + beam lists at (nearly) the same wall time
const [ba, bb] = await Promise.all(
  [A.page, B.page].map((p) =>
    p.evaluate(() => {
      const g = window.__jj.game;
      const now = g.session.now();
      return { now, wall: Date.now(), beams: g.beamList.map((b) => ({ id: b.id, ax: b.ax, from: b.from, to: b.to, t0: b.t0 })) };
    }),
  ),
);
const sameBeams = JSON.stringify(ba.beams) === JSON.stringify(bb.beams);
ok(sameBeams, `same beam descriptors on both (${ba.beams.length} beams, t0 ${ba.beams.map((b) => b.t0).join(',')})`);
const skew = ba.now - ba.wall - (bb.now - bb.wall);
ok(Math.abs(skew) < 40, `room clocks agree within ${skew.toFixed(1)} ms (wall-adjusted)`);

// ---- play ~35 s, compare scores
const t0 = Date.now();
let shotMid = false;
while (Date.now() - t0 < 35000) {
  await sleep(1000);
  if (!shotMid && Date.now() - t0 > 12000) {
    shotMid = true;
    await shot(A.page, 'multi-playing-A');
    await shot(B.page, 'multi-playing-B');
  }
}
await sleep(500);
const [sa, sb] = await Promise.all([A.page, B.page].map((p) => p.evaluate(() => window.__jj.game.playerList().map((x) => `${x.name}:${x.score}`).sort().join(' '))));
ok(sa === sb, `scores consistent: A[${sa}] B[${sb}]`);
const claimsA = (await sent(A.page)).filter((m) => m.t === 'pickup' || m.t === 'hit').length;
const claimsB = (await sent(B.page)).filter((m) => m.t === 'pickup' || m.t === 'hit').length;
console.log('claims A', claimsA, 'B', claimsB);

// ---- Bob leaves via Esc menu
await B.page.keyboard.press('Escape');
await B.page.click('text=Leave room');
await waitFor(B.page, () => !document.querySelector('.menu-overlay').classList.contains('hidden'), null, 5000);
await waitFor(A.page, () => window.__jj.game.players.size === 1, null, 10000);
ok(true, 'Bob left via Esc > Leave room; Alice roster updated');

console.log('errors A:', A.errors.length ? A.errors.join('\n') : 'none');
console.log('errors B:', B.errors.length ? B.errors.join('\n') : 'none');
if (process.env.KEEP_A) {
  console.log('A kept open; kill the server now...');
  await waitFor(A.page, () => !document.querySelector('.menu-overlay').classList.contains('hidden'), null, 60000).catch(() => {});
  const msg = await A.page.textContent('.menu-error');
  ok(!!msg, `server shutdown -> menu with message: "${msg}"`);
  await shot(A.page, 'multi-server-closed');
}
await browser.close();
