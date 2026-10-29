// Original cute festival critter ("mascot"), built from primitives and merged into ONE skinned mesh per mascot
// (one draw call + one shadow call), vertex-coloured, animated through a small bone rig.
// API (SPEC "World API"): createMascot({ color, name, title, isLocal }) -> Mascot
//   mascot.root (Group, origin at feet, faces +Z at rotation.y = 0), mascot.label (CSS2DObject)
//   mascot.update(dt, { moving, speed, airborne, vy, feared, immune, fearLeftMs, moveAngle? })
//     moveAngle (optional): movement direction relative to facing, 0 = forward, +PI/2 = toward the mascot's left (+X)
//   mascot.setName(name), mascot.setTitle(title), mascot.setColor(hex), mascot.flashHit(), mascot.dispose()
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { JUMP_VELOCITY, MOVE_SPEED, PLAYER_HEIGHT } from '@shared/config.js';
import { sparkleTexture } from './textures.js';

// ---------------------------------------------------------------- rig & geometry template
const B = { ROOT: 0, BODY: 1, HEAD: 2, EAR_L: 3, EAR_R: 4, ARM_L: 5, ARM_R: 6, LEG_L: 7, LEG_R: 8, TAIL1: 9, TAIL2: 10 };
// model-space bind positions + parents (the critter's left is +X because it faces +Z)
const BONES = [
  { p: [0, 0, 0], parent: -1 },
  { p: [0, 0.1, 0], parent: B.ROOT },
  { p: [0, 0.5, 0], parent: B.BODY },
  { p: [0.075, 0.845, -0.01], parent: B.HEAD },
  { p: [-0.075, 0.845, -0.01], parent: B.HEAD },
  { p: [0.115, 0.43, 0], parent: B.BODY },
  { p: [-0.115, 0.43, 0], parent: B.BODY },
  { p: [0.07, 0.13, 0], parent: B.ROOT },
  { p: [-0.07, 0.13, 0], parent: B.ROOT },
  { p: [0, 0.14, -0.13], parent: B.BODY },
  { p: [0, 0.276, -0.285], parent: B.TAIL1 },
];

