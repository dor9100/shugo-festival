// Pure (DOM-free) generators for the raked-stone floor and walkway textures. Used by floorWorker.js (off the main
// thread) and as a synchronous fallback by textures.js. Output: RGBA bytes, rows bottom-up (DataTexture, flipY false).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise on a `period` x `period` lattice. Returns f(x, y) in [0, 1]. */
export function makeNoise(rng, period) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * period + x0];
    const b = g[y0 * period + x1];
    const c = g[y1 * period + x0];
    const d = g[y1 * period + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/**
 * Raked-stone "scales": irregular overlapping discs (random priority -> scalloped borders), each filled with thick
 * rounded ridges that run almost parallel (gentle fan or long arcs), direction varying per scale.
 * Returns per-pixel height (0 gap .. 1 ridge top), scale tint and edge darkening.
 */
function scaleField({ N, worldSize, wrap, seed, spacing, rMin, rMax, period, ridge = 0.8 }) {
  const rng = mulberry32(seed);
  const ppm = N / worldSize;
  const G = wrap ? Math.max(1, Math.round(worldSize / spacing)) : Math.ceil(worldSize / spacing) + 2;
  const cellW = wrap ? worldSize / G : spacing;
  const off = wrap ? 0 : spacing; // non-wrapped: seeds also just outside the edges
  const seeds = [];
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const sx = (i + 0.5 + (rng() - 0.5) * 0.7) * cellW - off;
      const sz = (j + 0.5 + (rng() - 0.5) * 0.7) * cellW - off;
      const r = (rMin + rng() * (rMax - rMin)) * cellW;
      const ang = (rng() < 0.5 ? 0.6 : -0.6) + (rng() - 0.5) * 1.6 + (rng() < 0.3 ? Math.PI / 2 : 0);
      seeds.push({
        x: sx,
        z: sz,
        r,
        r2: r * r,
        pri: rng(),
        dx: Math.cos(ang),
        dz: Math.sin(ang),
        type: rng() < 0.35 ? 0 : 1, // 0 arcs around a far centre, 1 gently fanning strokes
        far: 2.5 + rng() * 5.5,
        p: period * (0.9 + rng() * 0.25),
        tint: 0.9 + rng() * 0.16,
        off: rng() * 10,
      });
    }
  }
  // per lookup-cell candidate lists, highest priority first
  const LC = Math.max(1, Math.ceil(worldSize / (spacing * 0.5)));
  const lcw = worldSize / LC;
  const lists = Array.from({ length: LC * LC }, () => []);
  for (const s of seeds) {
    const i0 = Math.floor((s.x - s.r) / lcw);
    const i1 = Math.floor((s.x + s.r) / lcw);
    const j0 = Math.floor((s.z - s.r) / lcw);
    const j1 = Math.floor((s.z + s.r) / lcw);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let ii = i;
        let jj = j;
        if (wrap) {
          ii = ((i % LC) + LC) % LC;
          jj = ((j % LC) + LC) % LC;
        } else if (i < 0 || j < 0 || i >= LC || j >= LC) continue;
        const L = lists[jj * LC + ii];
        if (!L.includes(s)) L.push(s);
      }
    }
  }
  for (const L of lists) L.sort((a, b) => b.pri - a.pri);
  const W = worldSize;
  // tileable noise when wrapping: lattice period = whole cycles over the tile
  const mkN = (freq) => {
    const per = wrap ? Math.max(2, Math.round(freq * W)) : 64;
    const f = wrap ? per / W : freq;
    const n = makeNoise(rng, per);
    return (x, z) => n(x * f, z * f);
  };
  const nA = mkN(1.1);
  const nB = mkN(4.3);
  const nC = mkN(3);
  const nD = mkN(12);
  const height = new Float32Array(N * N);
  const tint = new Float32Array(N * N);
  const edge = new Float32Array(N * N);
  for (let py = 0; py < N; py++) {
    const z = (py + 0.5) / ppm;
    const lj = Math.min(LC - 1, Math.floor(z / lcw));
    for (let px = 0; px < N; px++) {
      const x = (px + 0.5) / ppm;
      const li = Math.min(LC - 1, Math.floor(x / lcw));
      const L = lists[lj * LC + li];
      let best = null;
      let bdx = 0;
      let bdz = 0;
      let bd2 = 0;
      let nearest = null;
      let nd2 = 1e9;
      let ndx = 0;
      let ndz = 0;
      for (let k = 0; k < L.length; k++) {
        const s = L[k];
        let dx = x - s.x;
        let dz = z - s.z;
        if (wrap) {
          dx -= W * Math.round(dx / W);
          dz -= W * Math.round(dz / W);
        }
        const d2 = dx * dx + dz * dz;
        if (d2 < s.r2) {
          best = s;
          bdx = dx;
          bdz = dz;
          bd2 = d2;
          break;
        }
        if (d2 < nd2) {
          nd2 = d2;
          nearest = s;
          ndx = dx;
          ndz = dz;
        }
      }
      if (!best) {
        best = nearest;
        bdx = ndx;
        bdz = ndz;
        bd2 = nd2;
      }
      const i = py * N + px;
      if (!best) {
        height[i] = 0.5;
        tint[i] = 1;
        edge[i] = 1;
        continue;
      }
      const s = best;
      const warp = (nA(x, z) - 0.5) * 0.12 + (nB(x, z) - 0.5) * 0.03;
      const along = bdx * s.dx + bdz * s.dz + s.far;
      const across = -bdx * s.dz + bdz * s.dx;
      let phase =
        s.type === 0 ? (Math.sqrt(along * along + across * across) + warp) / s.p : (Math.atan2(across, along) * s.far + warp) / s.p;
      phase += s.off + (nD(x, z) - 0.5) * 0.16; // slightly irregular, hand-raked stroke edges
      const fr = phase - Math.floor(phase);
      // thick rounded ridge with a narrower dark gap
      let h = fr < ridge ? Math.sin((fr / ridge) * Math.PI) : 0;
      h = Math.pow(h, 0.38);
      h *= 0.82 + 0.18 * nC(x + phase * 0.23, z);
      height[i] = h;
      tint[i] = s.tint;
      // scale outline: thin dark line where this scale ends
      const dEdge = s.r - Math.sqrt(bd2);
      edge[i] = dEdge < 0 ? 1 : dEdge < 0.035 ? 0.55 + (dEdge / 0.035) * 0.45 : 1;
    }
  }
  return { height, tint, edge };
}

