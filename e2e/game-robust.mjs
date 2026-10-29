// Robustness (server mode): long main-thread stall (like a background tab) -> no teleport, state upload resumes;
// small window layout; server shutdown -> back to menu with a message.
// Usage: BASE_URL=http://localhost:47820/ SERVER_PID=<pid> node e2e/game-robust.mjs
import { launch, openPage, shot, sleep, waitFor } from './game-lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:47820/';
const ok = (c, msg) => console.log(`${c ? 'PASS' : 'FAIL'}: ${msg}`);
const browser = await launch();
const { page, errors } = await openPage(browser, `${BASE}?mode=server`, { width: 1280, height: 760 });
await page.fill('.menu-card input.field:not(.code-field)', 'Robust');
await page.click('text=Create room');
await waitFor(page, () => window.__jj && window.__jj.game && window.__jj.game.players.size > 0, null, 15000);
await sleep(500);

// ---- stall: hold D, block the main thread 2.5 s, release
await page.evaluate(() => {
  window.__app.orbit.reset(); // yaw 0: D moves toward -x
  window.__jj.game.teleport(6.5, 0, 0);
});
await sleep(300);
const p0 = await page.evaluate(() => ({ x: window.__jj.game.local.x, st: window.__jj.game.stats.stSent, v: window.__jj.cfg.MOVE_SPEED }));
await page.keyboard.down('KeyD');
await sleep(100);
await page.evaluate(() => {
  const end = performance.now() + 2500;
  while (performance.now() < end);
});
await sleep(60);
await page.keyboard.up('KeyD');
await sleep(600);
const p1 = await page.evaluate(() => ({ x: window.__jj.game.local.x, st: window.__jj.game.stats.stSent }));
const moved = Math.abs(p1.x - p0.x);
// uncapped catch-up would run ~2.66 s x MOVE_SPEED (into the far wall); capped: ~0.2 s sim + ~0.2 s real input
ok(moved < p0.v * 0.65, `after a 2.5 s stall the player moved ${moved.toFixed(2)} m (< ${(p0.v * 0.65).toFixed(1)} m: no catch-up teleport)`);
ok(p1.st - p0.st > 10, `state upload continued (${p1.st - p0.st} st msgs)`);

// ---- small window
await page.setViewportSize({ width: 820, height: 560 });
await sleep(400);
await shot(page, 'small-window-lobby');
const overlap = await page.evaluate(() => {
  const a = document.querySelector('.room-panel').getBoundingClientRect();
  const b = document.querySelector('.lobby-panel').getBoundingClientRect();
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
});
ok(!overlap, 'room panel and lobby panel do not overlap at 820x560');
await page.setViewportSize({ width: 1280, height: 760 });

// ---- server shutdown
if (process.env.SERVER_PID) {
  process.kill(Number(process.env.SERVER_PID));
  await waitFor(page, () => !document.querySelector('.menu-overlay').classList.contains('hidden'), null, 15000).catch(() => {});
  const back = await page.evaluate(() => ({ menu: !document.querySelector('.menu-overlay').classList.contains('hidden'), msg: document.querySelector('.menu-error').textContent, jj: !!window.__jj }));
  ok(back.menu && back.msg && !back.jj, `server killed -> menu with message "${back.msg}"`);
  await shot(page, 'server-closed');
}
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