const K = { FUR: 0, FUR_LIGHT: 1, FUR_TIP: 2, PINK: 3, BLUSH: 4, NOSE: 5, EYE: 6, WHITE: 7, ROBE: 8, ROBE_DARK: 9, GOLD: 10 };
const FIXED = {
  [K.FUR]: new THREE.Color('#f5eee3'),
  [K.FUR_LIGHT]: new THREE.Color('#fffaf3'),
  [K.FUR_TIP]: new THREE.Color('#eee0cc'),
  [K.PINK]: new THREE.Color('#f39db2'),
  [K.BLUSH]: new THREE.Color('#ff9aa8'),
  [K.NOSE]: new THREE.Color('#5c3034'),
  [K.EYE]: new THREE.Color('#1a1214'),
  [K.WHITE]: new THREE.Color('#ffffff'),
  [K.GOLD]: new THREE.Color('#e9c46a'),
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

let TEMPLATE = null;

function buildTemplate() {
  const parts = [];
  const add = (geo, bone, key, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], quat = null) => {
    geo.deleteAttribute('uv');
    if (quat) _q.copy(quat);
    else _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    _m.compose(_v.set(pos[0], pos[1], pos[2]), _q, _s.set(scl[0], scl[1], scl[2]));
    geo.applyMatrix4(_m);
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const keys = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bone;
      sw[i * 4] = 1;
      keys[i] = key;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.userData.keys = keys;
    parts.push(geo);
    return geo;
  };
  const sphere = (ws = 16, hs = 12) => new THREE.SphereGeometry(1, ws, hs);
  // pieces attached at a surface point of the head, oriented along the surface normal
  const headC = new THREE.Vector3(0, 0.69, 0);
  const onHead = (geo, key, x, y, zGuess, scl, push = 0) => {
    const p = new THREE.Vector3(x, y, zGuess);
    const n = p.clone().sub(headC).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, n);
    p.addScaledVector(n, push);
    add(geo, B.HEAD, key, [p.x, p.y, p.z], null, scl, q);
    return { p, n };
  };

  // --- robe body (bell) ---
  const prof = [
    [0.001, 0.055],
    [0.15, 0.055],
    [0.182, 0.07],
    [0.19, 0.1],
    [0.18, 0.17],
    [0.158, 0.26],
    [0.133, 0.35],
    [0.112, 0.42],
    [0.09, 0.475],
    [0.055, 0.515],
    [0.001, 0.525],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(prof, 26), B.BODY, K.ROBE, [0, 0, 0], [0, 0, 0], [1, 1, 0.92]);
  add(new THREE.TorusGeometry(0.184, 0.017, 8, 30), B.BODY, K.GOLD, [0, 0.072, 0], [Math.PI / 2, 0, 0], [1, 1, 0.92]);
  add(new THREE.TorusGeometry(0.16, 0.024, 8, 30), B.BODY, K.ROBE_DARK, [0, 0.255, 0], [Math.PI / 2, 0, 0], [1, 1, 0.92]);
  add(sphere(10, 8), B.BODY, K.GOLD, [0, 0.255, 0.152], [0, 0, 0], [0.032, 0.03, 0.018]);
  add(sphere(10, 8), B.BODY, K.GOLD, [0, 0.39, 0.112], [0, 0, 0], [0.02, 0.02, 0.012]);
  // fluffy collar
  add(new THREE.TorusGeometry(0.085, 0.045, 10, 22), B.BODY, K.FUR, [0, 0.495, 0], [Math.PI / 2, 0, 0], [1, 1, 0.95]);

  // --- head ---
  add(sphere(30, 22), B.HEAD, K.FUR, [0, 0.69, 0], [0, 0, 0], [0.212, 0.19, 0.198]);
  for (const sx of [1, -1]) add(sphere(14, 10), B.HEAD, K.FUR, [0.158 * sx, 0.625, 0.03], [0, 0, 0.3 * sx], [0.075, 0.062, 0.07]);
  add(sphere(12, 8), B.HEAD, K.FUR, [0, 0.872, 0.07], [0.5, 0, 0], [0.05, 0.04, 0.05]);
  add(sphere(12, 8), B.HEAD, K.FUR, [0.035, 0.877, 0.035], [0.3, 0, -0.4], [0.04, 0.035, 0.04]);
  add(sphere(12, 8), B.HEAD, K.FUR, [-0.032, 0.88, 0.045], [0.3, 0, 0.4], [0.04, 0.035, 0.04]);
  // muzzle + nose + mouth
  add(sphere(18, 12), B.HEAD, K.FUR_LIGHT, [0, 0.612, 0.158], [0, 0, 0], [0.098, 0.068, 0.078]);
  add(sphere(12, 8), B.HEAD, K.NOSE, [0, 0.645, 0.232], [0.2, 0, 0], [0.032, 0.022, 0.022]);
  add(sphere(8, 6), B.HEAD, K.WHITE, [0.008, 0.652, 0.25], [0, 0, 0], [0.007, 0.005, 0.004]);
  add(new THREE.TorusGeometry(0.018, 0.0045, 4, 10, Math.PI), B.HEAD, K.NOSE, [0.017, 0.596, 0.226], [0, 0, Math.PI], [1, 1, 1]);
  add(new THREE.TorusGeometry(0.018, 0.0045, 4, 10, Math.PI), B.HEAD, K.NOSE, [-0.017, 0.596, 0.226], [0, 0, Math.PI], [1, 1, 1]);
  // eyes (big glossy) + highlights + blush
  for (const sx of [1, -1]) {
    const { p, n } = onHead(sphere(16, 12), K.EYE, 0.083 * sx, 0.705, 0.165, [0.036, 0.047, 0.022]);
    const hl = p.clone().addScaledVector(n, 0.016).add(new THREE.Vector3(0.012 * sx, 0.016, 0));
    add(sphere(8, 6), B.HEAD, K.WHITE, [hl.x, hl.y, hl.z], [0, 0, 0], [0.012, 0.012, 0.008]);
    const hl2 = p.clone().addScaledVector(n, 0.016).add(new THREE.Vector3(-0.012 * sx, -0.016, 0));
    add(sphere(6, 4), B.HEAD, K.WHITE, [hl2.x, hl2.y, hl2.z], [0, 0, 0], [0.006, 0.006, 0.004]);
    onHead(sphere(10, 6), K.BLUSH, 0.132 * sx, 0.63, 0.125, [0.032, 0.022, 0.008], 0.008);
  }

  // --- ears (tall, upright, slightly outward), pink inside ---
  for (const [bone, sx] of [
    [B.EAR_L, 1],
    [B.EAR_R, -1],
  ]) {
    const bp = BONES[bone].p;
    const tilt = -0.2 * sx;
    const earPart = (key, center, scl, ws = 16, hs = 12) => {
      const g = sphere(ws, hs);
      g.scale(scl[0], scl[1], scl[2]);
      g.translate(center[0], center[1], center[2]);
      g.rotateZ(tilt);
      g.rotateX(-0.08);
      add(g, bone, key, bp);
    };
    earPart(K.FUR, [0, 0.125, 0], [0.06, 0.15, 0.036]);
    earPart(K.PINK, [0, 0.12, 0.02], [0.036, 0.11, 0.02], 12, 10);
  }

  // --- arms: sleeve + gold cuff + paw ---
  for (const [bone, sx] of [
    [B.ARM_L, 1],
    [B.ARM_R, -1],
  ]) {
    const bp = BONES[bone].p;
    const ang = 0.38 * sx;
    const dir = new THREE.Vector3(Math.sin(ang), -Math.cos(ang), 0.08).normalize();
    const mid = new THREE.Vector3(...bp).addScaledVector(dir, 0.065);
    const end = new THREE.Vector3(...bp).addScaledVector(dir, 0.14);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    add(new THREE.CapsuleGeometry(0.044, 0.09, 4, 10), bone, K.ROBE, [mid.x, mid.y, mid.z], null, [1, 1, 1], q);
    add(new THREE.TorusGeometry(0.043, 0.012, 6, 14), bone, K.GOLD, [end.x, end.y + 0.012, end.z], null, [1, 1, 1], q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)));
    const paw = new THREE.Vector3(...bp).addScaledVector(dir, 0.172);
    add(sphere(12, 10), bone, K.FUR, [paw.x, paw.y, paw.z], [0, 0, 0], [0.042, 0.04, 0.045]);
  }

  // --- legs + feet ---
  for (const [bone, sx] of [
    [B.LEG_L, 1],
    [B.LEG_R, -1],
  ]) {
    add(new THREE.CapsuleGeometry(0.038, 0.05, 4, 8), bone, K.FUR, [0.07 * sx, 0.09, 0], [0, 0, 0], [1, 1, 1]);
    add(sphere(14, 10), bone, K.FUR, [0.072 * sx, 0.035, 0.04], [0, 0, 0], [0.058, 0.038, 0.082]);
    add(sphere(8, 6), bone, K.PINK, [0.072 * sx, 0.022, 0.112], [0, 0, 0], [0.026, 0.016, 0.012]);
  }

  // --- big bushy tail: a smooth tube along a curve, curling up behind, fluffy wavy surface, 2-bone skinning ---
  {
    const P0 = new THREE.Vector3(0, 0.13, -0.12);
    const P1 = new THREE.Vector3(0, 0.17, -0.34);
    const P2 = new THREE.Vector3(0, 0.46, -0.38);
    const P3 = new THREE.Vector3(0, 0.6, -0.25);
    const curve = new THREE.CubicBezierCurve3(P0, P1, P2, P3);
    const rings = 22;
    const segs = 16;
    const pos = [];
    const si = [];
    const sw = [];
    const kk = [];
    const idx = [];
    const X = new THREE.Vector3(1, 0, 0);
    const T = new THREE.Vector3();
    const Nn = new THREE.Vector3();
    const P = new THREE.Vector3();
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      curve.getPoint(t, P);
      curve.getTangent(t, T);
      Nn.crossVectors(T, X).normalize();
      const base = 0.118 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.75) + (r === 0 || r === rings ? 0 : 0.012);
      const w2 = THREE.MathUtils.smoothstep(t, 0.22, 0.6);
      for (let k = 0; k <= segs; k++) {
        const th = (k / segs) * Math.PI * 2;
        const fluff = 1 + 0.09 * Math.sin(th * 6 + t * 14) * Math.sin(t * Math.PI);
        const rr = base * fluff;
        pos.push(P.x + Math.cos(th) * rr * X.x + Math.sin(th) * rr * Nn.x, P.y + Math.cos(th) * rr * X.y + Math.sin(th) * rr * Nn.y, P.z + Math.cos(th) * rr * X.z + Math.sin(th) * rr * Nn.z);
        si.push(B.TAIL1, B.TAIL2, 0, 0);
        sw.push(1 - w2, w2, 0, 0);
        kk.push(t > 0.8 ? K.FUR_TIP : K.FUR);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < segs; k++) {
        const a = r * (segs + 1) + k;
        const b = a + segs + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(si), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.userData.keys = new Uint8Array(kk);
    parts.push(g);
  }

  const keys = new Uint8Array(parts.reduce((a, g) => a + g.attributes.position.count, 0));
  let o = 0;
  for (const g of parts) {
    keys.set(g.userData.keys, o);
    o += g.attributes.position.count;
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  merged.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(keys.length * 3), 3));
  return { geometry: merged, keys };
}

