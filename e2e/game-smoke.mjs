// Smoke: menu -> solo -> lobby (+bots) -> countdown -> playing HUD. Screenshots + console errors.
// Usage: node e2e/game-smoke.mjs   (vite dev server on :5175)
import { launch, openPage, glInfo, shot, sleep, waitFor, BASE } from './game-lib.mjs';

const browser = await launch();
const { page, errors } = await openPage(browser, `${BASE}${process.env.QS || ''}`);
console.log('GL renderer:', await glInfo(page));
await sleep(1200);
await page.fill('.menu-card input.field:not(.code-field)', 'Koschey');
await shot(page, 'menu');

await page.click('text=Solo practice');
await waitFor(page, () => window.__jj && window.__jj.game && window.__jj.game.players.size > 0);
await page.click('text=Add bot');
await page.click('text=Add bot');
await sleep(400);
// run around a little in the lobby
await page.keyboard.down('KeyW');
await sleep(500);
await page.keyboard.up('KeyW');
await sleep(600);
await shot(page, 'lobby');

await page.click('text=Start round');
await waitFor(page, () => window.__jj.game.phase === 'countdown');
await sleep(2600);
await shot(page, 'countdown');
await waitFor(page, () => window.__jj.game.phase === 'playing', null, 10000);
await sleep(1600);
await shot(page, 'playing-start');
const st = await page.evaluate(() => ({ phase: window.__jj.game.phase, stats: window.__jj.game.stats, players: window.__jj.game.players.size }));
console.log('state', JSON.stringify(st));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
