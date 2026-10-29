// Remote-player smoothness + delay (server mode, 2 contexts). Alice runs at constant speed (D held ~3 s); Bob samples
// Alice's RENDERED mascot position every frame. Reports: render delay vs Alice's own physics timeline (target ≈
// INTERP_DELAY_MS + network + state age), frame-to-frame speed jitter and position residual vs a straight line.
// Usage: BASE_URL=http://localhost:47820/ node e2e/game-net-smooth.mjs
import { launch, openPage, sleep, waitFor, shot } from './game-lib.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:47820/';
const browser = await launch();
const A = await openPage(browser, `${BASE}?mode=server`, { width: 1280, height: 720 });
await A.page.fill('.menu-card input.field:not(.code-field)', 'Alice');
await A.page.click('text=Create room');
await waitFor(A.page, () => window.__jj && window.__jj.game && window.__jj.game.players.size > 0, null, 20000);
const invite = await A.page.evaluate(() => window.__jj.game.inviteUrl);
const B = await openPage(browser, invite, { width: 1280, height: 720 });
await B.page.fill('.menu-card input.field:not(.code-field)', 'Bob');
await B.page.click('button:has-text("Join")');
await waitFor(B.page, () => window.__jj && window.__jj.game && window.__jj.game.players.size >= 2, null, 20000);
const cfg = await B.page.evaluate(() => ({ INTERP: window.__jj.cfg.INTERP_DELAY_MS, SNAP: window.__jj.cfg.SNAP_HZ, SEND: window.__jj.cfg.CLIENT_SEND_HZ, TICK: window.__jj.cfg.TICK_HZ, V: window.__jj.cfg.MOVE_SPEED }));

