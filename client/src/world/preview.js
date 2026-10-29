// Standalone look-dev page for the world (no networking). Open /world-preview.html via Vite.
// URL params: ?quality=high|medium|low  &view=overview|low|mascot|corner|top  &auto=0  &shot=1 (hide HUD)
// window.__preview exposes a small API used by the screenshot script (setView, trigger, clear, auto, freeze, fps).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ARENA_HALF,
  BOMB_FUSE_MS,
  BOMB_RADIUS,
  FEAR_MS,
  GRAVITY,
  IMMUNITY_MS,
  JUMP_VELOCITY,
  LASER_PENALTY,
  LASER_SPEED,
  LASER_SPEED_SLOW,
  PLAYER_HEIGHT,
  MOVE_SPEED,
  ORB_POINTS,
  PICKUP_RADIUS,
  PLAY_LIMIT,
  YELLOW_LIFETIME_AFTER_BOOM_MS,
  YELLOW_RING_RADIUS,
} from '@shared/config.js';
import { beamState, beamTimes, laserHitTest } from '@shared/lasers.js';
import { createRenderer } from './renderer.js';
import { floorTextures, walkwayTextures } from './textures.js';
import { createArena, PLAYER_COLORS } from './arena.js';
import { createMascot } from './mascot.js';
// the game uses ANIM's rigged mascot for players + spectators (?mascot=world shows WORLD's primitive critter instead)
import { createRiggedMascot, loadMascotAssets } from '../anim/riggedMascot.js';
import { LaserView } from './lasers.js';
import { OrbView } from './orbs.js';
import { BombView } from './bombs.js';
import { Effects } from './effects.js';

const params = new URLSearchParams(location.search);
if (params.get('shot') === '1') document.body.classList.add('shot');

const useWorldMascot = params.get('mascot') === 'world';
const assetsPromise = useWorldMascot ? Promise.resolve() : loadMascotAssets();
const t0 = performance.now();
const R = createRenderer(document.getElementById('app'));
if (params.get('quality')) R.setQuality(params.get('quality'));
const tR = performance.now();
const arena = createArena(R.scene);
const tA = performance.now();
const lasers = new LaserView(R.scene);
const orbs = new OrbView(R.scene);
const bombs = new BombView(R.scene);
const fx = new Effects(R.scene);

const controls = new OrbitControls(R.camera, R.renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.6, 0);
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.5;
controls.maxDistance = 60;

// ---------------------------------------------------------------- views
const DEG = Math.PI / 180;
let follow = null;
function orbitPos(pitchDeg, dist, yawDeg = 0, target = new THREE.Vector3(0, 0.6, 0)) {
  const p = pitchDeg * DEG;
  const y = yawDeg * DEG;
  return new THREE.Vector3(target.x - Math.sin(y) * Math.cos(p) * dist, target.y + Math.sin(p) * dist, target.z - Math.cos(y) * Math.cos(p) * dist);
}
function setView(name) {
  follow = null;
  const t = new THREE.Vector3(0, 0.6, 0);
  const fov = name === 'v2' ? 56 : 50;
  if (R.camera.fov !== fov) {
    R.camera.fov = fov;
    R.camera.updateProjectionMatrix();
  }
  switch (name) {
    case 'v2':
      // GAME's default camera (lead brief): pitch 33 deg, distance 15, vFOV 56, orbiting the local player (bot 0)
      follow = { bot: 0, orbit: { pitch: 33, dist: 15 } };
      break;
    case 'low':
      R.camera.position.set(4.2, 1.45, -8.9);
      t.set(0, 0.7, 1.5);
      break;
    case 'mascot':
      follow = { bot: 0, off: new THREE.Vector3(0.9, 1.0, 2.3), look: new THREE.Vector3(0, 0.62, 0) };
      break;
    case 'side':
      follow = { bot: 0, off: new THREE.Vector3(2.6, 0.9, 0.4), look: new THREE.Vector3(0, 0.55, 0) };
      break;
    case 'corner':
      t.set(-7.6, 0.7, 7.6);
      R.camera.position.set(-4.2, 2.6, 4.0);
      break;
    case 'balloons':
      R.camera.position.set(0.4, 1.6, -6.9);
      t.set(0, 0.8, -2.6);
      break;
    case 'top':
      R.camera.position.copy(orbitPos(78, 22));
      break;
    case 'game':
      R.camera.position.copy(orbitPos(50, 14));
      break;
    case 'ref':
      // closest to the key frames: ~38 deg pitch, whole square + festival backdrop
      t.set(0, 0.6, 1.2);
      R.camera.position.copy(orbitPos(37, 17.5, 0, t));
      break;
    case 'overview':
    default:
      // like the reference frames: ~45-50 deg pitch from the -z side, whole arena in view
      R.camera.position.copy(orbitPos(44, 19.5, 0, t));
      break;
  }
  controls.target.copy(t);
  R.camera.lookAt(t);
  controls.update();
}
setView(params.get('view') || 'overview');

