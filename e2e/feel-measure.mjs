// Measures OUR client's movement feel numerically and compares with the real-game targets of research/CRITIC.md
// (FEEL rev2 re-verified; same targets as research/critic-tools/feel-check.mjs).
// Inputs are real KeyboardEvents dispatched in the page; samples come from the game's fixed physics substeps
// (window.__jj.rec, 120 Hz) plus rAF-sampled camera projection. Solo room, lobby phase (no lasers).
// Usage: node e2e/feel-measure.mjs   (BASE_URL to override; vite dev on :5175 by default)
import { launch, openPage, sleep, waitFor, BASE } from './game-lib.mjs';

const browser = await launch();
const { page, errors } = await openPage(browser, BASE);
await page.fill('.menu-card input.field:not(.code-field)', 'Feel');
await page.click('text=Solo practice');
await waitFor(page, () => window.__jj && window.__jj.game && window.__jj.game.players.size > 0);
await sleep(600);

const R = await page.evaluate(async () => {
  const jj = window.__jj;
  const g = jj.game;
  const C = jj.cfg;
  const L = g.local;
  const V = C.MOVE_SPEED;
  const H = C.PLAYER_HEIGHT;
  const W = C.ARENA_HALF * 2;
  const DEG = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code, bubbles: true }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => g.session.now();
  const sp = (s) => Math.hypot(s.vx, s.vz);
  const hMs = 1000 / 120;
  window.__app.orbit.reset(); // yaw 0: camera forward = +z, right = -x
  async function setup(x, z, ry = 0) {
    g.teleport(x, z, ry);
    await wait(300);
    jj.rec = [];
  }
  const stop = () => {
    const s = jj.rec;
    jj.rec = null;
    return s;
  };
  const out = {};

  // ---- 1) jump at rest (+ camera: does the character stay put on screen?)
  await setup(0, 0);
  const cam = [];
  let sampling = true;
  const THREE_V = window.__app.world.camera.position.constructor;
  const pv = new THREE_V();
  (function camSample() {
    if (!sampling) return;
    const me = g.players.get(g.you).mascot.root;
    pv.set(me.position.x, me.position.y + 0.6, me.position.z).project(window.__app.world.camera);
    const ch = pv.y;
    pv.set(me.position.x, 0, me.position.z).project(window.__app.world.camera);
    cam.push({ y: g.renderPos.y, ch, floor: pv.y });
    requestAnimationFrame(camSample);
  })();
  const tSpace = now();
  key('keydown', 'Space');
  await wait(30);
  key('keyup', 'Space');
  await wait(1350);
  sampling = false;
  let s = stop();
  {
    const i0 = s.findIndex((q) => !q.g);
    const tTake = s[i0].t - hMs;
    let i1 = i0;
    while (i1 < s.length && !s[i1].g) i1++;
    const p = s[i1 - 1];
    const tau = (p.vy + Math.sqrt(p.vy * p.vy + 2 * C.GRAVITY * p.y)) / C.GRAVITY; // exact touchdown inside the step
    const tLand = p.t + tau * 1000;
    let apex = 0;
    let tApex = 0;
    for (let i = i0; i < i1; i++) if (s[i].y > apex) [apex, tApex] = [s[i].y, s[i].t];
    const T = tLand - tTake;
    const y25 = s.reduce((b, q) => (Math.abs(q.t - (tTake + 0.25 * T)) < Math.abs(b.t - (tTake + 0.25 * T)) ? q : b), s[0]).y;
    const air = cam.filter((c) => c.y > 0.05);
    const spread = (a) => Math.max(...a) - Math.min(...a);
    out.jump = {
      airtime: (tLand - tTake) / 1000,
      apex,
      apexChar: apex / H,
      apexFrac: (tApex - tTake) / (tLand - tTake),
      y25frac: y25 / apex,
      latencyMs: Math.max(0, tTake - tSpace), // substeps are back-dated within the frame
      charScreenSpread: air.length ? spread(air.map((c) => c.ch)) : null, // NDC units (2 = full screen height)
      floorScreenDrop: air.length ? spread(air.map((c) => c.floor)) : null,
    };
  }

  // ---- 2) D from rest -> accel; release -> stop
  await setup(5.6, 0, -Math.PI / 2);
  const tD = now();
  key('keydown', 'KeyD');
  await wait(500);
  const tUp = now();
  key('keyup', 'KeyD');
  await wait(400);
  s = stop();
  {
    const first = s.find((q) => q.ix !== 0);
    const tIn = first.t - hMs;
    const at = (f) => s.find((q) => sp(q) >= f * V)?.t;
    const steady = s.filter((q) => q.t > tD + 250 && q.t < tUp - 40 && q.ix !== 0).map(sp); // input is sampled per frame
    const relIdx = s.findIndex((q) => q.t >= tUp && q.ix === 0);
    const tRelIn = s[relIdx].t - hMs;
    const tStop = s.slice(relIdx).find((q) => sp(q) < 0.1 * V)?.t;
    const xRel = s[relIdx - 1].x;
    const xEnd = s[s.length - 1].x;
    out.accel = {
      t65: at(0.65) - tIn,
      t100: at(0.99) - tIn,
      t65key: at(0.65) - tD,
      t100key: at(0.99) - tD,
      latencyMs: tIn - tD,
      speed: steady.reduce((a, b) => a + b, 0) / steady.length,
    };
    out.stop = { t10: tStop - tRelIn, t10key: tStop - tUp, dist: Math.abs(xEnd - xRel) };
  }

  // ---- 3) D -> A reversal (+ facing)
  await setup(5.6, 0, -Math.PI / 2);
  key('keydown', 'KeyD');
  await wait(380);
  const tRev = now();
  key('keyup', 'KeyD');
  key('keydown', 'KeyA');
  await wait(450);
  key('keyup', 'KeyA');
  await wait(150);
  s = stop();
  {
    const ia = s.findIndex((q) => q.ix < 0);
    const tIn = s[ia].t - hMs;
    const after = s.slice(ia);
    const tZero = after.find((q) => q.vx >= 0)?.t; // D moves toward -x, A toward +x
    const tFull = after.find((q) => q.vx >= 0.99 * V)?.t;
    const tFace = after.find((q) => Math.abs(wrap(q.ry - Math.PI / 2)) < 10 / DEG)?.t;
    out.reverse = { tZero: tZero - tIn, tFull: tFull - tIn, tFace: tFace - tIn, tFullKey: tFull - tRev };
  }

  // ---- 3b) 90 deg turn: D -> W (facing -x -> +z)
  await setup(4.6, -4.6, -Math.PI / 2);
  key('keydown', 'KeyD');
  await wait(300);
  key('keyup', 'KeyD');
  key('keydown', 'KeyW');
  await wait(250);
  key('keyup', 'KeyW');
  s = stop();
  {
    const iw = s.findIndex((q) => q.iy > 0);
    const tIn = s[iw].t - hMs;
    const tFace = s.slice(iw).find((q) => Math.abs(wrap(q.ry - 0)) < 10 / DEG)?.t;
    out.turn90 = { tFace: tFace - tIn };
  }

  // ---- 4) S: with BACKPEDAL the body keeps facing away; without (real game) it turns and runs toward the camera
  await setup(0, 5.6, 0);
  key('keydown', 'KeyS');
  await wait(900);
  key('keyup', 'KeyS');
  s = stop();
  {
    const st = s.filter((q) => q.iy < 0).slice(-30);
    out.back = {
      ratio: st.reduce((a, q) => a + sp(q), 0) / st.length / V,
      faceDeg: wrap(st[st.length - 1].ry) * DEG, // 0 = away from camera, +-180 = toward camera
      moveAngle: (st.reduce((a, q) => a + Math.abs(q.ma), 0) / st.length) * DEG,
      towardCamera: st.every((q) => q.vz < 0),
    };
  }
  // ---- 5) S+A: moves back-left (+x,-z) = 135 deg
  await setup(-4.6, 4.6, 0);
  key('keydown', 'KeyS');
  key('keydown', 'KeyA');
  await wait(800);
  key('keyup', 'KeyS');
  key('keyup', 'KeyA');
  s = stop();
  {
    const st = s.filter((q) => q.iy < 0).slice(-25);
    const last = st[st.length - 1];
    out.backDiag = { ratio: sp(last) / V, moveDir: Math.atan2(last.vx, last.vz) * DEG, face: wrap(last.ry) * DEG };
  }
  // ---- 6) diagonal W+D speed
  await setup(4.6, -4.6, 0);
  key('keydown', 'KeyW');
  key('keydown', 'KeyD');
  await wait(450);
  key('keyup', 'KeyW');
  key('keyup', 'KeyD');
  s = stop();
  {
    const st = s.filter((q) => q.iy > 0).slice(-20);
    out.diag = { ratio: st.reduce((a, q) => a + sp(q), 0) / st.length / V };
  }
  // ---- 7) air control: hold D, jump, switch to A mid-air
  await setup(5.6, 0, -Math.PI / 2);
  key('keydown', 'KeyD');
  await wait(300);
  key('keydown', 'Space');
  await wait(25);
  key('keyup', 'Space');
  await wait(90);
  key('keyup', 'KeyD');
  key('keydown', 'KeyA');
  await wait(1300);
  key('keyup', 'KeyA');
  s = stop();
  {
    const i0 = s.findIndex((q) => !q.g);
    let i1 = i0;
    while (i1 < s.length && !s[i1].g) i1++;
    const take = s[i0];
    const airS = s.slice(i0, i1);
    const dv = Math.max(...airS.map((q) => Math.hypot(q.vx - take.vx, q.vz - take.vz)));
    const dry = Math.max(...airS.map((q) => Math.abs(wrap(q.ry - take.ry)))) * DEG;
    const switchedMidAir = airS.some((q) => q.ix < 0);
    // first substep after touchdown where velocity moves toward +x (A)
    const land = s[i1];
    const react = s.slice(i1).find((q) => q.vx > land.vx + 0.01);
    out.air = { dv, dry, switchedMidAir, takeoffSpeed: sp(take) / V, landReactMs: react ? react.t - land.t : null, dist: Math.hypot(land.x - s[i0 - 1].x, land.z - s[i0 - 1].z) };
  }
  const o = window.__app.orbit;
  out.cam = { pitch: o.pitch * DEG, dist: o.distGoal, fov: window.__app.world.camera.fov };
  out.cfg = { V, H, W, LS: C.LASER_SPEED, LSS: C.LASER_SPEED_SLOW, BACKPEDAL: C.BACKPEDAL ?? true, R: C.LASER_HIT_HALF + C.PLAYER_RADIUS, clear: C.LASER_Y + C.LASER_HIT_HALF, JV: C.JUMP_VELOCITY, G: C.GRAVITY };
  return out;
});