const results = [];
for (let run = 0; run < 3; run++) {
  await A.page.evaluate(() => {
    window.__app.orbit.reset();
    window.__jj.game.teleport(6, -1 + Math.random() * 2, -Math.PI / 2);
  });
  await sleep(1200);
  // Bob: per-frame sampler of Alice's rendered position
  await B.page.evaluate(() => {
    const g = window.__jj.game;
    const alice = [...g.players.values()].find((p) => p.name === 'Alice');
    window.__samp = [];
    window.__raw = [];
    window.__sampOn = true;
    if (!window.__rawHook) {
      window.__rawHook = (m) => {
        if (!window.__sampOn) return;
        const row = m.p.find((q) => q[0] === alice.id);
        if (row) window.__raw.push({ s: m.s, x: row[1], arr: g.session.now() });
      };
      g.session.on('snap', window.__rawHook);
    }
    (function loop() {
      if (!window.__sampOn) return;
      const r = alice.mascot.root.position;
      const v = r.clone().project(window.__app.world.camera);
      window.__samp.push({ t: g.frameNow ?? g.session.now(), x: r.x, z: r.z, px: ((v.x + 1) / 2) * innerWidth * (1080 / innerHeight) });
      requestAnimationFrame(loop);
    })();
  });
  await A.page.evaluate(() => (window.__jj.rec = []));
  await A.page.keyboard.down('KeyD');
  await sleep(3000);
  await A.page.keyboard.up('KeyD');
  await sleep(500);
  const recA = await A.page.evaluate(() => {
    const r = window.__jj.rec;
    window.__jj.rec = null;
    return r.map((q) => ({ t: q.t, x: q.x, vx: q.vx }));
  });
  const [sampB, rawB] = await B.page.evaluate(() => {
    window.__sampOn = false;
    return [window.__samp, window.__raw];
  });
  // steady window: Alice at full speed (|vx| ~ V) and not near the wall
  const steadyA = recA.filter((q) => Math.abs(Math.abs(q.vx) - cfg.V) < 0.01);
  const t0 = steadyA[0].t + 200;
  const t1 = steadyA[steadyA.length - 1].t;
  const xAt = (x) => {
    // invert Alice's monotonic (decreasing) x(t) -> t
    for (let i = 1; i < recA.length; i++) {
      const a = recA[i - 1];
      const b = recA[i];
      if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) return a.t + ((x - a.x) / (b.x - a.x)) * (b.t - a.t);
    }
    return null;
  };
  const win = sampB.filter((q) => q.t > t0 + 150 && q.t < t1 + 50);
  const lags = win.map((q) => {
    const tA = xAt(q.x);
    return tA == null ? null : q.t - tA;
  }).filter((v) => v != null);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
  // per-frame rendered speed
  const speeds = [];
  for (let i = 1; i < win.length; i++) {
    const dt = (win[i].t - win[i - 1].t) / 1000;
    if (dt > 0.004) speeds.push(Math.hypot(win[i].x - win[i - 1].x, win[i].z - win[i - 1].z) / dt);
  }
  // residual vs straight line x(t)
  const n = win.length;
  const mt = mean(win.map((q) => q.t));
  const mx = mean(win.map((q) => q.x));
  const k = win.reduce((s, q) => s + (q.t - mt) * (q.x - mx), 0) / win.reduce((s, q) => s + (q.t - mt) ** 2, 0);
  const resid = win.map((q) => q.x - (mx + k * (q.t - mt)));
  // on-screen (scaled to a 1080p-tall viewport): per-frame step deviation and residual vs a straight line, in px
  const mp = mean(win.map((q) => q.px));
  const kp = win.reduce((s2, q) => s2 + (q.t - mt) * (q.px - mp), 0) / win.reduce((s2, q) => s2 + (q.t - mt) ** 2, 0);
  const residPx = win.map((q) => q.px - (mp + kp * (q.t - mt)));
  const stepErrPx = [];
  for (let i = 1; i < win.length; i++) stepErrPx.push(win[i].px - win[i - 1].px - kp * (win[i].t - win[i - 1].t));
  if (process.env.DUMP) (await import('node:fs')).writeFileSync(`${process.env.DUMP}-${run}.json`, JSON.stringify({ recA, rawB, sampB, V: cfg.V, INTERP: cfg.INTERP }));
  // raw snapshot noise: implied sample age = s - tA(x) (how much older than its stamp each row's position is)
  const ages = rawB.filter((q) => q.s > t0 && q.s < t1).map((q) => q.s - xAt(q.x)).filter((v) => Number.isFinite(v));
  const gaps = rawB.slice(1).map((q, i) => q.s - rawB[i].s);
  results.push({
    rawAge: [Math.min(...ages), mean(ages), Math.max(...ages)],
    snapGap: [Math.min(...gaps), mean(gaps), Math.max(...gaps)],
    frames: n,
    lagMean: mean(lags),
    lagSd: sd(lags),
    speedMean: mean(speeds),
    speedSdPct: (sd(speeds) / mean(speeds)) * 100,
    speedMinMax: [Math.min(...speeds), Math.max(...speeds)],
    residRmsMm: Math.sqrt(mean(resid.map((r) => r * r))) * 1000,
    residPx: Math.sqrt(mean(residPx.map((r) => r * r))),
    stepPx: Math.sqrt(mean(stepErrPx.map((r) => r * r))),
    residMaxMm: Math.max(...resid.map(Math.abs)) * 1000,
  });
}
await shot(B.page, 'net-smooth-B');
const ping = await B.page.evaluate(() => window.__jj.game.session.ping);
console.log(`config: INTERP_DELAY_MS ${cfg.INTERP}, SNAP_HZ ${cfg.SNAP}, CLIENT_SEND_HZ ${cfg.SEND}, TICK_HZ ${cfg.TICK}, MOVE_SPEED ${cfg.V}; Bob ping ${ping} ms`);
for (const [i, r] of results.entries()) {
  console.log(
    `run ${i + 1}: ${r.frames} frames | render delay ${r.lagMean.toFixed(1)} ± ${r.lagSd.toFixed(1)} ms | speed ${r.speedMean.toFixed(2)} m/s, ` +
      `raw row age ${r.rawAge.map((v) => v.toFixed(0)).join('/')} ms (min/mean/max), snap gap ${r.snapGap.map((v) => v.toFixed(0)).join('/')} ms | ` +
      `frame-to-frame sd ${r.speedSdPct.toFixed(1)} % [${r.speedMinMax.map((v) => v.toFixed(2)).join('..')}] | line residual rms ${r.residRmsMm.toFixed(1)} mm, max ${r.residMaxMm.toFixed(1)} mm | on screen (1080p): frame-step error rms ${r.stepPx.toFixed(2)} px, wander rms ${r.residPx.toFixed(2)} px`,
  );
}
console.log('errors A:', A.errors.length ? A.errors.join('\n') : 'none');
console.log('errors B:', B.errors.length ? B.errors.join('\n') : 'none');
await browser.close();