// ---------------------------------------------------------------- bots
const BOT_DEFS = [
  { name: 'Koschey', title: 'Wind-Adorned', isLocal: true },
  { name: 'Ostayeam', title: 'IDIOT' },
  { name: 'Percy', title: 'Shaper of Heavens', immuneShowcase: true },
  { name: 'Nemesis', title: '', fearShowcase: true },
  { name: 'Mirelle', title: '' },
  { name: 'Tobu', title: '<JURAMENTO>' },
];
const bots = BOT_DEFS.map((d, i) => {
  const opts = { color: PLAYER_COLORS[i], name: d.name, title: d.title, isLocal: !!d.isLocal };
  const m = useWorldMascot ? createMascot(opts) : createRiggedMascot(opts);
  const a = (i / BOT_DEFS.length) * Math.PI * 2;
  const bot = {
    ...d,
    m,
    x: Math.cos(a) * 2.5,
    z: Math.sin(a) * 2.5,
    y: 0,
    vy: 0,
    ry: 0,
    px: 0,
    pz: 0,
    speed: 0,
    tx: 0,
    tz: 0,
    retarget: 0,
    immuneUntil: 0,
    fearUntil: 0,
    fdx: 0,
    fdz: 0,
    hitBeams: new Set(),
    st: { moving: false, speed: 0, airborne: false, vy: 0, feared: false, immune: false, fearLeftMs: 0 },
  };
  bot.px = bot.x;
  bot.pz = bot.z;
  R.scene.add(m.root);
  return bot;
});

// ---------------------------------------------------------------- scripted world events
let beams = [];
let orbList = []; // {id,k,x,z,at,exp,bomb?}
let bombList = []; // {id,x,z,at,boomAt,done}
let nextId = 1;
let autoOn = params.get('auto') !== '0';
let frozen = false;
let paused = false; // stop the simulation clock (rendering continues) - used for deterministic screenshots
let pauseOffset = 0; // ms the world clock lags performance.now()
let pausedAt = 0;
const worldNow = () => (paused ? pausedAt : performance.now()) - pauseOffset;
const H = ARENA_HALF;
const rnd = (a, b) => a + Math.random() * (b - a);

