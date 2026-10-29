// The mascot's body: an original cute festival critter ("Pompom"), built from primitives in the chibi rest pose of
// the rig and merged into ONE skinned geometry that every mascot shares (one draw call + one shadow call each).
// Parts are rigidly weighted to their bone, except the robe, which is smoothly skinned along the spine and follows
// the thighs at the hem. Colours are vertex colours; `aTint` = 1 marks robe-coloured vertices (multiplied by the
// per-mascot robe colour uniform in the material).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BONE_INDEX } from './rig.js';

const C = {
  fur: new THREE.Color('#f6ecdc'),
  furShade: new THREE.Color('#e3cfb4'),
  furLight: new THREE.Color('#fffaf2'),
  caramel: new THREE.Color('#d8a56e'),
  pink: new THREE.Color('#f4a3b4'),
  blush: new THREE.Color('#ff8fa3'),
  nose: new THREE.Color('#6b3a3a'),
  eye: new THREE.Color('#1b1418'),
  eyeIris: new THREE.Color('#3a2a3a'),
  white: new THREE.Color('#ffffff'),
  gold: new THREE.Color('#f0c25a'),
  goldDark: new THREE.Color('#b8862e'),
  robe: new THREE.Color('#ffffff'), // x robe colour
  robeDark: new THREE.Color('#8c8c8c'), // x robe colour (darker trim)
  robeLight: new THREE.Color('#ffffff'),
  petal: new THREE.Color('#ffd1e0'),
  petalCore: new THREE.Color('#ffcc4d'),
  leaf: new THREE.Color('#7cc46a'),
};

let DETAIL = 1; // tessellation factor (1 = players, lower = spectators)
const seg = (n, min = 4) => Math.max(min, Math.round(n * DETAIL));

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

