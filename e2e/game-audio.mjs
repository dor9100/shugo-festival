// Audio: after a user gesture the AudioContext runs, SOUND's files from sfx/manifest.json decode, music starts;
// mute toggles via the menu button and the M key (in game), persists in localStorage, shows a toast.
import { launch, openPage, sleep, waitFor, shot, BASE } from './game-lib.mjs';
const browser = await launch();
const { page, errors } = await openPage(browser, BASE);
await page.mouse.click(200, 200); // gesture on the 3D view
await waitFor(page, () => window.__app.audio.ctx && window.__app.audio.ctx.state === 'running', null, 5000);
await sleep(2500);
const a = await page.evaluate(() => ({ state: window.__app.audio.ctx.state, loaded: [...window.__app.audio.buffers.keys()], music: window.__app.audio.music && { slot: window.__app.audio.music.slot, file: !!window.__app.audio.music.src } }));
console.log('ctx', a.state, '| decoded', a.loaded.length, 'slots:', a.loaded.join(','), '| music', JSON.stringify(a.music));
await page.click('.menu-card .mute-btn');
await sleep(150);
const t1 = await page.evaluate(() => ({ toast: document.querySelector('.toast')?.textContent, stored: JSON.parse(localStorage.getItem('jj.settings.v1')).muted, out: window.__app.audio.out.gain.value }));
console.log('menu mute ->', JSON.stringify(t1));
await shot(page, 'menu-muted');
await page.fill('.menu-card input.field:not(.code-field)', 'Audio');
await page.click('text=Solo practice');
await waitFor(page, () => window.__jj && window.__jj.game);
await page.keyboard.press('KeyM');
await sleep(150);
const t2 = await page.evaluate(() => ({ toast: document.querySelector('.toast')?.textContent, stored: JSON.parse(localStorage.getItem('jj.settings.v1')).muted, hudBtnMuted: document.querySelector('.room-panel .mute-btn').classList.contains('is-muted') }));
console.log('M key ->', JSON.stringify(t2));
await page.reload();
await sleep(800);
const t3 = await page.evaluate(() => document.querySelector('.menu-card .mute-btn').classList.contains('is-muted'));
console.log('after reload menu button muted =', t3, '(expected false: last toggle was unmute)');
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