/** @param {'fast'|'slow'} [tier] per-beam `spd` (beams carry their own speed; the views must not assume one) */
function addBeams(kind, t0, tier = 'fast') {
  const spd = tier === 'slow' ? LASER_SPEED_SLOW : LASER_SPEED;
  const s = Math.random() < 0.5 ? 1 : -1;
  const ax = Math.random() < 0.5 ? 'x' : 'z';
  const list = [];
  if (kind === 'line') list.push({ ax, from: -H * s, to: H * s });
  else if (kind === 'lines') list.push({ ax, from: -H, to: H }, { ax, from: H, to: -H });
  else if (kind === 'cross') list.push({ ax: 'x', from: -H * s, to: H * s }, { ax: 'z', from: -H, to: H });
  else if (kind === 'square') list.push({ ax: 'x', from: -H, to: H }, { ax: 'x', from: H, to: -H }, { ax: 'z', from: -H, to: H }, { ax: 'z', from: H, to: -H });
  let end = t0;
  for (const b of list) {
    b.id = nextId++;
    b.t0 = t0;
    b.spd = spd;
    beams.push(b);
    end = Math.max(end, beamTimes(b).tGone);
  }
  return end;
}

function addOrb(k, x, z, now, life, extra = {}) {
  const o = { id: nextId++, k, x, z, at: now, exp: now + life, ...extra };
  orbList.push(o);
  orbs.add(o);
  return o;
}

function addBomb(x, z, now) {
  const b = { id: nextId++, x, z, at: now, boomAt: now + BOMB_FUSE_MS, done: false };
  bombList.push(b);
  bombs.add(b);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd(0, 1);
    addOrb('yellow', x + Math.cos(a) * YELLOW_RING_RADIUS, z + Math.sin(a) * YELLOW_RING_RADIUS, now, BOMB_FUSE_MS + YELLOW_LIFETIME_AFTER_BOOM_MS, { bomb: b.id });
  }
  return b;
}

function trigger(name, now = worldNow()) {
  const [base, tier] = String(name).split(':'); // e.g. 'square:slow'
  if (tier) return addBeams(base, now, tier);
  switch (name) {
    case 'line':
    case 'lines':
    case 'cross':
    case 'square':
      return addBeams(name, now);
    case 'bomb':
      return addBomb(rnd(-2.5, 2.5), rnd(-2.5, 2.5), now);
    case 'bomb-center':
      return addBomb(0.6, -0.4, now);
    case 'bombs-wave':
      addBomb(0.4, -0.6, now);
      setTimeout(() => addBomb(2.3, 1.4, worldNow()), 400);
      return;
    case 'pink':
      for (let i = 0; i < 3; i++) addOrb('pink', rnd(-5, 5), rnd(-5, 5), now, 8000);
      return;
    case 'greens':
      for (let i = 0; i < 5; i++) addOrb('green', rnd(-2.5, 2.5), rnd(-2.5, 2.5), now, 10000);
      return;
    case 'showcase':
      addOrb('green', -1.3, -3.2, now, 60000);
      addOrb('pink', 0, -2.6, now, 60000);
      addOrb('yellow', 1.3, -3.2, now, 60000);
      addOrb('green', -2.4, -1.0, now, 60000);
      return;
  }
}

function clearAll() {
  beams = [];
  for (const o of orbList) orbs.remove(o.id, { taken: false });
  orbList = [];
  for (const b of bombList) bombs.explode(b.id);
  bombList = [];
}

// automatic loop
// like the round: slow tier first (tutorial + opening chain), then mixed
const PATTERNS = ['line:slow', 'cross:slow', 'square:slow', 'lines:fast', 'cross:fast', 'square:fast', 'square:slow', 'lines:fast'];
let patIdx = 0;
let nextPatternAt = performance.now() + 1500;
let nextGreenAt = performance.now() + 500;
let nextPinkAt = performance.now() + 9000;
let nextBombAt = performance.now() + 6000;