// ------------------------------------------------------------------------------------------------ report
// Targets: research/CRITIC.md §2 (real game, FEEL rev2 re-verified) — [value, tolerance]
const T = {
  airtime: [0.89, 0.03],
  apexFrac: [0.5, 0.05],
  y25: [0.75, 0.05],
  speedArena: [0.235, 0.02],
  laserRatio: [0.76, 0.06], // vs FAST beams
  laserPass: [3.1, 0.2], // FAST tier
  laserPassSlow: [4.75, 0.25], // SLOW tier 4.5-5.0 s
  arenaH: [13.6, 0.7],
};
const near = (x, [t, tol]) => Math.abs(x - t) <= tol;
const { V, H, W, LS, LSS, R: HR } = R.cfg;
const rows = [];
const row = (metric, ours, target, ok) => rows.push([metric, ours, target, ok == null ? '–' : ok ? 'PASS' : 'FAIL']);
const f = (v, d = 2) => (v == null || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(d));
const ms = (v) => (v == null || Number.isNaN(v) ? 'n/a' : `${Math.round(v)} ms`);
const SUB = 1000 / 120 + 0.5; // tolerance: one physics substep (measurement resolution)
row('Jump airtime (Space at rest)', `${f(R.jump.airtime, 3)} s`, '0.89 ± 0.03 s', near(R.jump.airtime, T.airtime));
// CRITIC verified the apex arena-relative (floor drop / arena width) -> 1.5-1.65 m at 14 m; its '1.23 H' assumed the old 1.27 m body
row('Jump apex (feet)', `${f(R.jump.apex)} m = ${f(R.jump.apex / W, 3)} arena (${f(R.jump.apexChar)} H)`, '1.5–1.65 m at 14 m (critic, arena-relative)', R.jump.apex >= 1.5 && R.jump.apex <= 1.65);
row('Apex timing / height at 25 % airtime', `${f(R.jump.apexFrac * 100, 0)} % / ${f(R.jump.y25frac * 100, 0)} % of apex`, '50 ± 5 % / 75 ± 5 %', near(R.jump.apexFrac, T.apexFrac) && near(R.jump.y25frac, T.y25));
row('Space -> takeoff latency', ms(R.jump.latencyMs), '≤ 17 ms', R.jump.latencyMs <= 17.5);
row('Run speed', `${f(R.accel.speed)} m/s = ${f(R.accel.speed / W, 3)} arena/s`, '0.235 ± 0.02 arena/s', near(R.accel.speed / W, T.speedArena));
row('Run / FAST-laser speed', `${f(R.accel.speed / LS)}×`, '0.76 ± 0.06', near(R.accel.speed / LS, T.laserRatio));
row('Accel to full speed (from input frame)', ms(R.accel.t100), '33–100 ms (median ~67)', R.accel.t100 >= 33 - SUB && R.accel.t100 <= 100 + SUB);
row('Stop (< 10 %), distance', `${ms(R.stop.t10)}, ${f(R.stop.dist, 3)} m`, '≤ 42 ms (1–2 f), < 0.1 m', R.stop.t10 <= 42 + SUB && R.stop.dist < 0.1);
row('Reverse D→A: v crosses 0 / full other way', `${ms(R.reverse.tZero)} / ${ms(R.reverse.tFull)}`, 'full-to-full 100–190 ms', R.reverse.tFull >= 100 - SUB && R.reverse.tFull <= 190 + SUB);
row('Facing 180° (±10°)', ms(R.reverse.tFace), '160–260 ms (~230 ms)', R.reverse.tFace >= 160 - SUB && R.reverse.tFace <= 260 + SUB);
row('Facing 90° (±10°)', ms(R.turn90.tFace), '(info) FEEL 50–67 ms, L', null);
if (R.cfg.BACKPEDAL) row('S: backpedal ratio / facing', `${f(R.back.ratio)}× / ${f(R.back.faceDeg, 0)}°`, 'BACKPEDAL on: ratio, faces away', null);
else
  row(
    'S: speed / facing / toward camera',
    `${f(R.back.ratio)}× / ${f(R.back.faceDeg, 0)}° / ${R.back.towardCamera}`,
    '1.0× / faces camera (±180°) / yes',
    Math.abs(R.back.ratio - 1) < 0.03 && Math.abs(Math.abs(R.back.faceDeg) - 180) < 10 && R.back.towardCamera,
  );
