// Full solo round end-to-end with bots: autopilot chases balloons + jumps beams. Screenshots of pickup, immunity,
// bombs with yellows, fear, Tab scoreboard, Esc menu, results. Checks HUD scores vs results, console errors.
// Usage: node e2e/game-round.mjs   (QS='?mode=fake&fakeRound=40&fakeResults=10' for a quick run on the fake)
import { launch, openPage, glInfo, shot, sleep, waitFor, sent, BASE } from './game-lib.mjs';
import { installAutopilot, setAuto } from './game-autopilot.mjs';

const browser = await launch();
const { page, errors } = await openPage(browser, `${BASE}${process.env.QS || ''}`);
console.log('GL:', await glInfo(page));
await page.fill('.menu-card input.field:not(.code-field)', 'Koschey');
await page.click('text=Solo practice');
await waitFor(page, () => window.__jj && window.__jj.game && window.__jj.game.players.size > 0);
for (let i = 0; i < 3; i++) await page.click('text=Add bot');
await waitFor(page, () => window.__jj.game.players.size >= 4);
await page.click('text=Start round');
await waitFor(page, () => window.__jj.game.phase === 'playing', null, 15000);
await installAutopilot(page, { jump: true, chase: true });
const t0 = Date.now();

const want = new Set(['pickup', 'immune', 'bombs', 'fear', 'tab', 'esc', 'midround']);
async function check() {
  return page.evaluate(() => {
    const g = window.__jj.game;
    const now = g.session.now();
    const me = g.players.get(g.you);
    return {
      phase: g.phase,
      rt: now - g.roundStart,
      myScore: me.score,
      scored: me.scored,
      immune: me.immuneUntil > now,
      bombs: g.bombs.size,
      yellows: [...g.orbs.values()].filter((o) => o.k === 'yellow').length,
      fear: !!g.local.fear,
      beams: g.beamList.length,
      orbs: g.orbs.size,
    };
  });
}

let lastLog = 0;
while (Date.now() - t0 < 200000) {
  const s = await check();
  if (s.phase !== 'playing') break;
  if (want.has('pickup') && s.scored && s.myScore > 0) {
    want.delete('pickup');
    await shot(page, 'pickup');
  }
  if (want.has('immune') && s.immune) {
    want.delete('immune');
    await sleep(250);
    await shot(page, 'immunity');
  }
  if (want.has('bombs') && s.bombs > 0 && s.yellows > 0) {
    want.delete('bombs');
    await sleep(300);
    await shot(page, 'bombs-yellows');
    // walk into the newest bomb's circle and wait there -> get feared
    const b = await page.evaluate(() => [...window.__jj.game.bombs.values()].pop());
    if (b) await setAuto(page, { chase: false, goto: { x: b.x + 0.6, z: b.z + 0.4 } });
  }
  if (want.has('fear') && s.fear) {
    want.delete('fear');
    await sleep(350);
    await shot(page, 'fear');
    await setAuto(page, { chase: true, goto: null });
  }
  if (want.has('midround') && s.rt > 40000 && s.beams >= 2) {
    want.delete('midround');
    await shot(page, 'midround-hud');
  }
  if (want.has('tab') && s.rt > 50000) {
    want.delete('tab');
    await page.keyboard.down('Tab');
    await sleep(200);
    await shot(page, 'scoreboard-tab');
    await page.keyboard.up('Tab');
  }
  if (want.has('esc') && s.rt > 95000) {
    want.delete('esc');
    await page.keyboard.press('Escape');
    await sleep(250);
    await shot(page, 'esc-menu');
    await page.keyboard.press('Escape');
  }
  if (Date.now() - lastLog > 15000) {
    lastLog = Date.now();
    console.log(`rt=${(s.rt / 1000).toFixed(1)}s score=${s.myScore} beams=${s.beams} orbs=${s.orbs} bombs=${s.bombs} fear=${s.fear}`);
  }
  await sleep(120);
}
await waitFor(page, () => window.__jj.game.phase === 'results', null, 30000);
await sleep(900);
await shot(page, 'results');
const res = await page.evaluate(() => {
  const g = window.__jj.game;
  return {
    ranking: g.ranking,
    hud: g.playerList().map((p) => ({ id: p.id, name: p.name, score: p.score })),
    stats: g.stats,
    rows: [...document.querySelectorAll('.res-table tbody tr')].map((tr) => tr.textContent),
    own: document.querySelector('.res-table tr.me')?.textContent,
  };
});
console.log('ranking', JSON.stringify(res.ranking));
const mismatch = (res.ranking || []).filter((r) => res.hud.find((p) => p.id === r.id)?.score !== r.score);
console.log(`HUD vs results score mismatches: ${mismatch.length ? JSON.stringify(mismatch) : 'none'}`);
console.log('results rows', JSON.stringify(res.rows), 'own row', res.own);
console.log('stats', JSON.stringify(res.stats));
const msgs = await sent(page);
console.log('claims: hit', msgs.filter((m) => m.t === 'hit').length, 'pickup', msgs.filter((m) => m.t === 'pickup').length);
console.log('missing screenshots:', [...want].join(',') || 'none');
// back to lobby via host "Play again"? just verify the auto-return countdown text
console.log('back text:', await page.textContent('.res-back'));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