function autoScript(now) {
  if (!autoOn) return;
  if (now >= nextPatternAt) {
    const end = trigger(PATTERNS[patIdx++ % PATTERNS.length], now);
    nextPatternAt = end + rnd(900, 2200);
  }
  const greens = orbList.filter((o) => o.k === 'green').length;
  if (now >= nextGreenAt) {
    if (greens < 3) addOrb('green', rnd(-PLAY_LIMIT + 0.5, PLAY_LIMIT - 0.5), rnd(-PLAY_LIMIT + 0.5, PLAY_LIMIT - 0.5), now, 10000);
    nextGreenAt = now + rnd(1500, 3000);
  }
  if (now >= nextPinkAt) {
    for (let i = 0; i < 2; i++) addOrb('pink', rnd(-5, 5), rnd(-5, 5), now, 8000);
    nextPinkAt = now + 26000;
  }
  if (now >= nextBombAt) {
    addBomb(rnd(-2.5, 2.5), rnd(-2.5, 2.5), now);
    if (Math.random() < 0.6) setTimeout(() => addBomb(rnd(-3, 3), rnd(-3, 3), worldNow()), 400);
    nextBombAt = now + 15000;
  }
}

// ---------------------------------------------------------------- per-frame sim
const _v = new THREE.Vector3();
let fearShowcaseAt = performance.now() + 2000;

function simBots(dt, now) {
  for (let i = 0; i < bots.length; i++) {
    const b = bots[i];
    b.px = b.x;
    b.pz = b.z;
    const feared = now < b.fearUntil;
    const immune = now < b.immuneUntil || !!b.immuneShowcase;
    let vx = 0;
    let vz = 0;
    if (b.forceDir) {
      vx = b.forceDir[0] * MOVE_SPEED;
      vz = b.forceDir[1] * MOVE_SPEED;
    } else if (frozen) {
      // stand still (close-up shots)
    } else if (feared) {
      vx = b.fdx * MOVE_SPEED;
      vz = b.fdz * MOVE_SPEED;
    } else {
      // walk toward the nearest live balloon, else a wander point
      let best = null;
      let bd = 1e9;
      for (const o of orbList) {
        if (now < o.at) continue;
        const d = Math.hypot(o.x - b.x, o.z - b.z) + (o.k === 'yellow' ? 1.5 : 0) + i * 0.4;
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      b.retarget -= dt;
      if (b.retarget <= 0 || Math.hypot(b.tx - b.x, b.tz - b.z) < 0.4) {
        b.retarget = rnd(1.5, 3.5);
        b.tx = rnd(-5.5, 5.5);
        b.tz = rnd(-5.5, 5.5);
      }
      const tx = best && i % 3 !== 2 ? best.x : b.tx;
      const tz = best && i % 3 !== 2 ? best.z : b.tz;
      const dx = tx - b.x;
      const dz = tz - b.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        const sp = MOVE_SPEED * (0.62 + (i % 3) * 0.12);
        vx = (dx / d) * sp;
        vz = (dz / d) * sp;
      }
    }
    b.x = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, b.x + vx * dt));
    b.z = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, b.z + vz * dt));
    const sp = Math.hypot(vx, vz);
    if (sp > 0.1) {
      const target = Math.atan2(vx, vz);
      let dr = target - b.ry;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      b.ry += dr * (1 - Math.exp(-14 * dt));
    } else if (frozen) {
      b.ry += (0 - b.ry) * (1 - Math.exp(-8 * dt));
    }

    // jump over approaching beams (bots fail sometimes)
    if (b.y <= 0 && !feared) {
      for (const bm of beams) {
        const s = beamState(bm, now + 140);
        if (!s) continue;
        const d = (bm.ax === 'x' ? b.x : b.z) - s.pos;
        if (Math.abs(d) < 0.5 && s.phase !== 'end') {
          if (!bm._decided) bm._decided = new Map();
          if (!bm._decided.has(i)) bm._decided.set(i, Math.random() < 0.82);
          if (bm._decided.get(i)) b.vy = JUMP_VELOCITY;
        }
      }
      if (frozen && Math.random() < dt * 0.25) b.vy = JUMP_VELOCITY;
    }
    if (b.y > 0 || b.vy > 0) {
      b.vy -= GRAVITY * dt;
      b.y += b.vy * dt;
      if (b.y <= 0) {
        b.y = 0;
        b.vy = 0;
      }
    }

    // laser hits
    for (const bm of beams) {
      if (b.hitBeams.has(bm.id)) continue;
      if (laserHitTest(bm, now - dt * 1000, b.px, b.pz, now, b.x, b.z, b.y)) {
        b.hitBeams.add(bm.id);
        if (!immune) {
          b.m.flashHit();
          fx.floatText(_v.set(b.x, 1.35, b.z), String(LASER_PENALTY).replace('-', '−'), 'red');
        }
      }
    }

    // pickups
    for (let k = orbList.length - 1; k >= 0; k--) {
      const o = orbList[k];
      if (now < o.at) continue;
      if (Math.hypot(o.x - b.x, o.z - b.z) < PICKUP_RADIUS) {
        orbList.splice(k, 1);
        orbs.remove(o.id, { taken: true });
        fx.floatText(_v.set(b.x, 1.35, b.z), '+' + ORB_POINTS[o.k], o.k === 'yellow' ? 'gold' : o.k);
        if (o.k === 'pink') b.immuneUntil = now + IMMUNITY_MS;
      }
    }

    b.speed = sp;
    b.st.moving = sp > 0.1;
    b.st.speed = sp;
    b.st.airborne = b.y > 0;
    b.st.vy = b.vy;
    b.st.feared = feared;
    b.st.immune = immune;
    b.st.fearLeftMs = feared ? b.fearUntil - now : 0;
    b.m.root.position.set(b.x, b.y, b.z);
    b.m.root.rotation.y = b.ry;
    b.m.update(dt, b.st);
  }
  // showcase: one bot gets scared every few seconds even without bombs
  if (now > fearShowcaseAt) {
    fearShowcaseAt = now + 6500;
    const b = bots.find((x) => x.fearShowcase);
    if (b && !frozen) scare(b, now, b.x - rnd(-1, 1), b.z - rnd(-1, 1));
  }
}

