// Air balloons: screenshot the first pink wave (always up high) and check the client can't take it standing.
// Usage: BASE_URL=http://localhost:47820/ node e2e/game-air-orbs.mjs
import { launch, openPage, shot, sleep, waitFor, BASE } from './game-lib.mjs';

const browser = await launch();
const { page, errors } = await openPage(browser, BASE);
await sleep(1200);
await page.fill('.menu-card input.field:not(.code-field)', 'Koschey');
await page.click('text=Solo practice');
await waitFor(page, () => window.__jj?.game?.players.size > 0);
await page.click('text=Start round');
await waitFor(page, () => window.__jj.game.phase === 'playing', null, 15000);
const rt = () => page.evaluate(() => window.__jj.game.session.now() - window.__jj.game.roundStart);
while ((await rt()) < 21500) await sleep(250);
const orbs = await page.evaluate(() => [...window.__jj.game.orbs.values()].map((o) => ({ k: o.k, y: o.y })));
console.log('orbs at 21.5 s:', JSON.stringify(orbs));
await shot(page, 'air-orbs');
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