row(
  'S+A: move dir / facing / speed',
  `${f(R.backDiag.moveDir, 0)}° / ${f(R.backDiag.face, 0)}° / ${f(R.backDiag.ratio)}×`,
  R.cfg.BACKPEDAL ? 'back-left 135° / faces −45°' : 'back-left 135° / faces 135° / 1.0×',
  Math.abs(R.backDiag.moveDir - 135) < 3 && (R.cfg.BACKPEDAL ? Math.abs(R.backDiag.face + 45) < 5 : Math.abs(R.backDiag.face - 135) < 5),
);
row('Diagonal (W+D) speed ratio', `${f(R.diag.ratio, 3)}×`, '1.0× (critic: same as straight)', Math.abs(R.diag.ratio - 1) < 0.03);
row('Air control: Δv / Δfacing mid-air (D→A switched)', `${f(R.air.dv, 3)} m/s / ${f(R.air.dry, 1)}°`, '0 / 0', R.air.dv < 0.01 && R.air.dry < 0.5 && R.air.switchedMidAir);
row(
  'Jump while running: speed kept / distance',
  `${f(R.air.takeoffSpeed, 3)}× / ${f(R.air.dist)} m = ${f(R.air.dist / W, 3)} arena`,
  '1.0× / 0.20 ± 0.02 arena',
  Math.abs(R.air.takeoffSpeed - 1) < 0.02 && Math.abs(R.air.dist / W - 0.2) < 0.02,
);
row('Landing -> held input takes effect', ms(R.air.landReactMs), '0–17 ms', R.air.landReactMs != null && R.air.landReactMs <= 17);
row('Laser pass FAST / SLOW tier', `${f(W / LS)} s / ${LSS ? f(W / LSS) : 'n/a'} s`, '3.1 ± 0.2 s / 4.5–5.0 s', near(W / LS, T.laserPass) && !!LSS && near(W / LSS, T.laserPassSlow));
row('Hit half-width / feet clearance', `${f(HR)} m / ${f(R.cfg.clear)} m`, '(info) 0.51 / 0.38 m', null);
row('Arena / character height', `${f(W / H, 1)}`, '13.6 ± 0.7 (critic)', near(W / H, T.arenaH));
row(
  'Camera pitch / distance / vFOV',
  `${f(R.cam.pitch, 0)}° / ${f(R.cam.dist, 1)} m / ${f(R.cam.fov, 0)}°`,
  '29–36° / ~15 m / 54–58°',
  R.cam.pitch >= 29 && R.cam.pitch <= 36 && Math.abs(R.cam.dist - 15) < 1 && R.cam.fov >= 54 && R.cam.fov <= 58,
);
row(
  'Camera follows jump: char on-screen drift',
  `${f(R.jump.charScreenSpread, 4)} NDC (floor drops ${f(R.jump.floorScreenDrop, 3)})`,
  'char fixed, floor drops',
  R.jump.charScreenSpread < 0.01 && R.jump.floorScreenDrop > 0.02,
);

const w = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => String(r[i]).length), ['Metric', 'Ours', 'FEEL target', ''][i].length));
const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join(' | ');
console.log(line(['Metric', 'Ours', 'FEEL target', '']));
console.log(w.map((n) => '-'.repeat(n)).join('-|-'));
for (const r of rows) console.log(line(r));
console.log(`\nconfig: MOVE_SPEED ${V}, PLAYER_HEIGHT ${H}, arena ${W} m, LASER_SPEED ${LS}, JUMP_VELOCITY ${R.cfg.JV.toFixed(3)}, GRAVITY ${R.cfg.G.toFixed(2)}, clearance ${R.cfg.clear.toFixed(2)} m`);
console.log(`PASS ${rows.filter((r) => r[3] === 'PASS').length} / FAIL ${rows.filter((r) => r[3] === 'FAIL').length}`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
