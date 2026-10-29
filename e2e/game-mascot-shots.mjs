// Rigged-mascot / camera check: default camera mid-round, then (lobby, no lasers) backpedal (S), back-diagonal (S+A),
// side run (A), forward-diagonal (W+D) and a jump — each at the default camera and zoomed in.
// Usage: node e2e/game-mascot-shots.mjs  (BASE_URL to override)
import { launch, openPage, shot, sleep, waitFor, BASE } from './game-lib.mjs';
import { installAutopilot } from './game-autopilot.mjs';

const browser = await launch();
const { page, errors } = await openPage(browser, BASE);
await page.fill('.menu-card input.field:not(.code-field)', 'Pompom');
await page.click('text=Solo practice');
await waitFor(page, () => window.__jj && window.__jj.game && window.__jj.game.players.size > 0);
await page.click('text=Add bot');
await page.click('text=Add bot');
await sleep(1500); // mascot clip GLB

const state = () =>
  page.evaluate(() => {
    const L = window.__jj.game.local;
    return { y: +L.y.toFixed(2), speed: +L.speed.toFixed(2), ry: +((L.ry * 180) / Math.PI).toFixed(0), moveAngle: +((L.moveAngle * 180) / Math.PI).toFixed(0), backpedal: L.backpedal };
  });
const key = (type, code) => page.evaluate(([t, c]) => window.dispatchEvent(new KeyboardEvent(t, { code: c, key: c, bubbles: true })), [type, code]);
const zoom = (dist) => page.evaluate((d) => (window.__app.orbit.distGoal = d), dist);

async function pose(name, keys, from, holdMs = 380) {
  for (const z of [DEF, 6]) {
    await page.evaluate(([x, zz]) => window.__jj.game.teleport(x, zz, 0), from);
    await zoom(z);
    await sleep(500);
    for (const k of keys) await key('keydown', k);
    await sleep(holdMs);
    const st = await state();
    await shot(page, `mascot-${name}${z === 6 ? '-zoom' : ''}`);
    for (const k of keys) await key('keyup', k);
    console.log(`${name}${z === 6 ? ' (zoom)' : ''}:`, JSON.stringify(st));
    await sleep(300);
  }
}
await page.evaluate(() => window.__app.orbit.reset());
const DEF = await page.evaluate(() => window.__app.orbit.distGoal); // configured default distance
await pose('backpedal-S', ['KeyS'], [0, 4]);
await pose('backpedal-SA', ['KeyS', 'KeyA'], [-3, 3]);
await pose('siderun-A', ['KeyA'], [-3, 0]);
await pose('run-WD', ['KeyW', 'KeyD'], [3, -3]);
// jump: capture near the apex
for (const z of [DEF, 6]) {
  await page.evaluate(() => window.__jj.game.teleport(0, 0, 0));
  await zoom(z);
  await sleep(500);
  await key('keydown', 'Space');
  await page.waitForFunction(() => window.__jj.game.local.vy <= 0.6 && !window.__jj.game.local.grounded, null, { polling: 'raf', timeout: 3000 });
  const st = await state();
  await shot(page, `mascot-jump${z === 6 ? '-zoom' : ''}`);
  await key('keyup', 'Space');
  console.log(`jump${z === 6 ? ' (zoom)' : ''}:`, JSON.stringify(st));
  await sleep(700);
}
await zoom(DEF);

// default camera view mid-round
await page.click('text=Start round');
await waitFor(page, () => window.__jj.game.phase === 'playing', null, 15000);
await installAutopilot(page, { jump: true, chase: true });
await waitFor(page, () => window.__jj.game.beamList.length > 0 && window.__jj.game.orbs.size > 0, null, 40000);
await sleep(1200);
await shot(page, 'default-camera-midround');
const cam = await page.evaluate(() => ({ pitch: (window.__app.orbit.pitch * 180) / Math.PI, dist: window.__app.orbit.distGoal, fov: window.__app.world.camera.fov }));
console.log('camera', JSON.stringify(cam));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
