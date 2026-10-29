// Auto quality: throttle the browser so frames get slow, expect the governor to step down; then unthrottle.
import { launch, openPage, sleep, waitFor, BASE } from './game-lib.mjs';
const browser = await launch();
const { page, errors } = await openPage(browser, BASE, { width: 1600, height: 900 });
await sleep(1200);
await page.fill('.menu-card input.field:not(.code-field)', 'Perf');
await page.click('text=Solo practice');
await waitFor(page, () => window.__jj?.game?.players.size > 0);
await page.keyboard.press('F3');
await sleep(5000);
const lvl = () => page.evaluate(() => window.__app.autoQuality.level);
console.log('start level:', await lvl());
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 25 });
const t0 = Date.now();
const seen = [];
while (Date.now() - t0 < 30000) {
  const l = await lvl();
  if (seen.at(-1) !== l) seen.push(l);
  await sleep(500);
}
console.log('levels while throttled:', seen.join(' -> '));
console.log('toast:', await page.evaluate(() => document.querySelector('.toast')?.textContent || ''));
console.log('fps label:', await page.evaluate(() => [...document.querySelectorAll('div')].find((d) => / fps · /.test(d.textContent) && d.children.length === 0)?.textContent));
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
