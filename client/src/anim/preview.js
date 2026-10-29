// Standalone preview of the rigged mascot (client/anim-preview.html).
//   default      : one controllable mascot (WASD + Space, real MOVE_SPEED / JUMP_VELOCITY / GRAVITY; hold Shift = keep facing
//                  -> strafe / backpedal clips; F fear, H hit, I immune, C cheer) + a ring of demo mascots looping every state.
//   ?perf=1      : 12 players running around (jumping, feared, hit) + 16 spectators; FPS logged to the console + HUD.
//   ?arena=1     : WORLD's arena around it (context check).
//   ?shot=<name> : camera framed on one demo mascot (for screenshots); window.__anim exposes helpers.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRAVITY, JUMP_VELOCITY, MOVE_SPEED, JUMP_AIRTIME, FEAR_MS, IMMUNITY_MS, PLAY_LIMIT, PLAYER_HEIGHT } from '@shared/config.js';
import { createRenderer } from '../world/renderer.js';
import { loadMascotAssets, createRiggedMascot, createSpectator, TUNING } from './riggedMascot.js';
import { PROPS } from './rig.js';
// dev overrides for proportion experiments, e.g. ?prop.hipWidth=1.2
for (const [k, v] of new URLSearchParams(location.search)) if (k.startsWith('prop.') && k.slice(5) in PROPS) PROPS[k.slice(5)] = +v;

const params = new URLSearchParams(location.search);
const PERF = params.has('perf');
const ARENA = params.has('arena');
const SHOT = params.get('shot');
const SOLO = params.get('solo'); // show only this demo state, at the origin
const hud = document.getElementById('hud');

const R = createRenderer(document.getElementById('app'));
const { scene, camera, renderer } = R;
renderer.info.autoReset = false; // the composer renders several passes: count the whole frame
if (params.get('quality')) R.setQuality(params.get('quality'));

if (ARENA) {
  const { createArena } = await import('../world/arena.js');
  const arena = createArena(scene);
  scene.userData.arena = arena;
} else {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(24, 64), new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.92 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(14, 14, 0x777066, 0x8e887d);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);
  // a laser-height reference bar (LASER_Y ~ 0.25 m)
  const bar = new THREE.Mesh(new THREE.BoxGeometry(14, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xff4020 }));
  bar.position.set(0, 0.25, -2.2);
  scene.add(bar);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.6, 0);
camera.position.set(0, 9.5, 8.5);

hud.textContent = 'loading mascot-anims.glb…';
const t0 = performance.now();
await loadMascotAssets();
const loadMs = performance.now() - t0;

// ---------------------------------------------------------------- controllable mascot
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyF') me.fearUntil = performance.now() + FEAR_MS;
  if (e.code === 'KeyH') me.m.flashHit();
  if (e.code === 'KeyI') me.immuneUntil = performance.now() + IMMUNITY_MS;
  if (e.code === 'KeyC') me.m.emote(me.emote = me.emote ? null : 'cheer');
});
addEventListener('keyup', (e) => keys.delete(e.code));

function makeBody(x = 0, z = 0, ry = 0) {
  return { x, y: 0, z, vx: 0, vz: 0, vy: 0, ry, grounded: true, fearUntil: 0, immuneUntil: 0, fdx: 0, fdz: 0, emote: null };
}
const me = makeBody(0, 0, 0);
me.m = createRiggedMascot({ color: '#2e86de', name: 'You', title: 'WASD · Space · Shift', isLocal: true });
scene.add(me.m.root);
if (SOLO) me.m.root.visible = false;

const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