// ---------------------------------------------------------------- shared immune sparkle aura
let AURA = null;
function auraShared() {
  if (AURA) return AURA;
  const n = 18;
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    seed[i * 4] = Math.random() * Math.PI * 2; // angle
    seed[i * 4 + 1] = Math.random(); // height phase
    seed[i * 4 + 2] = 0.22 + Math.random() * 0.2; // radius
    seed[i * 4 + 3] = 0.5 + Math.random() * 0.8; // speed
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1);
  const mat = new THREE.ShaderMaterial({
    name: 'ImmuneAura',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 500 }, uMap: { value: sparkleTexture() } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uScale;
      varying float vA;
      void main() {
        float h = fract(aSeed.y + uTime * 0.35 * aSeed.w);
        float ang = aSeed.x + uTime * aSeed.w * 1.4;
        vec3 p = vec3(cos(ang) * aSeed.z, 0.05 + h * 1.05, sin(ang) * aSeed.z);
        vA = sin(h * 3.14159) * (0.6 + 0.4 * sin(uTime * 9.0 + aSeed.x * 7.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.07 + 0.05 * aSeed.w) * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vA;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(1.6, 1.35, 0.8) * t.rgb * t.a * vA, 1.0);
      }`,
  });
  AURA = { geo, mat };
  return AURA;
}

const _size = new THREE.Vector2();
/** onBeforeRender hook keeping a point-sprite size uniform in sync with viewport + projection. */
export function pointScaleHook(uniform) {
  return function onBeforeRender(renderer, scene, camera) {
    renderer.getDrawingBufferSize(_size);
    uniform.value = _size.y * 0.5 * camera.projectionMatrix.elements[5];
  };
}

// ---------------------------------------------------------------- nameplate DOM
let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const st = document.createElement('style');
  st.id = 'world-mascot-css';
  st.textContent = `
.wm-plate{display:flex;flex-direction:column;align-items:center;gap:1px;pointer-events:none;user-select:none;white-space:nowrap;
  font:600 13px/1.15 system-ui,'Segoe UI',Roboto,sans-serif;color:#fff;
  text-shadow:0 0 2px #000,0 0 3px rgba(0,0,0,.85),0 1px 2px #000;}
.wm-title{font-size:11px;font-weight:500;opacity:.92}
.wm-title:empty{display:none}
.wm-local .wm-name,.wm-local .wm-title{color:#86ff6e}
.wm-npc .wm-name,.wm-npc .wm-title{color:#5ee8d5}
.wm-bars{display:none;width:58px;margin-top:2px;padding:1px;background:rgba(0,0,0,.55);border-radius:2px}
.wm-local .wm-bars{display:block}
.wm-hp{height:3px;background:linear-gradient(#ff6b6b,#d0262b);border-radius:1px}
.wm-mp{height:2px;margin-top:1px;background:linear-gradient(#78b7ff,#2c66e0);border-radius:1px}
.wm-feared .wm-hp{background:linear-gradient(#a8ff7a,#38c22e)}
.wm-fear{display:none;margin-top:1px;font:900 26px/1 system-ui,'Segoe UI',sans-serif;color:#fff6d8;
  -webkit-text-stroke:1px #5a1030;text-shadow:0 0 6px #ff3aa8,0 0 12px #c01070,0 2px 2px #000}
.wm-feared .wm-fear{display:block}
`;
  document.head.appendChild(st);
}

// ---------------------------------------------------------------- factory
const IMMUNE_GLOW = new THREE.Color(1.0, 0.82, 0.45);
const HIT_GLOW = new THREE.Color(1.0, 0.06, 0.03);

/**
 * @param {{color?: string|number, name?: string, title?: string, isLocal?: boolean, npc?: boolean, hat?: string|number|null, scale?: number}} opts
 */
export function createMascot({ color = '#b0413e', name = '', title = '', isLocal = false, npc = false, hat = null, scale = 1, keepTransparent = false } = {}) {
  if (!TEMPLATE) TEMPLATE = buildTemplate();
  injectCss();
  const geometry = TEMPLATE.geometry.clone();
  const keys = TEMPLATE.keys;
  const colAttr = geometry.attributes.color;

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.8 });
  material.name = 'MascotMat';
  const rimU = { value: new THREE.Color(0.32, 0.3, 0.28) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rimU;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `{ float fr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
           outgoingLight += uRim * (fr * fr * fr); }
         #include <opaque_fragment>`,
      );
  };

  // bones
  const bones = BONES.map(() => new THREE.Bone());
  BONES.forEach((b, i) => {
    const pp = b.parent >= 0 ? BONES[b.parent].p : [0, 0, 0];
    bones[i].position.set(b.p[0] - pp[0], b.p[1] - pp[1], b.p[2] - pp[2]);
    if (b.parent >= 0) bones[b.parent].add(bones[i]);
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'mascot';
  mesh.add(bones[0]);
  bones[0].updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.55, 0), 0.9);

  const root = new THREE.Group();
  root.name = 'mascotRoot';
  const scaler = new THREE.Group(); // overall size (PLAYER_HEIGHT is ~1 m; spectators vary a bit)
  scaler.scale.setScalar(scale * (PLAYER_HEIGHT / 1.0));
  scaler.add(mesh);
  root.add(scaler);

  // optional hat (NPC)
  let hatMesh = null;
  if (hat) {
    const hatMat = new THREE.MeshStandardMaterial({ color: hat, roughness: 0.6 });
    const g1 = new THREE.ConeGeometry(0.115, 0.26, 18);
    g1.translate(0, 0.13, 0);
    g1.rotateX(-0.25);
    const g2 = new THREE.CylinderGeometry(0.165, 0.17, 0.025, 22);
    const g3 = new THREE.SphereGeometry(0.035, 10, 8);
    g3.translate(0, 0.26, -0.07);
    const hg = mergeGeometries([g1.toNonIndexed(), g2.toNonIndexed(), g3.toNonIndexed()]);
    [g1, g2, g3].forEach((g) => g.dispose());
    hatMesh = new THREE.Mesh(hg, hatMat);
    hatMesh.position.set(0, 0.36, 0.02); // relative to the head bone (at y 0.5)
    hatMesh.rotation.z = 0.12;
    hatMesh.castShadow = true;
    bones[B.HEAD].add(hatMesh);
  }

  // immune aura
  const aura = auraShared();
  const auraPts = new THREE.Points(aura.geo, aura.mat);
  auraPts.visible = false;
  auraPts.frustumCulled = false;
  auraPts.onBeforeRender = pointScaleHook(aura.mat.uniforms.uScale);
  root.add(auraPts);
  // warm the aura program once (rendered far below the island for a few frames)
  let auraWarm = null;
  if (keepTransparent) {
    auraWarm = new THREE.Points(aura.geo, aura.mat);
    auraWarm.frustumCulled = false;
    auraWarm.position.y = -80;
    auraWarm.onBeforeRender = auraPts.onBeforeRender;
    root.add(auraWarm);
  }
  let warmFrames = 0;

  // nameplate
  const el = document.createElement('div');
  el.className = 'wm-plate' + (isLocal ? ' wm-local' : '') + (npc ? ' wm-npc' : '');
  const titleEl = document.createElement('div');
  titleEl.className = 'wm-title';
  titleEl.textContent = title || '';
  const nameEl = document.createElement('div');
  nameEl.className = 'wm-name';
  nameEl.textContent = name || '';
  const bars = document.createElement('div');
  bars.className = 'wm-bars';
  bars.innerHTML = '<div class="wm-hp"></div><div class="wm-mp"></div>';
  const fearEl = document.createElement('div');
  fearEl.className = 'wm-fear';
  el.append(titleEl, nameEl, bars, fearEl);
  const label = new CSS2DObject(el);
  label.center.set(0.5, 1); // bottom of the plate sits on the anchor
  label.position.set(0, 1.2 * scale, 0);
  root.add(label);

  // ---------------------------------------------------------------- colours
  const robe = new THREE.Color();
  const robeDark = new THREE.Color();
  function setColor(c) {
    robe.set(c ?? '#b0413e');
    robeDark.copy(robe).multiplyScalar(0.55);
    const arr = colAttr.array;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const col = k === K.ROBE ? robe : k === K.ROBE_DARK ? robeDark : FIXED[k];
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    colAttr.needsUpdate = true;
  }
  setColor(color);

  // ---------------------------------------------------------------- animation state
  const S = {
    t: Math.random() * 100,
    run: 0,
    air: 0,
    fear: 0,
    imm: 0,
    phase: 0,
    wag: 0,
    land: 0,
    wasAir: false,
    flash: 0,
    twitchT: 1 + Math.random() * 3,
    twitchK: 0,
    twitchEar: B.EAR_L,
    transparent: false,
    fearShown: -1,
    feared: false,
    ca: 1,
    sa: 0,
  };
  const bRoot = bones[B.ROOT];
  const bBody = bones[B.BODY];
  const bHead = bones[B.HEAD];
  const bEarL = bones[B.EAR_L];
  const bEarR = bones[B.EAR_R];
  const bArmL = bones[B.ARM_L];
  const bArmR = bones[B.ARM_R];
  const bLegL = bones[B.LEG_L];
  const bLegR = bones[B.LEG_R];
  const bTail1 = bones[B.TAIL1];
  const bTail2 = bones[B.TAIL2];
  const rootBaseY = bRoot.position.y;
  const TAU = Math.PI * 2;
  const EMPTY = {};

  function update(dt, s = EMPTY) {
    if (auraWarm && ++warmFrames > 3) {
      auraWarm.removeFromParent();
      auraWarm = null;
    }
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const t = (S.t += dt);
    const moving = !!s.moving;
    const speed = s.speed ?? (moving ? MOVE_SPEED : 0);
    const feared = !!s.feared;
    const airborne = !!s.airborne;
    const vyN = Math.max(-1, Math.min(1, (s.vy || 0) / JUMP_VELOCITY));
    const kf = (r) => 1 - Math.exp(-r * dt);

    S.run += ((moving ? Math.max(0.3, Math.min(1.3, speed / MOVE_SPEED)) : 0) - S.run) * kf(12);
    S.air += ((airborne ? 1 : 0) - S.air) * kf(20);
    S.fear += ((feared ? 1 : 0) - S.fear) * kf(10);
    S.imm += ((s.immune ? 1 : 0) - S.imm) * kf(8);
    if (S.wasAir && !airborne) S.land = 1;
    S.wasAir = airborne;
    S.land = Math.max(0, S.land - dt / 0.17);
    S.flash = Math.max(0, S.flash - dt / 0.38);
    const run = S.run * (1 - S.air * 0.85);
    const fear = S.fear;
    S.phase += dt * TAU * (2.4 + 1.9 * S.run + fear * 1.4);
    S.wag += dt * TAU * (0.45 + 1.4 * S.run + fear * 2.2);
    const ph = S.phase;
    const sinP = Math.sin(ph);
    const breathe = Math.sin(t * 2.2);
    // lean / swing toward the actual movement direction (strafe, backpedal)
    const ma = moving && s.moveAngle ? s.moveAngle : 0;
    S.ca += (Math.cos(ma) - S.ca) * kf(10);
    S.sa += (Math.sin(ma) - S.sa) * kf(10);
    const ca = S.ca;
    const sa = S.sa;

    // root: bob, lean, squash & stretch
    const stretch = S.air * Math.abs(vyN) * 0.14;
    const squash = S.land * 0.24;
    const sy = (1 + stretch) * (1 - squash);
    const sxz = 1 / Math.sqrt(sy);
    bRoot.scale.set(sxz, sy, sxz);
    bRoot.position.y = rootBaseY + Math.abs(sinP) * 0.05 * run;
    bRoot.rotation.x = 0.24 * run * ca + S.air * vyN * -0.08 + fear * 0.08;
    bRoot.rotation.z = -0.2 * run * sa + Math.sin(t * 17) * 0.13 * fear;

    // body: breathing, hip twist, panic wobble
    bBody.scale.set(1 + breathe * 0.012 * (1 - run), 1 + breathe * 0.02 * (1 - run), 1 + breathe * 0.012 * (1 - run));
    bBody.rotation.y = sinP * 0.14 * run + Math.sin(t * 13) * 0.12 * fear;
    bBody.rotation.z = Math.cos(ph) * 0.05 * run;

    // head: counter lean, idle look-around, panic shake
    bHead.rotation.x = -0.14 * run + Math.sin(t * 1.3) * 0.04 * (1 - run) - S.air * vyN * 0.08;
    bHead.rotation.y = Math.sin(t * 0.55) * 0.18 * (1 - run) * (1 - fear) + Math.sin(t * 23) * 0.16 * fear;
    bHead.rotation.z = Math.sin(t * 0.8) * 0.05 * (1 - run);

    // ears: drag with speed, flop with vertical velocity, random twitch, flatten when scared
    S.twitchT -= dt;
    if (S.twitchT <= 0) {
      S.twitchT = 1.4 + Math.random() * 3.5;
      S.twitchK = 1;
      S.twitchEar = Math.random() < 0.5 ? B.EAR_L : B.EAR_R;
    }
    S.twitchK = Math.max(0, S.twitchK - dt / 0.3);
    const tw = Math.sin(S.twitchK * Math.PI * 3) * 0.32 * S.twitchK;
    const earX = -0.42 * run - S.air * vyN * 0.45 - fear * 0.55 + Math.sin(ph * 2) * 0.06 * run;
    bEarL.rotation.x = earX + Math.sin(t * 31) * 0.1 * fear;
    bEarR.rotation.x = earX + Math.sin(t * 29 + 1) * 0.1 * fear;
    bEarL.rotation.z = (S.twitchEar === B.EAR_L ? -tw : 0) - fear * 0.25 - S.air * 0.15;
    bEarR.rotation.z = (S.twitchEar === B.EAR_R ? tw : 0) + fear * 0.25 + S.air * 0.15;

    // arms: swing / spread in the air / straight up when panicking
    const swing = sinP * 1.0 * run;
    const shake = Math.sin(t * 26) * 0.35 * fear;
    bArmL.rotation.x = -swing * (1 - fear) + shake;
    bArmR.rotation.x = swing * (1 - fear) - shake;
    const idleArm = 0.05 + breathe * 0.03;
    bArmL.rotation.z = (idleArm + S.air * 0.95) * (1 - fear) + fear * 2.55;
    bArmR.rotation.z = -(idleArm + S.air * 0.95) * (1 - fear) - fear * 2.55;

    // legs: run cycle / tuck in the air
    bLegL.rotation.x = sinP * 0.95 * run * ca - S.air * 0.55;
    bLegR.rotation.x = -sinP * 0.95 * run * ca - S.air * 0.35;
    bLegL.rotation.z = -sinP * 0.5 * run * sa;
    bLegR.rotation.z = sinP * 0.5 * run * sa;

    // tail wag
    const amp = 0.22 + 0.28 * S.run + 0.25 * fear;
    bTail1.rotation.y = Math.sin(S.wag) * amp;
    bTail1.rotation.x = -0.25 * run + S.air * vyN * 0.25 + Math.sin(t * 1.7) * 0.05;
    bTail2.rotation.y = Math.sin(S.wag - 1.0) * amp * 1.25;
    bTail2.rotation.x = -0.18 * run + Math.sin(t * 2.1 + 1) * 0.06;

    // ---- material: immune glow / hit flash
    const imm = S.imm;
    const wantTransparent = imm > 0.02 || keepTransparent;
    if (wantTransparent !== S.transparent) {
      S.transparent = wantTransparent;
      material.transparent = wantTransparent;
      material.needsUpdate = true;
    }
    material.opacity = 1 - imm * 0.3;
    const pulse = 0.55 + 0.18 * Math.sin(t * 7);
    material.emissive.setRGB(
      IMMUNE_GLOW.r * imm * pulse + HIT_GLOW.r * S.flash * 1.4,
      IMMUNE_GLOW.g * imm * pulse + HIT_GLOW.g * S.flash * 1.4,
      IMMUNE_GLOW.b * imm * pulse + HIT_GLOW.b * S.flash * 1.4,
    );
    rimU.value.setRGB(0.32 + imm * 0.7, 0.3 + imm * 0.55, 0.28 + imm * 0.2);
    auraPts.visible = imm > 0.05;
    if (auraPts.visible) aura.mat.uniforms.uTime.value = performance.now() / 1000;

    // ---- nameplate fear badge (DOM writes only on change)
    // "2" -> "1" like the game for the 2.3 s fear (rounded, never 0 while still feared)
    const fearLeft = s.fearLeftMs > 0 ? Math.max(1, Math.round(s.fearLeftMs / 1000)) : 0;
    if (fearLeft !== S.fearShown) {
      S.fearShown = fearLeft;
      fearEl.textContent = fearLeft > 0 ? String(fearLeft) : '';
      el.classList.toggle('wm-feared', fearLeft > 0);
    }
  }

  return {
    root,
    label,
    mesh,
    update,
    setColor,
    setName(n) {
      nameEl.textContent = n ?? '';
    },
    setTitle(tt) {
      titleEl.textContent = tt ?? '';
    },
    flashHit() {
      S.flash = 1;
    },
    dispose() {
      root.removeFromParent();
      label.removeFromParent();
      el.remove();
      geometry.dispose();
      material.dispose();
      mesh.skeleton.dispose();
      if (hatMesh) {
        hatMesh.geometry.dispose();
        hatMesh.material.dispose();
      }
    },
  };
}
