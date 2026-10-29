// Procedural canvas textures for the world (no downloaded assets). All generated once at load and cached.
import * as THREE from 'three';
import { genFloor, genWalkway, makeNoise, mulberry32 } from './floorGen.js';

export { mulberry32 };


function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function colorTex(cv, { repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// ---------------------------------------------------------------- floor + walkway (generated off the main thread)
// Both start as 1x1 placeholders (materials compile with their maps already bound, so nothing recompiles later) and are
// filled in by a module Worker running floorGen.js. Falls back to synchronous generation if workers are unavailable.
let worker = null;
let workerFailed = false;
let jobId = 0;
const jobs = new Map(); // id -> { done(color, normal, N), sync() }

function makeDataTex(rgba, srgb, repeat) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 16;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function fillTex(t, data, N) {
  t.dispose(); // the size changes: drop the 1x1 GPU allocation, three re-allocates + uploads on next use
  t.image = { data, width: N, height: N };
  t.needsUpdate = true;
}

function syncJob(kind, N, size, done) {
  const r = kind === 'floor' ? genFloor(N, size) : genWalkway(N, size);
  done(r.color, r.normal, r.N);
}

function runJob(kind, N, size, done) {
  if (!workerFailed && typeof Worker !== 'undefined') {
    try {
      if (!worker) {
        worker = new Worker(new URL('./floorWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
          const { id, color, normal, N: n } = e.data;
          const job = jobs.get(id);
          jobs.delete(id);
          if (job) job.done(new Uint8Array(color), new Uint8Array(normal), n);
          if (jobs.size === 0 && worker) {
            worker.terminate();
            worker = null;
          }
        };
        worker.onerror = (err) => {
          // e.g. module workers unsupported: finish the pending jobs on the main thread
          if (err && err.preventDefault) err.preventDefault();
          workerFailed = true;
          if (worker) worker.terminate();
          worker = null;
          const pending = [...jobs.values()];
          jobs.clear();
          for (const job of pending) job.sync();
        };
      }
      const id = ++jobId;
      jobs.set(id, { done, sync: () => syncJob(kind, N, size, done) });
      worker.postMessage({ id, kind, N, size });
      return;
    } catch {
      workerFailed = true;
    }
  }
  syncJob(kind, N, size, done);
}

/**
 * Arena floor textures (raked stone), one texture over the whole floor. Returned immediately as placeholders; the
 * real data arrives from the worker shortly after without blocking the main thread. `ready` flips when filled.
 */
export function floorTextures(worldSize, size = 2048) {
  return cached(`floor${worldSize}_${size}`, () => {
    const map = makeDataTex([118, 119, 124, 255], true, false);
    const normalMap = makeDataTex([128, 128, 255, 255], false, false);
    const res = { map, normalMap, ready: false };
    runJob('floor', size, worldSize, (c, n, N) => {
      fillTex(map, c, N);
      fillTex(normalMap, n, N);
      res.ready = true;
    });
    return res;
  });
}

/** Walkway stone textures, tileable over `tileM` metres (placeholder first, filled by the worker). */
export function walkwayTextures(size = 1024, tileM = 3.6) {
  return cached(`walk${size}_${tileM}`, () => {
    const map = makeDataTex([153, 149, 141, 255], true, true);
    const normalMap = makeDataTex([128, 128, 255, 255], false, true);
    const res = { map, normalMap, ready: false };
    runJob('walk', size, tileM, (c, n, N) => {
      fillTex(map, c, N);
      fillTex(normalMap, n, N);
      res.ready = true;
    });
    return res;
  });
}

/** Tileable lawn texture. */
export function lawnTexture(size = 512) {
  return cached(`lawn${size}`, () => {
    const rng = mulberry32(99);
    const N = size;
    const noise = makeNoise(rng, 16);
    const noise2 = makeNoise(rng, 64);
    const cv = canvas(N);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(N, N);
    const D = img.data;
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const n = noise((px / N) * 16, (py / N) * 16) * 0.6 + noise2((px / N) * 64, (py / N) * 64) * 0.4;
        const blade = Math.random();
        const l = 0.78 + n * 0.32 + (blade > 0.9 ? 0.12 : blade < 0.08 ? -0.12 : 0);
        const i4 = (py * N + px) * 4;
        D[i4] = 86 * l + n * 26;
        D[i4 + 1] = 124 * l + n * 10;
        D[i4 + 2] = 52 * l;
        D[i4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return colorTex(cv, { repeat: true, aniso: 8 });
  });
}

/** Soft radial glow (white, alpha falloff). Used for sprites / halos. */
export function glowTexture() {
  return cached('glow', () => {
    const N = 128;
    const cv = canvas(N);
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Hot emitter flare: bright core, long 4-point streaks, soft halo. Grey-scale; tinted by material color. */
export function flareTexture() {
  return cached('flare', () => {
    const N = 256;
    const cv = canvas(N);
    const ctx = cv.getContext('2d');
    const c = N / 2;
    let g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.06, 'rgba(255,255,255,1)');
    g.addColorStop(0.14, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'lighter';
    for (const [w, h] of [
      [N, 6],
      [6, N],
    ]) {
      g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(c, c, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Small 4-point sparkle star for particles. */
export function sparkleTexture() {
  return cached('sparkle', () => {
    const N = 64;
    const cv = canvas(N);
    const ctx = cv.getContext('2d');
    const c = N / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(c, 0);
    ctx.quadraticCurveTo(c, c, N, c);
    ctx.quadraticCurveTo(c, c, c, N);
    ctx.quadraticCurveTo(c, c, 0, c);
    ctx.quadraticCurveTo(c, c, c, 0);
    ctx.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Soft lumpy smoke puff (alpha). */
export function puffTexture() {
  return cached('puff', () => {
    const rng = mulberry32(5);
    const N = 128;
    const cv = canvas(N);
    const ctx = cv.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * N * 0.18;
      const x = N / 2 + Math.cos(a) * r;
      const y = N / 2 + Math.sin(a) * r;
      const rad = N * (0.18 + rng() * 0.16);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, N, N);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Soft cloud billboard (white with slight grey underside). */
export function cloudTexture() {
  return cached('cloud', () => {
    const rng = mulberry32(42);
    const W = 256;
    const H = 128;
    const cv = canvas(W, H);
    const ctx = cv.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const x = W * (0.18 + rng() * 0.64);
      const y = H * (0.45 + rng() * 0.3) - Math.sin(((x / W) * Math.PI)) * H * 0.18;
      const r = H * (0.16 + rng() * 0.2);
      const g = ctx.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.55, 'rgba(244,247,252,0.55)');
      g.addColorStop(1, 'rgba(230,236,245,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Marbled swirl for the inside of balloons (grey-scale, used as emissive/color map). */
export function swirlTexture() {
  return cached('swirl', () => {
    const rng = mulberry32(31);
    const W = 256;
    const H = 128;
    const noise = makeNoise(rng, 8);
    const cv = canvas(W, H);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H);
    const D = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x / W) * 8;
        const v = (y / H) * 4;
        const w = noise(u, v) * 3 + noise(u * 2 + 3, v * 2) * 1.2;
        const s = 0.5 + 0.5 * Math.sin((x / W) * Math.PI * 6 + (y / H) * Math.PI * 3 + w * 2.2);
        const l = 0.55 + 0.45 * Math.pow(s, 2);
        const i4 = (y * W + x) * 4;
        D[i4] = D[i4 + 1] = D[i4 + 2] = l * 255;
        D[i4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

/** Red egg-hut skin: lacquered red with teal leaf ornaments and gold bands (wraps around a lathe). */
export function hutTexture() {
  return cached('hut', () => {
    const W = 512;
    const H = 512;
    const cv = canvas(W, H);
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#d84a3a');
    g.addColorStop(0.5, '#c23a2e');
    g.addColorStop(1, '#8e2820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // vertical rib lines
    ctx.strokeStyle = 'rgba(120,20,15,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      ctx.moveTo((i / 16) * W, 0);
      ctx.lineTo((i / 16) * W, H);
      ctx.stroke();
    }
    // gold bands
    ctx.fillStyle = '#e6b94a';
    ctx.fillRect(0, H * 0.62, W, 8);
    ctx.fillRect(0, H * 0.3, W, 6);
    // teal leaf ornaments
    for (let i = 0; i < 8; i++) {
      const x = ((i + 0.5) / 8) * W;
      const y = H * 0.46;
      ctx.fillStyle = '#2bb3a3';
      ctx.beginPath();
      ctx.ellipse(x - 14, y, 10, 30, -0.4, 0, Math.PI * 2);
      ctx.ellipse(x + 14, y, 10, 30, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e6b94a';
      ctx.beginPath();
      ctx.arc(x, y + 20, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

/** Tall yellow festival banner with an original emblem. */
export function bannerTexture() {
  return cached('banner', () => {
    const W = 128;
    const H = 512;
    const cv = canvas(W, H);
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#e8b520');
    g.addColorStop(0.5, '#ffd84a');
    g.addColorStop(1, '#e8b520');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#b8401f';
    ctx.fillRect(0, 0, W, 18);
    ctx.fillRect(0, H - 60, W, 8);
    ctx.fillStyle = '#7a2a12';
    ctx.fillRect(10, 18, 6, H - 80);
    ctx.fillRect(W - 16, 18, 6, H - 80);
    // emblem: stylised critter head
    ctx.fillStyle = '#b8401f';
    const cx = W / 2;
    const cy = H * 0.36;
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.ellipse(cx - 18, cy - 44, 9, 24, -0.25, 0, Math.PI * 2);
    ctx.ellipse(cx + 18, cy - 44, 9, 24, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.arc(cx - 11, cy - 4, 5, 0, Math.PI * 2);
    ctx.arc(cx + 11, cy - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    // swallow-tail cut is done by alpha
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(W / 2, H - 50);
    ctx.lineTo(W, H);
    ctx.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Striped canvas for tents / awnings. */
export function stripeTexture(a = '#f3ead6', b = '#c98f4e', stripes = 8) {
  return cached(`stripe${a}${b}${stripes}`, () => {
    const W = 256;
    const cv = canvas(W, 8);
    const ctx = cv.getContext('2d');
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? b : a;
      ctx.fillRect((i / stripes) * W, 0, W / stripes + 1, 8);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

/** Text sprite canvas helper (used by effects float texts). */
export function makeCanvas(w, h) {
  return canvas(w, h);
}