/** One physics step for a body with a desired move direction (world, unit or zero). Mirrors the game's feel. */
function step(b, dt, wantX, wantZ, { strafe = false, faceYaw = null, jump = false, now }) {
  const feared = b.fearUntil > now;
  if (feared) {
    wantX = b.fdx;
    wantZ = b.fdz;
  }
  const accel = 30;
  const tvx = wantX * MOVE_SPEED;
  const tvz = wantZ * MOVE_SPEED;
  const dvx = tvx - b.vx;
  const dvz = tvz - b.vz;
  const dl = Math.hypot(dvx, dvz);
  const maxDv = accel * dt;
  if (dl > maxDv && dl > 1e-9) {
    b.vx += (dvx / dl) * maxDv;
    b.vz += (dvz / dl) * maxDv;
  } else {
    b.vx = tvx;
    b.vz = tvz;
  }
  b.x = THREE.MathUtils.clamp(b.x + b.vx * dt, -PLAY_LIMIT, PLAY_LIMIT);
  b.z = THREE.MathUtils.clamp(b.z + b.vz * dt, -PLAY_LIMIT, PLAY_LIMIT);
  if (jump && b.grounded && !feared) {
    b.vy = JUMP_VELOCITY;
    b.grounded = false;
  }
  if (!b.grounded) {
    b.vy -= GRAVITY * dt;
    b.y += b.vy * dt;
    if (b.y <= 0) {
      b.y = 0;
      b.vy = 0;
      b.grounded = true;
    }
  }
  const sp = Math.hypot(b.vx, b.vz);
  let targetYaw = b.ry;
  if (strafe && faceYaw !== null && !feared) targetYaw = faceYaw;
  else if (sp > 0.3) targetYaw = Math.atan2(b.vx, b.vz);
  b.ry += wrap(targetYaw - b.ry) * (1 - Math.exp(-14 * dt));
  return sp;
}

function drive(b, dt, now, sp) {
  const fearLeft = Math.max(0, b.fearUntil - now);
  b.m.root.position.set(b.x, b.y, b.z);
  b.m.root.rotation.y = b.ry;
  b.m.update(dt, {
    moving: sp > 0.4,
    speed: sp,
    airborne: !b.grounded,
    vy: b.vy,
    feared: fearLeft > 0,
    immune: b.immuneUntil > now,
    fearLeftMs: fearLeft,
    moveAngle: sp > 0.15 ? wrap(Math.atan2(b.vx, b.vz) - b.ry) : 0,
  });
}

// ---------------------------------------------------------------- demo ring (each loops one state)
const demos = [];
const DEMO = PERF
  ? []
  : [
      ['idle', '#c0392b'],
      ['run', '#27ae60'],
      ['back', '#8e44ad'],
      ['strafe L', '#e67e22'],
      ['strafe R', '#16a085'],
      ['jump', '#d63384'],
      ['run+jump', '#00a8a8'],
      ['fear', '#b8860b'],
      ['hit', '#5d6d7e'],
      ['immune', '#e84393'],
      ['cheer', '#6c5ce7'],
      ['clap', '#c0392b'],
      ['jazz', '#2e86de'],
      ['victory', '#27ae60'],
      ['wave', '#e67e22'],
      ['runner', '#7a2f2a'],
      ['npc', '#7b2430'],
      ['runline', '#2e86de'],
    ];
