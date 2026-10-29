// Two players through the published site: host creates a P2P room, guest joins by code, both see each other move.
// Usage: node e2e/public-p2p.mjs [url]   (default https://dor9100.github.io/shugo-festival/)
import { launch, openPage, shot, sleep, waitFor } from './game-lib.mjs';

const URL = process.argv[2] || 'https://dor9100.github.io/shugo-festival/';
const browser = await launch();
const A = await openPage(browser, URL, { width: 1280, height: 720 });
await sleep(1500);
await A.page.fill('.menu-card input.field:not(.code-field)', 'Host');
await A.page.click('text=Create room');
await waitFor(A.page, () => window.__jj?.game?.session?.code, null, 20000);
const { code, mode } = await A.page.evaluate(() => ({ code: window.__jj.game.session.code, mode: window.__jj.game.session.mode }));
const invite = await A.page.evaluate(() => window.__jj.game.invite ?? null);
console.log('host room', code, 'mode', mode, 'invite', invite);

const B = await openPage(browser, `${URL}?room=${code}`, { width: 1280, height: 720 });
await sleep(1500);
await B.page.fill('.menu-card input.field:not(.code-field)', 'Friend');
await B.page.click('button.btn-teal:has-text("Join")');
try {
  await waitFor(B.page, () => window.__jj?.game?.players?.size === 2, null, 25000);
} catch (e) {
  await shot(B.page, 'public-guest-fail');
  console.log('guest menu error:', await B.page.evaluate(() => document.querySelector('.menu-err, .err, [class*=err]')?.textContent || '(none)'));
  console.log('guest state:', await B.page.evaluate(() => ({ game: !!window.__jj?.game, players: window.__jj?.game?.players?.size })));
  console.log('errors B:', B.errors.join(' | ') || 'none');
  throw e;
}
await waitFor(A.page, () => window.__jj.game.players.size === 2, null, 10000);
console.log('both in room: players =', await A.page.evaluate(() => window.__jj.game.players.size));

// guest walks right for 1 s; host must see the guest move
const guestId = await B.page.evaluate(() => window.__jj.game.you);
const seen0 = await A.page.evaluate((id) => ({ ...window.__jj.game.players.get(id).mascot.root.position }), guestId);
await B.page.keyboard.down('KeyD');
await sleep(1000);
await B.page.keyboard.up('KeyD');
await sleep(400);
const seen1 = await A.page.evaluate((id) => ({ ...window.__jj.game.players.get(id).mascot.root.position }), guestId);
console.log('host sees guest move:', Math.hypot(seen1.x - seen0.x, seen1.z - seen0.z).toFixed(2), 'm', 'ping', await B.page.evaluate(() => Math.round(window.__jj.game.session.ping)), 'ms');

await A.page.click('text=Start round');
await waitFor(B.page, () => window.__jj.game.phase === 'playing', null, 15000);
await sleep(1500);
await shot(B.page, 'public-guest');
console.log('guest phase', await B.page.evaluate(() => window.__jj.game.phase));
console.log('errors A:', A.errors.length ? A.errors.join('\n') : 'none');
console.log('errors B:', B.errors.length ? B.errors.join('\n') : 'none');
await browser.close();
