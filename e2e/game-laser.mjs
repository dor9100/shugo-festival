// Laser test against the real solo Room (or BASE_URL / QS):
//  (1) stand still through the first beam -> a `hit` claim must be sent;
//  (2) standing jumps: autopilot plans the takeoff from the live config -> NO `hit` for jumped beams
//      (skipped if the config makes a standing jump impossible: slack < 0);
//  (3) running jumps: autopilot runs INTO each approaching beam and jumps -> NO `hit` for jumped beams.
import { launch, openPage, glInfo, shot, sleep, waitFor, sent, BASE } from './game-lib.mjs';
import { installAutopilot, setAuto, standingSlack } from './game-autopilot.mjs';

const N = Number(process.env.JUMP_BEAMS || 4);
const browser = await launch();
const { page, errors } = await openPage(browser, `${BASE}${process.env.QS || ''}`);
console.log('GL:', await glInfo(page));
await page.fill('.menu-card input.field:not(.code-field)', 'Jumper');
await page.click('text=Solo practice');
await waitFor(page, () => window.__jj && window.__jj.game && window.__jj.game.players.size > 0);
const slack = await standingSlack(page);
console.log(
  `config: feet above clearance ${slack.clear.toFixed(2)} m for ${slack.aboveMs.toFixed(0)} ms; ` +
    Object.entries(slack.tiers)
      .map(([k, t]) => `${k} beams ${t.spd} m/s: contact ${t.contactMs.toFixed(0)} ms -> standing slack ${t.slackMs.toFixed(0)} ms, running-into slack ${t.runSlackMs.toFixed(0)} ms`)
      .join('; '),
);
await page.click('text=Start round');
await waitFor(page, () => window.__jj.game.phase === 'playing', null, 15000);
await installAutopilot(page, { jump: false });

// ---------- 1) stand still through the first beam
await waitFor(page, () => window.__jj.game.beamList.length > 0, null, 30000);
const first = await page.evaluate(() => window.__jj.game.beamList[0].id);
await waitFor(
  page,
  (id) => {
    const g = window.__jj.game;
    const b = g.beams.get(id);
    if (!b) return true;
    const s = window.__jj.beamState(b, g.session.now());
    return s && Math.abs(s.pos - (b.ax === 'x' ? g.local.x : g.local.z)) < 0.9;
  },
  first,
  20000,
);
await shot(page, 'laser-standing-hit');
await waitFor(page, (id) => window.__jj.sent.some((m) => m.t === 'hit' && m.id === id) || !window.__jj.game.beams.has(id), first, 15000);
await sleep(400);
const firstHit = (await sent(page)).some((m) => m.t === 'hit' && m.id === first);
console.log(`STAND STILL: hit sent for beam ${first}: ${firstHit ? 'YES (expected)' : 'NO (BUG)'}`);
const popups = await page.evaluate(() => ({
  on: JSON.parse(localStorage.getItem('jj.settings.v1') || '{}').practicePopups === true,
  vignette: document.querySelector('.hit-vignette').classList.contains('pulse'),
}));
console.log(`practice popups ${popups.on ? 'ON' : 'OFF (default)'}: red vignette after the hit: ${popups.vignette ? 'yes' : 'no'} ${popups.on === popups.vignette ? '(expected)' : '(BUG)'}`);

async function phase(name, opts, wantJumps) {
  await page.evaluate(() => {
    window.__auto.jumped.clear();
    window.__auto.unjumpable.clear();
    window.__auto.log.length = 0;
  });
  await setAuto(page, opts);
  const t0 = Date.now();
  let shotTaken = false;
  while (Date.now() - t0 < 50000) {
    const n = await page.evaluate(() => window.__auto.log.filter((l) => !l.unjumpable).length);
    if (n >= wantJumps) break;
    if (!shotTaken) {
      shotTaken = await page
        .waitForFunction(
          () => {
            const jj = window.__jj;
            const g = jj.game;
            if (g.local.y < 0.3) return false;
            return g.beamList.some((b) => {
              const s = jj.beamState(b, g.session.now());
              return s && Math.abs(s.pos - (b.ax === 'x' ? g.local.x : g.local.z)) < 0.55;
            });
          },
          null,
          { timeout: 3000, polling: 'raf' },
        )
        .then(() => true)
        .catch(() => false);
      if (shotTaken) await shot(page, `jump-over-beam-${name}`);
    } else await sleep(400);
  }
  await page.evaluate(() => Object.assign(window.__auto, { jump: false, charge: false }));
  await sleep(1500);
  const msgs = await sent(page);
  const a = await page.evaluate(() => ({ jumped: [...window.__auto.jumped], unjumpable: [...window.__auto.unjumpable], log: window.__auto.log }));
  const hits = new Set(msgs.filter((m) => m.t === 'hit').map((m) => m.id));
  const bad = a.jumped.filter((id) => hits.has(id));
  const jumps = a.log.filter((l) => !l.unjumpable);
  console.log(
    `${name.toUpperCase()}: ${jumps.length} jumps covering beams [${a.jumped.join(',')}], takeoff windows ${jumps.map((l) => `[${l.window[0]},${l.window[1]}]ms@${l.v}m/s`).join(' ')}; ` +
      `unjumpable [${a.unjumpable.join(',')}]; hits on jumped beams: ${bad.length ? bad.join(',') + ' (BUG)' : 'none (expected)'}`,
  );
  return { ok: bad.length === 0 && jumps.length > 0, jumps: jumps.length };
}

let standing = { ok: true, jumps: 0, skipped: true };
if (slack.slackMs > 0) standing = await phase('standing', { jump: true, charge: false, goto: { x: 0.5, z: -1 } }, N);
else console.log(`STANDING: skipped — config makes a standing jump impossible (slack ${slack.slackMs.toFixed(0)} ms)`);
const running = await phase('running', { jump: true, charge: true, goto: { x: 0.5, z: -1 } }, N);

const stats = await page.evaluate(() => window.__jj.game.stats);
console.log('stats', JSON.stringify(stats));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(firstHit && standing.ok && running.ok ? 0 : 1);