const DEMO_LIST = SOLO ? DEMO.filter(([s]) => s === SOLO).map(([s, c]) => [s, params.get('color') || c]) : DEMO;
DEMO_LIST.forEach(([state, color], i) => {
  const n = DEMO.length - 1;
  const ang = Math.PI * 0.08 + (Math.PI * 0.84 * i) / Math.max(1, n - 1);
  const rad = 4.6;
  const x = Math.cos(ang) * rad * 1.25;
  const z = -Math.sin(ang) * rad + 1.0;
  const b = SOLO ? makeBody(0, 0, 0) : makeBody(x, z, Math.atan2(-x, -z + 6) * 0.25);
  b.home = { x: b.x, z: b.z };
  b.state = state;
  b.m =
    state === 'npc'
      ? createRiggedMascot({ color, name: 'Festival Manager', npc: true, hat: '#d4282a' })
      : createRiggedMascot({ color, name: SOLO && !params.has('names') ? '' : state, title: SOLO && !params.has('names') ? '' : 'state', isLocal: params.has('local') });
  if (['cheer', 'clap', 'jazz', 'victory', 'wave'].includes(state)) b.m.emote(state);
  b.timer = Math.random();
  scene.add(b.m.root);
  demos.push(b);
});
const runner = demos.find((d) => d.state === 'runner');
const runline = demos.find((d) => d.state === 'runline');
if (runline) {
  runline.x = -4;
  runline.z = SOLO ? 0 : 3.6;
  runline.ry = Math.PI / 2;
}
/** Straight run along +x at MOVE_SPEED (foot-slide check), wrapping from x=4 back to x=-4. */
function runlineStep(b, dt, now) {
  if (b.x > 4) {
    b.x = -4;
    b.vx = MOVE_SPEED;
    b.vz = 0;
  }
  const sp = step(b, dt, 1, 0, { now });
  drive(b, dt, now, sp);
}
function runlineReset(x = -1.2) {
  Object.assign(runline, { x, vx: MOVE_SPEED, vz: 0, ry: Math.PI / 2 });
}
/** Critic metric: planted ball speed (lowest 20% of ball-height samples) while running at MOVE_SPEED, sim at 60 Hz. */
function measureSlide(frames = 150) {
  runlineReset(-3.4);
  const bones = Object.fromEntries(runline.m.mesh.skeleton.bones.map((b) => [b.name, b]));
  const prev = {};
  const out = {};
  const v = new THREE.Vector3();
  for (const f of ['ball_l', 'ball_r']) out[f] = [];
  const dt = 1 / 60;
  for (let i = 0; i < frames; i++) {
    runlineStep(runline, dt, performance.now());
    runline.m.root.updateMatrixWorld(true);
    for (const f of ['ball_l', 'ball_r']) {
      bones[f].getWorldPosition(v);
      const d = prev[f] ? Math.hypot(v.x - prev[f].x, v.z - prev[f].z) : 1;
      if (i > 20 && d < 0.3) out[f].push({ y: v.y, sp: d / dt }); // skip the wrap-around teleport
      prev[f] = v.clone();
    }
  }
  const res = {};
  for (const f in out) {
    const a = [...out[f]].sort((p, q) => p.y - q.y).slice(0, Math.round(out[f].length * 0.2));
    res[f] = +(a.reduce((x, q) => x + q.sp, 0) / a.length).toFixed(3);
    const minY = a[0].y;
    const c = out[f].filter((q) => q.y < minY + 0.006); // strict contact: within 6 mm of the lowest point
    res[f + '_contact'] = +(c.reduce((x, q) => x + q.sp, 0) / c.length).toFixed(3);
  }
  res.ground = MOVE_SPEED;
  return res;
}
if (runner && !SOLO) {
  runner.x = 0;
  runner.z = 2.5;
}

function demoStep(b, dt, now) {
  b.timer += dt;
  let sp = 0;
  const st = b.state;
  b.x = b.home.x;
  b.z = b.home.z;
  const opts = { moving: false, speed: 0, airborne: false, vy: 0, feared: false, immune: false, fearLeftMs: 0, moveAngle: 0 };
  if (st === 'run' || st === 'fear' || st === 'run+jump') {
    opts.moving = true;
    opts.speed = sp = MOVE_SPEED;
  } else if (st === 'back' || st === 'strafe L' || st === 'strafe R') {
    opts.moving = true;
    opts.speed = sp = MOVE_SPEED;
    opts.moveAngle = st === 'back' ? Math.PI : st === 'strafe L' ? Math.PI / 2 : -Math.PI / 2;
  }
  if (st === 'fear') {
    opts.feared = true;
    opts.fearLeftMs = FEAR_MS - ((b.timer * 1000) % FEAR_MS);
  }
  if (st === 'immune') opts.immune = true;
  if (st === 'hit' && b.timer > 1.3) {
    b.timer = 0;
    b.m.flashHit();
  }
  if (st === 'jump' || st === 'run+jump') {
    // real jump physics on a 1.4 s cycle
    const cyc = 1.4;
    const tt = b.timer % cyc;
    if (tt < JUMP_AIRTIME) {
      b.y = JUMP_VELOCITY * tt - 0.5 * GRAVITY * tt * tt;
      opts.airborne = true;
      opts.vy = JUMP_VELOCITY - GRAVITY * tt;
    } else b.y = 0;
  }
  b.m.root.position.set(b.x, b.y, b.z);
  b.m.root.rotation.y = b.ry;
  b.m.update(dt, opts);
}