function scare(b, now, fromX, fromZ) {
  let dx = b.x - fromX;
  let dz = b.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  const a = Math.atan2(dz / d, dx / d) + (Math.random() - 0.5) * (60 * DEG);
  b.fdx = Math.cos(a);
  b.fdz = Math.sin(a);
  b.fearUntil = now + FEAR_MS;
}

function simWorld(now) {
  // expire
  beams = beams.filter((bm) => now < beamTimes(bm).tGone + 200);
  for (let k = orbList.length - 1; k >= 0; k--) {
    const o = orbList[k];
    if (now >= o.exp) {
      orbList.splice(k, 1);
      orbs.remove(o.id, { taken: false });
    }
  }
  for (let k = bombList.length - 1; k >= 0; k--) {
    const b = bombList[k];
    if (now >= b.boomAt) {
      bombList.splice(k, 1);
      bombs.explode(b.id);
      for (const bot of bots) if (Math.hypot(bot.x - b.x, bot.z - b.z) < BOMB_RADIUS) scare(bot, now, b.x, b.z);
    }
  }
}

// ---------------------------------------------------------------- loop + HUD + perf
const fpsEl = document.getElementById('fps');
const gpuEl = document.getElementById('gpu');
let gpu = 'unknown';
try {
  const gl = R.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
} catch {
  /* ignore */
}
gpuEl.textContent = gpu;

