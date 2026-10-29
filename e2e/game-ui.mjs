// UI/controls checks on the fake session (?mode=fake, compressed round):
// ?room= prefill + inline join error, camera drag (left & right button) / wheel / Q, camera-relative W,
// mid-air Space -> "Cannot glide in current state.", results -> host "Play again" -> countdown.
import { launch, openPage, shot, sleep, waitFor, BASE } from './game-lib.mjs';

const ok = (c, msg) => console.log(`${c ? 'PASS' : 'FAIL'}: ${msg}`);
const browser = await launch();
const { page, errors } = await openPage(browser, `${BASE}?mode=fake&room=ZZZZZ&fakeRound=14&fakeResults=12`);
await sleep(500);
const pre = await page.evaluate(() => ({ code: document.querySelector('.code-field').value, focused: document.activeElement === document.querySelector('.code-field') }));
ok(pre.code === 'ZZZZZ' && pre.focused, `?room= pre-fills (${pre.code}) and focuses the code field`);
await page.fill('.menu-card input.field:not(.code-field)', 'Tester');
await page.click('button:has-text("Join")');
await waitFor(page, () => document.querySelector('.menu-error').classList.contains('show'), null, 5000);
ok(true, `join error shown inline: "${await page.textContent('.menu-error')}"`);
await shot(page, 'menu-join-error');

await page.click('text=Solo practice');
await waitFor(page, () => window.__jj && window.__jj.game);
await sleep(400);
const cam = () => page.evaluate(() => ({ yaw: window.__app.orbit.yaw, pitch: window.__app.orbit.pitch, dist: window.__app.orbit.distGoal }));
const c0 = await cam();
for (const button of ['left', 'right']) {
  await page.mouse.move(500, 450);
  await page.mouse.down({ button });
  await page.mouse.move(700, 400, { steps: 8 });
  await page.mouse.up({ button });
}
const c1 = await cam();
ok(Math.abs(c1.yaw - c0.yaw) > 1 && c1.pitch !== c0.pitch, `left+right drag orbit: yaw ${c0.yaw.toFixed(2)} -> ${c1.yaw.toFixed(2)}, pitch ${(c0.pitch * 57.3).toFixed(0)} -> ${(c1.pitch * 57.3).toFixed(0)} deg`);
await page.mouse.move(600, 500);
await page.mouse.wheel(0, 600);
await sleep(100);
const c2 = await cam();
ok(c2.dist > c1.dist && c2.dist <= 24, `wheel zoom out: ${c1.dist.toFixed(1)} -> ${c2.dist.toFixed(1)} (max 24)`);
await page.keyboard.down('KeyQ');
await sleep(400);
await page.keyboard.up('KeyQ');
const c3 = await cam();
ok(c3.yaw > c2.yaw + 0.4, `Q rotates yaw (${c2.yaw.toFixed(2)} -> ${c3.yaw.toFixed(2)})`);
// camera-relative movement: W moves along camera forward (sin yaw, cos yaw)
const p0 = await page.evaluate(() => ({ x: window.__jj.game.local.x, z: window.__jj.game.local.z, yaw: window.__app.orbit.yaw }));
await page.keyboard.down('KeyW');
await sleep(350);
await page.keyboard.up('KeyW');
await sleep(80);
const p1 = await page.evaluate(() => ({ x: window.__jj.game.local.x, z: window.__jj.game.local.z }));
const dx = p1.x - p0.x;
const dz = p1.z - p0.z;
const along = (dx * Math.sin(p0.yaw) + dz * Math.cos(p0.yaw)) / (Math.hypot(dx, dz) || 1);
ok(along > 0.95, `W moves along camera forward (cos angle ${along.toFixed(3)}, moved ${Math.hypot(dx, dz).toFixed(2)} m)`);
// mid-air Space -> glide message
await page.keyboard.press('Space');
await sleep(150);
await page.keyboard.press('Space');
await sleep(120);
const glide = await page.evaluate(() => ({ text: document.querySelector('.sys-msg').textContent, shown: document.querySelector('.sys-msg').classList.contains('show') }));
ok(glide.shown && glide.text === 'Cannot glide in current state.', `mid-air Space -> "${glide.text}"`);
await shot(page, 'glide-message');
// practice popups: default OFF, toggle in the Esc menu, persisted
await page.keyboard.press('Escape');
await sleep(150);
const pp0 = await page.evaluate(() => {
  const box = [...document.querySelectorAll('.esc-menu label')].find((l) => /Practice popups/.test(l.textContent))?.querySelector('input');
  return { exists: !!box, checked: box?.checked, stored: JSON.parse(localStorage.getItem('jj.settings.v1') || '{}').practicePopups };
});
ok(pp0.exists && pp0.checked === false && !pp0.stored, `Esc menu has "Practice popups (score numbers & hit vignette)", default off (${JSON.stringify(pp0)})`);
await page.click('.esc-menu label:has-text("Practice popups") input');
const pp1 = await page.evaluate(() => JSON.parse(localStorage.getItem('jj.settings.v1')).practicePopups);
await page.click('.esc-menu label:has-text("Practice popups") input');
const pp2 = await page.evaluate(() => JSON.parse(localStorage.getItem('jj.settings.v1')).practicePopups);
ok(pp1 === true && pp2 === false, `toggle persists (on -> ${pp1}, off -> ${pp2})`);
await page.keyboard.press('Escape');
// round -> results -> play again
await page.click('text=Start round');
await waitFor(page, () => window.__jj.game.phase === 'results', null, 40000);
await sleep(700);
await shot(page, 'results-fake');
await page.click('text=Play again');
await waitFor(page, () => window.__jj.game.phase === 'countdown', null, 5000);
ok(true, 'results -> Play again -> countdown');
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