function runnerStep(b, dt, now) {
  // runs a circle with real speed (judge foot sliding), hops every 2 s
  b.ang = (b.ang ?? 0) + (MOVE_SPEED / 2.2) * dt;
  const tx = Math.cos(b.ang) * 2.2;
  const tz = Math.sin(b.ang) * 2.2 + 1.5;
  const dx = tx - b.x;
  const dz = tz - b.z;
  const d = Math.hypot(dx, dz) || 1;
  b.jt = (b.jt ?? 0) + dt;
  const jump = b.jt > 2;
  if (jump) b.jt = 0;
  const sp = step(b, dt, dx / d, dz / d, { now, jump });
  drive(b, dt, now, sp);
}

// ---------------------------------------------------------------- perf crowd
const bots = [];
const specs = [];
if (PERF) {
  const COLORS = ['#c0392b', '#2e86de', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#d63384', '#b8860b', '#5d6d7e', '#e84393', '#00a8a8', '#6c5ce7'];
  for (let i = 0; i < 11; i++) {
    const b = makeBody((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, Math.random() * 6);
    b.m = createRiggedMascot({ color: COLORS[i + 1], name: `Bot ${i + 1}`, title: 'Practice Bot' });
    b.tx = b.x;
    b.tz = b.z;
    scene.add(b.m.root);
    bots.push(b);
  }
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 9.2;
    const s = createSpectator({ color: COLORS[i % COLORS.length], scale: 0.95 + Math.random() * 0.1 });
    s.root.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    s.root.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
    scene.add(s.root);
    specs.push(s);
  }
  camera.position.set(0, 13.5, 11.5);
  controls.target.set(0, 0, 0);
}

function botStep(b, dt, now) {
  if (Math.hypot(b.tx - b.x, b.tz - b.z) < 0.5 || Math.random() < dt * 0.3) {
    b.tx = (Math.random() - 0.5) * 12;
    b.tz = (Math.random() - 0.5) * 12;
  }
  const dx = b.tx - b.x;
  const dz = b.tz - b.z;
  const d = Math.hypot(dx, dz) || 1;
  const idle = (b.idleT = Math.max(0, (b.idleT ?? 0) - dt)) > 0;
  if (!idle && Math.random() < dt * 0.15) b.idleT = 0.6 + Math.random();
  if (Math.random() < dt * 0.04 && b.fearUntil < now) {
    b.fearUntil = now + FEAR_MS;
    const a = Math.random() * Math.PI * 2;
    b.fdx = Math.cos(a);
    b.fdz = Math.sin(a);
  }
  if (Math.random() < dt * 0.1) b.m.flashHit();
  if (Math.random() < dt * 0.02) b.immuneUntil = now + 3000;
  const sp = step(b, dt, idle ? 0 : dx / d, idle ? 0 : dz / d, { now, jump: Math.random() < dt * 0.6 });
  drive(b, dt, now, sp);
}

// ---------------------------------------------------------------- camera helpers (screenshots)
const _t = new THREE.Vector3();
function focus(nameOrObj, dist = 3.2, pitchDeg = 18, yawDeg = 0) {
  const b = typeof nameOrObj === 'string' ? demos.find((d) => d.state === nameOrObj) || (nameOrObj === 'me' ? me : null) : nameOrObj;
  if (!b) return false;
  _t.set(b.x, 0.5, b.z);
  const p = THREE.MathUtils.degToRad(pitchDeg);
  const yw = b.ry + THREE.MathUtils.degToRad(yawDeg);
  camera.position.set(_t.x + Math.sin(yw) * Math.cos(p) * dist, _t.y + Math.sin(p) * dist, _t.z + Math.cos(yw) * Math.cos(p) * dist);
  controls.target.copy(_t);
  controls.update();
  return true;
}
function overview(dist = 14, pitchDeg = 50) {
  const p = THREE.MathUtils.degToRad(pitchDeg);
  controls.target.set(0, 0.5, 0.5);
  camera.position.set(0, 0.5 + Math.sin(p) * dist, 0.5 + Math.cos(p) * dist);
  controls.update();
}
/** The game's default camera (game/tuning.js CAM): on the -z side looking +z, pitch 33 deg, slant 15 m, vFOV 56. */
function gameCam(b = me, dist = 15, pitchDeg = 33, fov = 56) {
  camera.fov = fov;
  camera.updateProjectionMatrix();
  const p = THREE.MathUtils.degToRad(pitchDeg);
  controls.target.set(b.x, PLAYER_HEIGHT * 0.63, b.z);
  camera.position.set(b.x, controls.target.y + Math.sin(p) * dist, b.z - Math.cos(p) * dist);
  controls.update();
}
if (params.get('cam') === 'game') gameCam(me, +(params.get('dist') ?? 15));
else if (SHOT) {
  if (SHOT === 'overview') overview(params.has('dist') ? +params.get('dist') : 14);
  else focus(SHOT, +(params.get('dist') ?? 3.2), +(params.get('pitch') ?? 18), +(params.get('yaw') ?? 0));
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let paused = false;
let stepOnce = 0; // while paused: advance the simulation by this much on the next frame (deterministic strips)
const fps = { frames: 0, acc: 0, value: 0, samples: [] };
const cpu = { anim: 0, render: 0 };
const trisPer = me.m.mesh ? me.m.mesh.geometry.index.count / 3 : 0;
const clock = { t: 0 };
function frame(ts) {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = Math.min(0.05, Math.max(0, (ts - last) / 1000) || 0.016);
  renderer.info.reset();
  last = ts;
  fps.frames++;
  fps.acc += dt;
  if (fps.acc >= 1) {
    fps.value = fps.frames / fps.acc;
    fps.samples.push(fps.value);
    fps.frames = 0;
    fps.acc = 0;
  }
  if (paused) {
    dt = stepOnce;
    stepOnce = 0;
  }
  clock.t += dt;

  // controllable mascot (camera-relative WASD)
  const fwd = _t.set(controls.target.x - camera.position.x, 0, controls.target.z - camera.position.z).normalize();
  const fx = fwd.x;
  const fz = fwd.z;
  let mx = 0;
  let mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) (mx += fx), (mz += fz);
  if (keys.has('KeyS') || keys.has('ArrowDown')) (mx -= fx), (mz -= fz);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) (mx += fz), (mz -= fx);
  if (keys.has('KeyD') || keys.has('ArrowRight')) (mx -= fz), (mz += fx);
  const ml = Math.hypot(mx, mz);
  if (ml > 0) (mx /= ml), (mz /= ml);
  const strafe = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const c0 = performance.now();
  const sp = step(me, dt, mx, mz, { now, strafe, faceYaw: Math.atan2(fx, fz), jump: keys.has('Space') });
  drive(me, dt, now, sp);

  for (const b of demos) (b === runner ? runnerStep : b === runline ? runlineStep : demoStep)(b, dt, now);
  for (const b of bots) botStep(b, dt, now);
  for (const s of specs) s.update(dt, { excitement: 0.5 });
  const c1 = performance.now();
  cpu.anim = cpu.anim * 0.95 + (c1 - c0) * 0.05;
  if (scene.userData.arena) scene.userData.arena.update(dt, now);

  controls.update();
  const r0 = performance.now();
  R.render();
  cpu.render = cpu.render * 0.95 + (performance.now() - r0) * 0.05;
  const info = renderer.info;
  hud.innerHTML =
    `<b>Rigged mascot</b> (anim agent) · load ${loadMs.toFixed(0)} ms · <b>${fps.value.toFixed(0)} fps</b> · ${info.render.calls} draws · ${(info.render.triangles / 1000).toFixed(0)}k tris\n` +
    (PERF ? `${1 + bots.length} players + ${specs.length} spectators\n` : 'WASD move · Space jump · Shift strafe/backpedal · F fear · H hit · I immune · C cheer\n') +
    `you: ${me.grounded ? (sp > 0.4 ? 'run' : 'idle') : 'air'} · speed ${sp.toFixed(2)} m/s · y ${me.y.toFixed(2)}`;
}
requestAnimationFrame(frame);

window.__anim = {
  focus,
  overview,
  setPaused: (p) => (paused = p),
  measureSlide,
  TUNING,
  runlineReset,
  gameCam,
  step: (d) => (stepOnce = d),
  fps,
  cpu,
  trisPer,
  me,
  demos,
  bots,
  specs,
  renderer,
  loadMs,
  glInfo() {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  },
};