R.renderer.info.autoReset = false; // count all passes of a frame
let last = performance.now();
let frames = 0;
let lastCalls = 0;
let lastTris = 0;
let fpsT = last;
const frameTimes = [];
function frame() {
  const real = performance.now();
  const dt = paused ? 0 : Math.min(0.1, (real - last) / 1000);
  last = real;
  const now = (paused ? pausedAt : real) - pauseOffset; // world clock
  if (!paused) {
    autoScript(now);
    simWorld(now);
    simBots(dt, now);
    arena.update(dt, now);
    lasers.update(beams, now);
    orbs.update(dt, now);
    bombs.update(dt, now);
    fx.update(dt);
  }
  if (follow) {
    const b = bots[follow.bot];
    if (follow.orbit) {
      const tgt = _v.set(b.x, b.y + PLAYER_HEIGHT * 0.63, b.z);
      controls.target.copy(tgt);
      R.camera.position.copy(orbitPos(follow.orbit.pitch, follow.orbit.dist, 0, tgt));
    } else {
      const tgt = _v.set(b.x, 0, b.z).add(follow.look);
      controls.target.copy(tgt);
      R.camera.position.set(b.x + follow.off.x, follow.off.y, b.z + follow.off.z);
    }
  }

  controls.update();
  R.renderer.info.reset();
  R.render();
  lastCalls = R.renderer.info.render.calls;
  lastTris = R.renderer.info.render.triangles;
  frames++;
  frameTimes.push(real);
  if (frameTimes.length > 2000) frameTimes.splice(0, 1000);
  if (real - fpsT > 500) {
    fpsEl.textContent = ((frames * 1000) / (real - fpsT)).toFixed(0) + ' fps · ' + lastCalls + ' draw calls/frame (all passes) · ' + (lastTris / 1000).toFixed(0) + 'k tris';
    frames = 0;
    fpsT = real;
  }
}
R.renderer.setAnimationLoop(frame);

// HUD wiring
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-trig]').forEach((b) => b.addEventListener('click', () => trigger(b.dataset.trig)));
document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => R.setQuality(b.dataset.q)));
const autoBtn = document.getElementById('auto');
autoBtn.addEventListener('click', () => {
  autoOn = !autoOn;
  autoBtn.textContent = 'auto: ' + (autoOn ? 'on' : 'off');
});

window.__preview = {
  R,
  gpu,
  views: { arena, lasers, orbs, bombs, fx },
  bots,
  setView,
  trigger: (n) => trigger(n),
  clear: clearAll,
  auto(on) {
    autoOn = !!on;
    autoBtn.textContent = 'auto: ' + (autoOn ? 'on' : 'off');
  },
  freeze(on) {
    frozen = !!on;
  },
  /** world clock in ms (what the views receive as `now`) */
  now: worldNow,
  pause(on) {
    if (on && !paused) pausedAt = performance.now();
    if (!on && paused) pauseOffset += performance.now() - pausedAt;
    paused = !!on;
  },
  forceRun(i, dx, dz) {
    bots[i].forceDir = dx == null ? null : [dx, dz];
  },
  hop(i) {
    if (bots[i].y <= 0) bots[i].vy = JUMP_VELOCITY;
  },
  placeBot(i, x, z, ry = 0) {
    const b = bots[i];
    b.x = b.px = x;
    b.z = b.pz = z;
    b.ry = ry;
  },
  setQuality: (q) => R.setQuality(q),
  /** average fps over `ms` milliseconds */
  measure(ms = 5000) {
    return new Promise((res) => {
      const t0 = performance.now();
      const n0 = frameTimes.length;
      setTimeout(() => {
        const t1 = performance.now();
        const n = frameTimes.filter((t) => t >= t0 && t <= t1).length;
        res({ fps: (n * 1000) / (t1 - t0), frames: n, drawCallsPerFrame: lastCalls, tris: lastTris, programs: R.renderer.info.programs.length, textures: R.renderer.info.memory.textures, geometries: R.renderer.info.memory.geometries });
      }, ms);
    });
  },
};
window.__preview.ready = async () => {
  await assetsPromise;
  // floor + walkway textures are generated by a worker; wait until they have been filled in
  while (!floorTextures(ARENA_HALF * 2, 2048).ready || !walkwayTextures(1024).ready) await new Promise((r) => setTimeout(r, 50));
  return true;
};
window.__preview.timings = { rendererMs: Math.round(tR - t0), arenaMs: Math.round(tA - tR) };
window.__previewReady = true;