/** Tangent-space normal map (RGBA bytes) from a height field; rows bottom-up (row index grows with v). */
function normalBytes(h, w, hh, strength, wrap) {
  const d = new Uint8Array(w * hh * 4);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      let xl = x - 1;
      let xr = x + 1;
      let yd = y - 1;
      let yu = y + 1;
      if (wrap) {
        xl = (xl + w) % w;
        xr = xr % w;
        yd = (yd + hh) % hh;
        yu = yu % hh;
      } else {
        if (xl < 0) xl = 0;
        if (xr >= w) xr = w - 1;
        if (yd < 0) yd = 0;
        if (yu >= hh) yu = hh - 1;
      }
      const nx = -(h[y * w + xr] - h[y * w + xl]) * strength;
      const ny = -(h[yu * w + x] - h[yd * w + x]) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * w + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return d;
}

/**
 * Arena floor: grey stone with raked fans, one texture for the whole floor (PlaneGeometry rotated -PI/2 about X).
 * Only the z = 0 centre rail gets baked ambient occlusion (the floor has a single rail along x).
 * @returns {{ color: Uint8Array, normal: Uint8Array, N: number }}
 */
export function genFloor(N, worldSize) {
  const ppm = N / worldSize;
  const half = worldSize / 2;
  const { height, tint, edge } = scaleField({ N, worldSize, wrap: false, seed: 20261029, spacing: 1.85, rMin: 0.9, rMax: 1.35, period: 0.16 });
  const rng = mulberry32(77);
  const blot = makeNoise(rng, 256);
  const D = new Uint8Array(N * N * 4);
  for (let py = 0; py < N; py++) {
    const wz = (py + 0.5) / ppm;
    for (let px = 0; px < N; px++) {
      const wx = (px + 0.5) / ppm;
      const i = py * N + px;
      const v = height[i];
      const ax = Math.abs(wx - half);
      const az = Math.abs(wz - half);
      const toBorder = half - Math.max(ax, az);
      let ao = 1;
      if (az < 0.3) ao *= 0.8 + 0.2 * (az / 0.3);
      if (toBorder < 0.4) ao *= 0.7 + 0.3 * (toBorder / 0.4);
      const b = 0.9 + blot(wx * 0.8, wz * 0.8) * 0.2;
      const speck = 0.93 + Math.random() * 0.14;
      const lum = (0.6 + v * 0.28) * b * speck * tint[i] * (0.5 + 0.5 * edge[i]) * ao;
      const i4 = i * 4;
      D[i4] = Math.min(255, lum * (150 + v * 14));
      D[i4 + 1] = Math.min(255, lum * (152 + v * 10));
      D[i4 + 2] = Math.min(255, lum * (158 + v * 4));
      D[i4 + 3] = 255;
      height[i] = v * edge[i];
    }
  }
  return { color: D, normal: normalBytes(height, N, N, 1.25, false), N };
}

/** Walkway stone: lighter, smaller raked scales. Tileable (covers `tileM` metres). */
export function genWalkway(N, tileM) {
  const { height, tint, edge } = scaleField({ N, worldSize: tileM, wrap: true, seed: 777, spacing: 1.2, rMin: 0.95, rMax: 1.4, period: 0.1 });
  const rng = mulberry32(78);
  const blot = makeNoise(rng, 16);
  const D = new Uint8Array(N * N * 4);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const i = py * N + px;
      const v = height[i];
      const b = 0.92 + blot((px / N) * 16, (py / N) * 16) * 0.14;
      const lum = (0.72 + v * 0.22) * b * (0.95 + Math.random() * 0.08) * (0.6 + 0.4 * tint[i]) * (0.5 + 0.5 * edge[i]);
      const i4 = i * 4;
      D[i4] = Math.min(255, lum * 186);
      D[i4 + 1] = Math.min(255, lum * 181);
      D[i4 + 2] = Math.min(255, lum * 172);
      D[i4 + 3] = 255;
      height[i] = v * edge[i];
    }
  }
  return { color: D, normal: normalBytes(height, N, N, 1.8, true), N };
}