class Builder {
  constructor() {
    this.parts = [];
  }
  /**
   * @param geo geometry already in model space
   * @param opts.bone rigid bone name, or opts.weights(pos) -> [[bone, w], ...]
   * @param opts.color Color or (pos, normal) => Color
   * @param opts.tint 1 = multiplied by the robe colour
   */
  add(geo, { bone, weights, color, tint = 0 }) {
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    if (geo.attributes.uv1) geo.deleteAttribute('uv1');
    if (!geo.index) geo = indexify(geo);
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const n = pos.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const tin = new Float32Array(n);
    const p = new THREE.Vector3();
    const nn = new THREE.Vector3();
    const tp = geo.attributes.tParam;
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      nn.fromBufferAttribute(nor, i);
      if (tp) p.userT = tp.getX(i);
      if (weights) {
        const w = weights(p).filter((x) => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const tot = w.reduce((a, x) => a + x[1], 0) || 1;
        w.forEach(([b, x], k) => {
          si[i * 4 + k] = BONE_INDEX[b];
          sw[i * 4 + k] = x / tot;
        });
      } else {
        si[i * 4] = BONE_INDEX[bone];
        sw[i * 4] = 1;
      }
      const c = typeof color === 'function' ? color(p, nn) : color;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      tin[i] = typeof tint === 'function' ? tint(p, nn) : tint;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aTint', new THREE.Float32BufferAttribute(tin, 1));
    if (tp) geo.deleteAttribute('tParam');
    this.parts.push(geo);
    return geo;
  }
  build() {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

function indexify(geo) {
  const n = geo.attributes.position.count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/** Ellipsoid at `c` with radii `r` (x,y,z), optional euler rotation. */
function ellipsoid(c, r, rot = [0, 0, 0], ws = 10, hs = 7) {
  const g = new THREE.SphereGeometry(1, seg(ws, 5), seg(hs, 4));
  _q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  _m.compose(_v.copy(c), _q, _s.set(r[0], r[1], r[2]));
  g.applyMatrix4(_m);
  return g;
}

/** Tapered capsule from a (radius ra) to b (radius rb). */
function limb(a, b, ra, rb, segs = 8) {
  const len = a.distanceTo(b);
  const pts = [];
  const N = 3;
  for (let i = 0; i <= N; i++) {
    const t = -Math.PI / 2 + (Math.PI / 2) * (i / N);
    pts.push(new THREE.Vector2(Math.cos(t) * ra + 1e-4, ra * Math.sin(t)));
  }
  for (let i = 0; i <= N; i++) {
    const t = (Math.PI / 2) * (i / N);
    pts.push(new THREE.Vector2(Math.cos(t) * rb + 1e-4, len + rb * Math.sin(t)));
  }
  const g = new THREE.LatheGeometry(pts, seg(segs, 6));
  _q.setFromUnitVectors(Y, _v.copy(b).sub(a).normalize());
  _m.compose(a, _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

/** A tube along `curve` with radius(t), closed with a rounded tip; per-vertex curve parameter in `tParam`. */
function plume(curve, radius, segs = 32, radial = 14) {
  segs = seg(segs, 12);
  radial = seg(radial, 8);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [];
  const tpar = [];
  const idx = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const r = radius(t);
    const N = frames.normals[i];
    const Bn = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      pos.push(P.x + N.x * cx + Bn.x * cy, P.y + N.y * cx + Bn.y * cy, P.z + N.z * cx + Bn.z * cy);
      tpar.push(t);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // base cap (inside the robe, but keeps the shadow closed)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tParam', new THREE.Float32BufferAttribute(tpar, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function torus(c, R, r, rot = [Math.PI / 2, 0, 0], scl = [1, 1, 1], segs = 20) {
  const g = new THREE.TorusGeometry(R, r, seg(5, 3), seg(segs, 8));
  _q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  _m.compose(_v.copy(c), _q, _s.set(scl[0], scl[1], scl[2]));
  g.applyMatrix4(_m);
  return g;
}

/** Point on the head ellipsoid surface in direction (dx, dy, dz) from its centre, plus the outward normal. */
function onHead(J, R, dx, dy, dz, push = 0) {
  const d = new THREE.Vector3(dx, dy, dz).normalize();
  // ellipsoid surface along d
  const k = 1 / Math.sqrt((d.x / R.x) ** 2 + (d.y / R.y) ** 2 + (d.z / R.z) ** 2);
  const p = J.headC.clone().addScaledVector(d, k);
  const n = new THREE.Vector3(p.x - J.headC.x, p.y - J.headC.y, p.z - J.headC.z);
  n.set(n.x / (R.x * R.x), n.y / (R.y * R.y), n.z / (R.z * R.z)).normalize();
  p.addScaledVector(n, push);
  return { p, n };
}

/** A flattened ellipsoid lying on the head surface (eyes, blush). */
function decal(J, R, dx, dy, dz, r, push = 0, ws = 16, hs = 12) {
  const { p, n } = onHead(J, R, dx, dy, dz, push);
  const g = new THREE.SphereGeometry(1, seg(ws, 6), seg(hs, 4));
  _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  _m.compose(p, _q, _s.set(r[0], r[1], r[2]));
  g.applyMatrix4(_m);
  return { g, p, n };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Build the shared body geometry.
 * @param tpl rig template (J = joint positions in design units at rest)
 * @param detail tessellation factor (1 = full, ~0.6 = spectator LOD)
 * @returns {{ geometry: THREE.BufferGeometry, height: number }}
 */
export function buildBody(tpl, detail = 1) {
  DETAIL = detail;
  const J = tpl.J;
  const B = new Builder();
  const hipY = J.pelvis.y;
  const chestY = J.spine_05.y;
  const bodyZ = 0.0;

  // ---------------------------------------------------------------- robe (smooth skinned)
  const spineCtl = [
    ['pelvis', J.pelvis.y],
    ['spine_02', J.spine_02.y],
    ['spine_03', J.spine_03.y],
    ['spine_04', J.spine_04.y],
    ['spine_05', J.spine_05.y],
  ];
  const hemY = 0.105;
  const robeWeights = (p) => {
    const w = [];
    // vertical blend along the spine
    if (p.y <= spineCtl[0][1]) w.push(['pelvis', 1]);
    else if (p.y >= spineCtl[spineCtl.length - 1][1]) w.push(['spine_05', 1]);
    else {
      for (let i = 0; i < spineCtl.length - 1; i++) {
        const [b0, y0] = spineCtl[i];
        const [b1, y1] = spineCtl[i + 1];
        if (p.y >= y0 && p.y <= y1) {
          const t = (p.y - y0) / (y1 - y0);
          w.push([b0, 1 - t], [b1, t]);
          break;
        }
      }
    }
    // skirt follows the thighs toward the hem
    const k = Math.pow(smooth(hipY + 0.02, hemY, p.y), 1.3) * 0.55;
    if (k > 0) {
      const sl = smooth(-0.06, 0.06, p.x);
      const scaleRest = 1 - k;
      for (const x of w) x[1] *= scaleRest;
      w.push(['thigh_l', k * sl], ['thigh_r', k * (1 - sl)]);
    }
    return w;
  };
  const prof = [
    [0.001, hemY - 0.004],
    [0.163, hemY - 0.004],
    [0.18, hemY + 0.012],
    [0.179, hemY + 0.04],
    [0.17, hipY - 0.04],
    [0.152, hipY + 0.0],
    [0.14, hipY + 0.05],
    [0.132, chestY - 0.07],
    [0.122, chestY - 0.025],
    [0.1, chestY + 0.005],
    [0.06, chestY + 0.03],
    [0.001, chestY + 0.04],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const robe = new THREE.LatheGeometry(prof, seg(26, 12));
  robe.applyMatrix4(_m.compose(_v.set(0, 0, bodyZ), _q.identity(), _s.set(1, 1, 0.9)));
  B.add(robe, {
    weights: robeWeights,
    color: (p) => (p.y < hemY + 0.035 ? C.robeDark : C.robe),
    tint: 1,
  });
  // gold hem trim + belt sash + bow at the back
  B.add(torus(new THREE.Vector3(0, hemY + 0.02, bodyZ), 0.18, 0.011, [Math.PI / 2, 0, 0], [1, 1, 0.9]), { weights: robeWeights, color: C.gold });
  const beltY = hipY + 0.035;
  B.add(torus(new THREE.Vector3(0, beltY, bodyZ), 0.146, 0.02, [Math.PI / 2, 0, 0], [1, 1, 0.9]), { weights: robeWeights, color: C.robeDark, tint: 1 });
  B.add(ellipsoid(new THREE.Vector3(0.045, beltY + 0.005, -0.14), [0.05, 0.034, 0.02], [0, 0.35, 0.5]), { bone: 'spine_02', color: C.gold });
  B.add(ellipsoid(new THREE.Vector3(-0.045, beltY + 0.005, -0.14), [0.05, 0.034, 0.02], [0, -0.35, -0.5]), { bone: 'spine_02', color: C.gold });
  B.add(ellipsoid(new THREE.Vector3(0, beltY + 0.003, -0.135), [0.02, 0.02, 0.018]), { bone: 'spine_02', color: C.goldDark });
  // front clasp + a little festival bell under the collar
  B.add(ellipsoid(new THREE.Vector3(0, beltY + 0.004, 0.128), [0.022, 0.024, 0.012]), { bone: 'spine_02', color: C.gold });

  // fluffy collar ruff + bell
  const collarY = chestY + 0.02;
  B.add(torus(new THREE.Vector3(0, collarY, bodyZ + 0.005), 0.078, 0.038, [Math.PI / 2, 0, 0], [1, 1, 0.92], 18), { bone: 'spine_05', color: C.furLight });
  B.add(ellipsoid(new THREE.Vector3(0, collarY - 0.045, 0.11), [0.024, 0.024, 0.024]), { bone: 'spine_05', color: C.gold });
  B.add(ellipsoid(new THREE.Vector3(0, collarY - 0.058, 0.128), [0.008, 0.006, 0.006]), { bone: 'spine_05', color: C.goldDark });

  // ---------------------------------------------------------------- head
  const R = new THREE.Vector3(0.205, 0.188, 0.19);
  const head = ellipsoid(J.headC, [R.x, R.y, R.z], [0, 0, 0], 26, 18);
  B.add(head, {
    bone: 'head',
    color: (p) => {
      // soft underside shading for a toon-ish volume
      const k = smooth(J.headC.y - 0.2, J.headC.y + 0.05, p.y);
      return C.furShade.clone().lerp(C.fur, 0.35 + 0.65 * k);
    },
  });
  // cheek fluff
  for (const sx of [1, -1]) {
    B.add(ellipsoid(new THREE.Vector3(0.16 * sx, J.headC.y - 0.065, J.headC.z + 0.03), [0.07, 0.055, 0.065], [0, 0, 0.35 * sx], 12, 8), { bone: 'head', color: C.fur });
  }
  // forehead tuft (three little curls)
  B.add(ellipsoid(new THREE.Vector3(0, J.headC.y + 0.172, J.headC.z + 0.07), [0.045, 0.035, 0.045], [0.5, 0, 0]), { bone: 'head', color: C.fur });
  B.add(ellipsoid(new THREE.Vector3(0.032, J.headC.y + 0.18, J.headC.z + 0.04), [0.036, 0.03, 0.036], [0.3, 0, -0.4]), { bone: 'head', color: C.fur });
  B.add(ellipsoid(new THREE.Vector3(-0.03, J.headC.y + 0.182, J.headC.z + 0.045), [0.036, 0.03, 0.036], [0.3, 0, 0.4]), { bone: 'head', color: C.fur });
  // muzzle, nose (heart-ish: two lobes), mouth
  const muz = onHead(J, R, 0, -0.42, 1, -0.03);
  B.add(ellipsoid(muz.p, [0.085, 0.058, 0.062], [0, 0, 0], 14, 10), { bone: 'head', color: C.furLight });
  const noseP = muz.p.clone().add(new THREE.Vector3(0, 0.03, 0.05));
  B.add(ellipsoid(noseP.clone().add(new THREE.Vector3(0.011, 0.002, 0)), [0.016, 0.013, 0.012], [0, 0, -0.5]), { bone: 'head', color: C.nose });
  B.add(ellipsoid(noseP.clone().add(new THREE.Vector3(-0.011, 0.002, 0)), [0.016, 0.013, 0.012], [0, 0, 0.5]), { bone: 'head', color: C.nose });
  B.add(ellipsoid(noseP.clone().add(new THREE.Vector3(0, -0.01, 0.001)), [0.011, 0.012, 0.011]), { bone: 'head', color: C.nose });
  B.add(ellipsoid(noseP.clone().add(new THREE.Vector3(0.008, 0.008, 0.01)), [0.005, 0.004, 0.003]), { bone: 'head', color: C.white });
  for (const sx of [1, -1]) {
    const mp = muz.p.clone().add(new THREE.Vector3(0.016 * sx, -0.012, 0.055));
    B.add(torus(mp, 0.015, 0.004, [0, 0, Math.PI], [1, 1, 1], 8), { bone: 'head', color: C.nose });
  }
  // eyes: big glossy ovals with two highlights; blush
  for (const sx of [1, -1]) {
    const e = decal(J, R, 0.39 * sx, 0.02, 1, [0.032, 0.044, 0.02], -0.004, 14, 10);
    B.add(e.g, { bone: 'head', color: C.eye });
    const hl = e.p.clone().addScaledVector(e.n, 0.016).add(new THREE.Vector3(0.011 * sx, 0.016, 0));
    B.add(ellipsoid(hl, [0.011, 0.012, 0.007], [0, 0, 0], 7, 5), { bone: 'head', color: C.white });
    const hl2 = e.p.clone().addScaledVector(e.n, 0.016).add(new THREE.Vector3(-0.01 * sx, -0.017, 0));
    B.add(ellipsoid(hl2, [0.005, 0.005, 0.004], [0, 0, 0], 6, 4), { bone: 'head', color: C.white });
    const bl = decal(J, R, 0.66 * sx, -0.32, 1, [0.03, 0.019, 0.008], 0.002, 10, 6);
    B.add(bl.g, { bone: 'head', color: C.blush });
  }

  // ---------------------------------------------------------------- ears (tall, upright, tufted tips) + a flower
  for (const [bone, sx] of [['ear_l', 1], ['ear_r', -1]]) {
    const base = J[bone];
    const tilt = -0.16 * sx;
    const part = (center, r, color, ws = 16, hs = 12) => {
      const g = new THREE.SphereGeometry(1, seg(ws, 6), seg(hs, 4));
      g.scale(r[0], r[1], r[2]);
      g.translate(center[0], center[1], center[2]);
      g.rotateX(-0.12);
      g.rotateZ(tilt);
      g.translate(base.x, base.y, base.z);
      B.add(g, { bone, color });
    };
    part([0, 0.1, 0], [0.058, 0.125, 0.036], C.fur, 12, 9);
    part([0, 0.092, 0.021], [0.034, 0.09, 0.018], C.pink, 8, 6);
    part([0, 0.19, -0.001], [0.042, 0.043, 0.03], C.caramel, 9, 7);
  }
  // flower pinned at the base of the left ear (petals + golden core + a leaf)
  {
    const fc = J.ear_l.clone().add(new THREE.Vector3(0.03, 0.035, 0.05));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = fc.clone().add(new THREE.Vector3(Math.cos(a) * 0.022, Math.sin(a) * 0.022, 0.004));
      B.add(ellipsoid(p, [0.016, 0.016, 0.008], [0, 0, a], 6, 4), { bone: 'head', color: C.petal });
    }
    B.add(ellipsoid(fc.clone().add(new THREE.Vector3(0, 0, 0.012)), [0.012, 0.012, 0.009], [0, 0, 0], 10, 8), { bone: 'head', color: C.petalCore });
    B.add(ellipsoid(fc.clone().add(new THREE.Vector3(-0.028, -0.022, -0.004)), [0.022, 0.009, 0.006], [0, 0, 0.6], 8, 6), { bone: 'head', color: C.leaf });
  }

  // ---------------------------------------------------------------- arms: sleeve (robe), gold cuff, paw
  for (const s of ['l', 'r']) {
    const S = J[`upperarm_${s}`];
    const E = J[`lowerarm_${s}`];
    const H = J[`hand_${s}`];
    B.add(ellipsoid(S, [0.048, 0.048, 0.048], [0, 0, 0], 8, 6), { bone: `upperarm_${s}`, color: C.robe, tint: 1 });
    B.add(limb(S, E, 0.042, 0.04), { bone: `upperarm_${s}`, color: C.robe, tint: 1 });
    const dir = H.clone().sub(E).normalize();
    const cuffEnd = E.clone().addScaledVector(dir, E.distanceTo(H) * 0.95);
    B.add(limb(E, cuffEnd, 0.04, 0.05), { bone: `lowerarm_${s}`, color: C.robe, tint: 1 });
    const cuffQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const cuff = new THREE.TorusGeometry(0.047, 0.01, seg(4, 3), seg(12, 8));
    cuff.applyMatrix4(_m.compose(cuffEnd, cuffQ, _s.set(1, 1, 1)));
    B.add(cuff, { bone: `lowerarm_${s}`, color: C.gold });
    const paw = H.clone().addScaledVector(dir, 0.022);
    B.add(ellipsoid(paw, [0.042, 0.04, 0.042], [0, 0, 0], 10, 7), { bone: `hand_${s}`, color: C.fur });
  }

  // ---------------------------------------------------------------- legs + feet
  for (const s of ['l', 'r']) {
    const Hh = J[`thigh_${s}`];
    const K = J[`calf_${s}`];
    const A = J[`foot_${s}`];
    const Bl = J[`ball_${s}`];
    B.add(limb(Hh, K, 0.045, 0.04), { bone: `thigh_${s}`, color: C.fur });
    B.add(limb(K, A, 0.04, 0.034), { bone: `calf_${s}`, color: C.fur });
    const fwd = new THREE.Vector3(Bl.x - A.x, 0, Bl.z - A.z).normalize();
    const footC = A.clone().addScaledVector(fwd, 0.03);
    footC.y = 0.028;
    const yaw = Math.atan2(fwd.x, fwd.z);
    B.add(ellipsoid(footC, [0.048, 0.03, 0.072], [0, yaw, 0], 10, 7), { bone: `foot_${s}`, color: C.fur });
    const toe = Bl.clone().addScaledVector(fwd, 0.015);
    toe.y = 0.022;
    B.add(ellipsoid(toe, [0.04, 0.022, 0.03], [0, yaw, 0], 8, 5), { bone: `ball_${s}`, color: C.furLight });
  }

  // ---------------------------------------------------------------- bushy tail: one smooth plume along a curve,
  // skinned across the 3 tail bones, curling up behind with a caramel tip
  {
    const P = [
      new THREE.Vector3(0, J.pelvis.y - 0.03, J.pelvis.z - 0.1),
      J.tail_1.clone(),
      J.tail_2.clone(),
      J.tail_3.clone(),
      J.tail_3.clone().add(new THREE.Vector3(0, 0.15, 0.035)),
      J.tail_3.clone().add(new THREE.Vector3(0, 0.215, 0.1)),
    ];
    const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
    const radius = (t) => {
      const swell = Math.sin(Math.min(1, t / 0.92) * Math.PI * 0.92) ** 0.75;
      const cap = t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1;
      return (0.03 + 0.085 * swell) * cap * (1 + 0.035 * Math.sin(t * Math.PI * 7));
    };
    const tAt = [0, 0.18, 0.45, 0.7]; // where each bone sits along the curve (pelvis, tail_1..3)
    const bonesAt = ['pelvis', 'tail_1', 'tail_2', 'tail_3'];
    const weightsAt = (t) => {
      if (t >= tAt[3]) return [['tail_3', 1]];
      for (let i = 0; i < 3; i++) {
        if (t <= tAt[i + 1]) {
          const u = (t - tAt[i]) / (tAt[i + 1] - tAt[i]);
          return [[bonesAt[i], 1 - u], [bonesAt[i + 1], u]];
        }
      }
      return [['tail_3', 1]];
    };
    B.add(plume(curve, radius, 26, 12), {
      weights: (p) => weightsAt(p.userT),
      color: (p) => (p.userT > 0.8 ? C.caramel.clone().lerp(C.furLight, 0.25) : p.userT > 0.72 ? C.fur.clone().lerp(C.caramel, (p.userT - 0.72) / 0.08) : C.fur),
    });
  }

  const geometry = B.build();
  geometry.computeBoundingBox();
  DETAIL = 1;
  return { geometry, height: geometry.boundingBox.max.y };
}
