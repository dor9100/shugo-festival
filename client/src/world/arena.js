// The festival plaza: floor, rails, border, walkway, balustrade, posts, lawn, props, sky, spectators, NPC.
// API (SPEC "World API"): createArena(scene) -> { update(dt, now) }
// Everything is procedural (canvas textures + primitives), static parts are merged / instanced to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA_HALF, BORDER_WIDTH, WALKWAY_WIDTH } from '@shared/config.js';
import { createSkyDome } from './sky.js';
import { createRiggedMascot, createSpectator } from '../anim/riggedMascot.js';
import {
  bannerTexture,
  cloudTexture,
  floorTextures,
  hutTexture,
  lawnTexture,
  mulberry32,
  stripeTexture,
  walkwayTextures,
} from './textures.js';

const H = ARENA_HALF;
const BW = BORDER_WIDTH;
const IN = H + BW; // inner edge of the walkway
const OUT = IN + WALKWAY_WIDTH; // outer edge of the walkway (octagon half-size)
const CHAMFER = 2.6; // octagon corner cut
const LAWN_Y = -0.38;

export const SPECTATOR_COLORS = ['#7a2f2a', '#3f5fa8', '#3c8a5a', '#8a5aa8', '#c07a2a', '#2f7f8f', '#a83c6a', '#5a4a3a', '#d0a040', '#4a6a2a'];
export const PLAYER_COLORS = ['#c0392b', '#2e86de', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#d63384', '#b8860b', '#5d6d7e', '#e84393', '#00a8a8', '#6c5ce7'];

// ---------------------------------------------------------------- geometry helpers
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function xf(geo, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
  _m4.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(scl[0], scl[1], scl[2]));
  return geo.applyMatrix4(_m4);
}
function tint(geo, color) {
  const c = new THREE.Color(color);
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
function merge(geos, keepUv = true) {
  const list = geos.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    if (!keepUv) ng.deleteAttribute('uv');
    return ng;
  });
  const m = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return m;
}
/** Randomly displace vertices (shared positions keep watertight because we jitter by position hash). */
function jitter(geo, amt, seed = 1) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    const h2 = Math.sin(x * 93.989 + y * 67.345 + z * 12.345 + seed) * 24634.6345;
    const h3 = Math.sin(x * 43.332 + y * 13.135 + z * 91.123 + seed) * 56445.2345;
    pos.setXYZ(i, x + (h - Math.floor(h) - 0.5) * amt, y + (h2 - Math.floor(h2) - 0.5) * amt, z + (h3 - Math.floor(h3) - 0.5) * amt);
  }
  geo.computeVertexNormals();
  return geo;
}

function octagon(half, cut) {
  return [
    [half, -half + cut],
    [half, half - cut],
    [half - cut, half],
    [-half + cut, half],
    [-half, half - cut],
    [-half, -half + cut],
    [-half + cut, -half],
    [half - cut, -half],
  ];
}

// ---------------------------------------------------------------- main
export function createArena(scene) {
  const rng = mulberry32(4242);
  const root = new THREE.Group();
  root.name = 'arena';
  scene.add(root);
  const animated = []; // (dt, t) => void
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);

  // ---------------- sky + distant scenery
  const sky = createSkyDome(450);
  root.add(sky);

  // ---------------- arena floor
  {
    const { map, normalMap } = floorTextures(H * 2, 2048);
    const mat = keep(
      new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.88, metalness: 0, envMapIntensity: 0.6 }),
    );
    const geo = keep(new THREE.PlaneGeometry(H * 2, H * 2));
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, mat);
    floor.name = 'floor';
    floor.receiveShadow = true;
    root.add(floor);
    // dark under-slab so the gap under the border never shows sky
    const under = new THREE.Mesh(keep(new THREE.BoxGeometry(IN * 2, 0.5, IN * 2)), keep(new THREE.MeshStandardMaterial({ color: '#5d5853', roughness: 1 })));
    under.position.y = -0.27;
    root.add(under);
  }

  // ---------------- centre rail: ONE dark low rail along x at z = 0 (left-right from the default camera), splitting
  // the floor into a near and a far half - as in the key frames (there is no second rail along z)
  {
    const railMat = keep(new THREE.MeshStandardMaterial({ color: '#3a3431', roughness: 0.55, metalness: 0.45 }));
    const geos = [
      xf(new THREE.BoxGeometry(H * 2, 0.035, 0.12), [0, 0.0175, 0]),
      xf(new THREE.BoxGeometry(H * 2, 0.05, 0.035), [0, 0.025, 0]),
    ];
    const rails = new THREE.Mesh(keep(merge(geos)), railMat);
    rails.name = 'centreRail';
    rails.receiveShadow = true;
    root.add(rails);
    const toothGeo = keep(new THREE.BoxGeometry(0.03, 0.03, 0.05));
    const step = 0.14;
    const per = Math.floor((H * 2) / step);
    const teeth = new THREE.InstancedMesh(toothGeo, keep(new THREE.MeshStandardMaterial({ color: '#5a4c44', roughness: 0.5, metalness: 0.5 })), per * 2);
    let n = 0;
    for (let i = 0; i < per; i++) {
      const a = -H + (i + 0.5) * step;
      for (const side of [-1, 1]) {
        _m4.makeTranslation(a, 0.015, side * 0.085);
        teeth.setMatrixAt(n++, _m4);
      }
    }
    teeth.count = n;
    teeth.receiveShadow = true;
    root.add(teeth);
  }

  // ---------------- copper toothed border rail
  {
    const copper = keep(new THREE.MeshStandardMaterial({ color: '#9a5a36', roughness: 0.45, metalness: 0.6, envMapIntensity: 1.0 }));
    const dark = keep(new THREE.MeshStandardMaterial({ color: '#4a3226', roughness: 0.65, metalness: 0.35 }));
    const base = [];
    const lips = [];
    const L = IN * 2;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      // side i runs along the local x axis at local z = +(H + BW/2), rotated by a about Y
      const place = (geo, z, y) => {
        xf(geo, [0, y, z]);
        geo.applyMatrix4(_m4.makeRotationY(a));
        return geo;
      };
      base.push(place(new THREE.BoxGeometry(L, 0.04, BW), H + BW / 2, 0.02));
      // segmented plates on the outer half + top rail where the emitters ride
      lips.push(place(new THREE.BoxGeometry(L, 0.15, 0.07), IN - 0.035, 0.075));
      lips.push(place(new THREE.BoxGeometry(L, 0.035, 0.11), IN - 0.055, 0.165));
      lips.push(place(new THREE.BoxGeometry(H * 2, 0.03, 0.03), H + 0.015, 0.015));
    }
    const baseMesh = new THREE.Mesh(keep(merge(base)), dark);
    baseMesh.receiveShadow = true;
    const lipMesh = new THREE.Mesh(keep(merge(lips)), copper);
    lipMesh.receiveShadow = true;
    lipMesh.castShadow = true;
    root.add(baseMesh, lipMesh);
    // pointed pickets leaning from the top rail down toward the floor (comb look from above)
    const step = 0.085;
    const per = Math.floor((H * 2) / step);
    const tip = new THREE.Vector3(0, 0.025, H + 0.01);
    const top = new THREE.Vector3(0, 0.15, IN - 0.07);
    const len = tip.distanceTo(top);
    const dir = tip.clone().sub(top).normalize();
    const pickGeo = keep(new THREE.ConeGeometry(0.024, len, 4, 1));
    pickGeo.rotateY(Math.PI / 4);
    pickGeo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    const mid = tip.clone().add(top).multiplyScalar(0.5);
    const teeth = new THREE.InstancedMesh(pickGeo, copper, per * 4 + 8);
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      for (let k = 0; k < per; k++) {
        const along = -H + (k + 0.5) * step;
        _p.set(along, mid.y, mid.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a);
        _m4.makeRotationY(a).setPosition(_p);
        teeth.setMatrixAt(n++, _m4);
      }
    }
    teeth.count = n;
    teeth.castShadow = true;
    teeth.receiveShadow = true;
    root.add(teeth);
    // corner blocks
    const cg = [];
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      cg.push(xf(new THREE.BoxGeometry(BW + 0.06, 0.16, BW + 0.06), [sx * (H + BW / 2), 0.08, sz * (H + BW / 2)]));
      cg.push(xf(new THREE.SphereGeometry(0.09, 12, 8), [sx * (H + BW / 2), 0.19, sz * (H + BW / 2)]));
    }
    const corners = new THREE.Mesh(keep(merge(cg)), copper);
    corners.castShadow = true;
    root.add(corners);
  }

  // ---------------- walkway (octagonal stone slab with square hole)
  const oct = octagon(OUT, CHAMFER);
  {
    const { map, normalMap } = walkwayTextures(1024);
    map.repeat.set(1 / 3.6, 1 / 3.6);
    normalMap.repeat.set(1 / 3.6, 1 / 3.6);
    const shape = new THREE.Shape(oct.map(([x, z]) => new THREE.Vector2(x, z)));
    const hole = new THREE.Path([new THREE.Vector2(-IN, -IN), new THREE.Vector2(IN, -IN), new THREE.Vector2(IN, IN), new THREE.Vector2(-IN, IN)]);
    shape.holes.push(hole);
    const geo = keep(new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false, curveSegments: 1 }));
    // extrude goes +Z in shape space: rotate so the shape lies in XZ with its top face up
    geo.rotateX(Math.PI / 2); // shape (x, y) -> (x, 0, y); extrusion goes -Y
    geo.translate(0, 0.0, 0);
    const top = keep(new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.9, envMapIntensity: 0.6 }));
    const side = keep(new THREE.MeshStandardMaterial({ color: '#b9b0a2', roughness: 0.95 }));
    const walk = new THREE.Mesh(geo, [top, side]);
    walk.name = 'walkway';
    walk.receiveShadow = true;
    root.add(walk);
    // stone coping strip on the outer edge
    const coping = [];
    for (let i = 0; i < 8; i++) {
      const [ax, az] = oct[i];
      const [bx, bz] = oct[(i + 1) % 8];
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bz - az, bx - ax);
      const g = new THREE.BoxGeometry(len + 0.3, 0.12, 0.34);
      g.translate(0, 0.0, -0.13);
      g.rotateY(-ang);
      g.translate((ax + bx) / 2, -0.03, (az + bz) / 2);
      coping.push(g);
    }
    const cop = new THREE.Mesh(keep(merge(coping)), side);
    cop.receiveShadow = true;
    root.add(cop);
  }

  // ---------------- balustrade + finial posts with draped cloth
  {
    const stone = keep(new THREE.MeshStandardMaterial({ color: '#cfc7b8', roughness: 0.85, envMapIntensity: 0.6 }));
    const inset = 0.32;
    const ioct = octagon(OUT - inset, CHAMFER - inset * 0.41);
    const railGeos = [];
    const postSpots = [];
    const balSpots = [];
    for (let i = 0; i < 8; i++) {
      const [ax, az] = ioct[i];
      const [bx, bz] = ioct[(i + 1) % 8];
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bz - az, bx - ax);
      const mk = (w, h, d, y) => {
        const g = new THREE.BoxGeometry(len, h, d);
        g.rotateY(-ang);
        g.translate((ax + bx) / 2, y, (az + bz) / 2);
        return g;
      };
      railGeos.push(mk(0, 0.07, 0.2, 0.62), mk(0, 0.04, 0.24, 0.67), mk(0, 0.1, 0.24, 0.05));
      postSpots.push([ax, az]);
      const posts = len > 8 ? 2 : 0;
      for (let k = 1; k <= posts; k++) postSpots.push([ax + ((bx - ax) * k) / (posts + 1), az + ((bz - az) * k) / (posts + 1)]);
      const nb = Math.floor(len / 0.3);
      for (let k = 1; k < nb; k++) {
        const f = k / nb;
        const x = ax + (bx - ax) * f;
        const z = az + (bz - az) * f;
        if (postSpots.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.3)) continue;
        if (posts && Math.abs(f - 1 / 3) < 0.025) continue;
        if (posts && Math.abs(f - 2 / 3) < 0.025) continue;
        balSpots.push([x, z]);
      }
    }
    const railMesh = new THREE.Mesh(keep(merge(railGeos)), stone);
    railMesh.castShadow = true;
    railMesh.receiveShadow = true;
    root.add(railMesh);
    const prof = [
      [0.0, 0.1],
      [0.05, 0.1],
      [0.05, 0.13],
      [0.035, 0.16],
      [0.06, 0.3],
      [0.05, 0.42],
      [0.03, 0.5],
      [0.045, 0.55],
      [0.05, 0.585],
      [0.0, 0.585],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const balGeo = keep(new THREE.LatheGeometry(prof, 8));
    const bal = new THREE.InstancedMesh(balGeo, stone, balSpots.length);
    balSpots.forEach(([x, z], i) => bal.setMatrixAt(i, _m4.makeTranslation(x, 0, z)));
    bal.castShadow = true;
    bal.receiveShadow = true;
    root.add(bal);

    // posts
    const postGeos = [];
    const clothGeos = [];
    const fin = [
      [0.0, 0],
      [0.1, 0],
      [0.1, 0.08],
      [0.07, 0.12],
      [0.09, 0.2],
      [0.04, 0.36],
      [0.012, 0.62],
      [0.0, 0.66],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    for (const [x, z] of postSpots) {
      postGeos.push(xf(new THREE.BoxGeometry(0.34, 0.16, 0.34), [x, 0.08, z]));
      postGeos.push(xf(new THREE.BoxGeometry(0.26, 1.15, 0.26), [x, 0.72, z]));
      postGeos.push(xf(new THREE.BoxGeometry(0.34, 0.08, 0.34), [x, 1.33, z]));
      postGeos.push(xf(new THREE.LatheGeometry(fin, 8), [x, 1.37, z], [0, Math.PI / 8, 0]));
      // draped cloth: wavy skirt tied under the cap + a hanging tail facing the arena
      const skirt = new THREE.CylinderGeometry(0.195, 0.28, 0.42, 20, 3, true);
      const sp = skirt.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const vx = sp.getX(i);
        const vy = sp.getY(i);
        const vz = sp.getZ(i);
        const th = Math.atan2(vz, vx);
        const k = (0.21 - vy) / 0.42; // 0 top .. 1 bottom
        const wave = Math.sin(th * 5) * 0.03 * k;
        const r = Math.hypot(vx, vz) + wave;
        sp.setXYZ(i, Math.cos(th) * r, vy - Math.max(0, Math.sin(th * 5 + 1)) * 0.06 * k, Math.sin(th) * r);
      }
      skirt.computeVertexNormals();
      clothGeos.push(xf(skirt, [x, 1.1, z]));
      const toCenter = Math.atan2(-x, -z);
      const tail = new THREE.PlaneGeometry(0.16, 0.7, 1, 6);
      const tp = tail.attributes.position;
      for (let i = 0; i < tp.count; i++) tp.setZ(i, Math.sin((tp.getY(i) + 0.35) * 4) * 0.03);
      tail.computeVertexNormals();
      clothGeos.push(xf(tail, [x + Math.sin(toCenter) * 0.2, 0.75, z + Math.cos(toCenter) * 0.2], [0.08, toCenter, 0]));
    }
    const postMesh = new THREE.Mesh(keep(merge(postGeos)), stone);
    postMesh.castShadow = true;
    postMesh.receiveShadow = true;
    root.add(postMesh);
    const clothMat = keep(
      new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.8, side: THREE.DoubleSide }),
    );
    const cloth = new THREE.Mesh(keep(merge(clothGeos)), clothMat);
    cloth.castShadow = true;
    root.add(cloth);
  }

  // ---------------- lawn island + flower beds + bushes
  {
    const tex = lawnTexture(512);
    tex.repeat.set(30, 30);
    const lawn = new THREE.Mesh(
      keep(new THREE.CircleGeometry(46, 64).rotateX(-Math.PI / 2)),
      keep(new THREE.MeshStandardMaterial({ map: tex, color: '#d8e0c8', roughness: 1, envMapIntensity: 0.4 })),
    );
    lawn.position.y = LAWN_Y;
    lawn.receiveShadow = true;
    root.add(lawn);
    // rocky underside of the floating plaza island
    const under = jitter(new THREE.ConeGeometry(46, 26, 28, 6, true), 1.6, 3);
    under.rotateX(Math.PI);
    under.translate(0, LAWN_Y - 13, 0);
    const rock = new THREE.Mesh(keep(under), keep(new THREE.MeshStandardMaterial({ color: '#8d7c6a', roughness: 1, flatShading: true })));
    root.add(rock);
    // dirt rim
    const rim = new THREE.Mesh(keep(new THREE.CylinderGeometry(46, 45, 1.2, 64, 1, true)), keep(new THREE.MeshStandardMaterial({ color: '#7d6a55', roughness: 1 })));
    rim.position.y = LAWN_Y - 0.6;
    root.add(rim);

    // flower beds along the outside of the balustrade (pink / magenta / white / yellow like the reference)
    const flowerCols = ['#ff7ab8', '#ff4fa0', '#ffd1e6', '#ffffff', '#ffd84a', '#e06aff'].map((c) => new THREE.Color(c));
    const beds = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rng() * 0.2;
      const r = 11.2 + rng() * 2.5;
      beds.push([Math.cos(a) * r, Math.sin(a) * r, 0.8 + rng() * 0.9]);
    }
    const bushGeo = keep(new THREE.IcosahedronGeometry(1, 1));
    const flowerGeo = keep(new THREE.IcosahedronGeometry(0.075, 0));
    const perBed = 46;
    const bushes = new THREE.InstancedMesh(bushGeo, keep(new THREE.MeshStandardMaterial({ color: '#3f7f34', roughness: 0.9, flatShading: true })), beds.length * 4 + 40);
    const flowers = new THREE.InstancedMesh(flowerGeo, keep(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, emissive: '#301020', emissiveIntensity: 0.3 })), beds.length * perBed);
    let nb = 0;
    let nf = 0;
    for (const [bx, bz, br] of beds) {
      for (let k = 0; k < 4; k++) {
        const ox = (rng() - 0.5) * br * 1.6;
        const oz = (rng() - 0.5) * br * 1.6;
        const s = br * (0.45 + rng() * 0.3);
        _m4.compose(_p.set(bx + ox, LAWN_Y + s * 0.25, bz + oz), _q.identity(), _s.set(s, s * 0.55, s));
        bushes.setMatrixAt(nb++, _m4);
      }
      const col = flowerCols[Math.floor(rng() * flowerCols.length)];
      const col2 = flowerCols[Math.floor(rng() * flowerCols.length)];
      for (let k = 0; k < perBed; k++) {
        const a = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * br * 1.15;
        const x = bx + Math.cos(a) * rr;
        const z = bz + Math.sin(a) * rr;
        const y = LAWN_Y + 0.12 + (1 - rr / (br * 1.15)) * br * 0.32 + rng() * 0.06;
        const s = 0.8 + rng() * 0.7;
        _m4.compose(_p.set(x, y, z), _q.identity(), _s.set(s, s * 0.7, s));
        flowers.setMatrixAt(nf, _m4);
        flowers.setColorAt(nf++, rng() < 0.7 ? col : col2);
      }
    }
    // a few loose round bushes
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const r = 14 + rng() * 26;
      const s = 0.5 + rng() * 1.1;
      _m4.compose(_p.set(Math.cos(a) * r, LAWN_Y + s * 0.3, Math.sin(a) * r), _q.identity(), _s.set(s, s * 0.7, s));
      bushes.setMatrixAt(nb++, _m4);
    }
    bushes.count = nb;
    flowers.count = nf;
    bushes.castShadow = true;
    bushes.receiveShadow = true;
    root.add(bushes, flowers);
  }

  // ---------------- festival props: egg huts, banners, tent, crates, trees
  {
    // egg huts
    const eggProf = [];
    eggProf.push(new THREE.Vector2(0.01, 0));
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const r = 1.9 * Math.sin((0.22 + 0.78 * Math.pow(t, 0.8)) * Math.PI);
      eggProf.push(new THREE.Vector2(Math.max(0.01, r), t * 5.6));
    }
    const hutMat = keep(new THREE.MeshStandardMaterial({ map: hutTexture(), roughness: 0.5, metalness: 0.1, envMapIntensity: 0.9 }));
    const tealMat = keep(new THREE.MeshStandardMaterial({ color: '#2aa898', roughness: 0.45, metalness: 0.3 }));
    const goldMat = keep(new THREE.MeshStandardMaterial({ color: '#d9a64a', roughness: 0.35, metalness: 0.8 }));
    const doorMat = keep(new THREE.MeshStandardMaterial({ color: '#3a1d14', roughness: 0.9 }));
    const huts = [
      [-13.5, 15.5, 1.0],
      [16.5, 12, 0.85],
      [-19, -2, 0.8],
    ];
    const hutGeos = [];
    const tealGeos = [];
    const goldGeos = [];
    const doorGeos = [];
    for (const [x, z, s] of huts) {
      const face = Math.atan2(-x, -z);
      const shell = new THREE.LatheGeometry(eggProf, 28);
      shell.scale(s, s, s);
      shell.rotateY(face);
      shell.translate(x, LAWN_Y, z);
      hutGeos.push(shell);
      // teal leaf crown + gold spire
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const leaf = new THREE.SphereGeometry(1, 10, 8);
        leaf.scale(0.22 * s, 0.75 * s, 0.1 * s);
        leaf.rotateZ(0.5);
        leaf.rotateY(a);
        leaf.translate(x + Math.cos(a) * 0.35 * s, LAWN_Y + 5.35 * s, z - Math.sin(a) * 0.35 * s);
        tealGeos.push(leaf);
      }
      const spire = new THREE.ConeGeometry(0.12 * s, 1.2 * s, 10);
      spire.translate(x, LAWN_Y + 6.1 * s, z);
      goldGeos.push(spire);
      const ring = new THREE.TorusGeometry(1.95 * s, 0.07 * s, 8, 40);
      ring.rotateX(Math.PI / 2);
      ring.translate(x, LAWN_Y + 1.55 * s, z);
      goldGeos.push(ring);
      // door arch facing the plaza
      const door = new THREE.CircleGeometry(0.75 * s, 20, 0, Math.PI);
      const dp = new THREE.PlaneGeometry(1.5 * s, 1.1 * s);
      dp.translate(0, -0.55 * s, 0);
      const dg = merge([door, dp]);
      dg.translate(0, LAWN_Y + 1.25 * s, 0);
      dg.translate(0, 0, 1.93 * s);
      dg.rotateY(face);
      dg.translate(x, 0, z);
      doorGeos.push(dg);
      // teal side windows
      for (const side of [-1, 1]) {
        const w = new THREE.CircleGeometry(0.3 * s, 16);
        w.translate(0, LAWN_Y + 3.0 * s, 1.6 * s);
        w.rotateY(face + side * 0.9);
        w.translate(x, 0, z);
        tealGeos.push(w);
      }
    }
    const addMesh = (geos, mat, cast = true) => {
      const m = new THREE.Mesh(keep(merge(geos)), mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      root.add(m);
      return m;
    };
    addMesh(hutGeos, hutMat);
    addMesh(tealGeos, tealMat);
    addMesh(goldGeos, goldMat);
    addMesh(doorGeos, doorMat, false);

    // tall yellow banners on dark poles (pairs on the far side, singles on the sides)
    const bannerSpots = [
      [-5.2, 14.2],
      [-3.8, 14.2],
      [3.8, 14.2],
      [5.2, 14.2],
      [15.2, 1.2],
      [15.2, -1.2],
      [-15.2, 5.5],
      [-15.2, 3.8],
    ];
    const poleGeos = [];
    const bannerGeos = [];
    for (const [x, z] of bannerSpots) {
      const face = Math.atan2(-x, -z);
      poleGeos.push(xf(new THREE.CylinderGeometry(0.07, 0.09, 8.6, 8), [x, LAWN_Y + 4.3, z]));
      poleGeos.push(xf(new THREE.SphereGeometry(0.16, 10, 8), [x, LAWN_Y + 8.7, z]));
      const bar = new THREE.CylinderGeometry(0.04, 0.04, 1.35, 6);
      bar.rotateZ(Math.PI / 2);
      bar.rotateY(face);
      bar.translate(x, LAWN_Y + 8.2, z);
      poleGeos.push(bar);
      const bn = new THREE.PlaneGeometry(1.2, 4.8, 1, 10);
      const bp = bn.attributes.position;
      for (let i = 0; i < bp.count; i++) bp.setZ(i, Math.sin(bp.getY(i) * 1.3) * 0.08);
      bn.computeVertexNormals();
      bn.translate(0, LAWN_Y + 5.75, 0.12);
      bn.rotateY(face);
      bn.translate(x, 0, z);
      bannerGeos.push(bn);
    }
    addMesh(poleGeos, keep(new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 0.6, metalness: 0.3 })));
    const banners = addMesh(
      bannerGeos,
      keep(new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.7, alphaTest: 0.5 })),
    );

    // striped festival tent with a sail-like canopy (left side)
    {
      const tx = 16.5;
      const tz = 6.5;
      const canopy = new THREE.ConeGeometry(3.2, 2.0, 12, 1, true);
      canopy.translate(tx, LAWN_Y + 3.4, tz);
      const tentMat = keep(new THREE.MeshStandardMaterial({ map: stripeTexture('#f3ead6', '#c98f4e', 12), side: THREE.DoubleSide, roughness: 0.8 }));
      addMesh([canopy], tentMat);
      const poles = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        poles.push(xf(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6), [tx + Math.cos(a) * 2.9, LAWN_Y + 1.25, tz + Math.sin(a) * 2.9]));
      }
      poles.push(xf(new THREE.CylinderGeometry(0.08, 0.08, 4.8, 6), [tx, LAWN_Y + 2.4, tz]));
      addMesh(poles, keep(new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.8 })));
      // big curved sail
      const sail = new THREE.PlaneGeometry(4.2, 3.2, 10, 6);
      const sp = sail.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const u = sp.getX(i) / 2.1;
        const v = sp.getY(i) / 1.6;
        sp.setZ(i, (1 - u * u) * 0.9 + (1 - v * v) * 0.25);
      }
      sail.computeVertexNormals();
      sail.rotateY(0.6);
      sail.translate(tx + 2.5, LAWN_Y + 3.6, tz + 4);
      addMesh([sail], keep(new THREE.MeshStandardMaterial({ map: stripeTexture('#f5efe2', '#b9874c', 10), side: THREE.DoubleSide, roughness: 0.8 })));
    }

    // crates, barrels, tables (vertex coloured, one draw call)
    const props = [];
    const crateSpots = [
      [13.2, 9.8],
      [14.0, 10.6],
      [13.6, 11.3],
      [18.6, 4.0],
      [-11.0, 12.6],
      [-10.4, 13.3],
      [-16.2, 9.5],
      [12.5, -11.5],
      [-12.8, -10.6],
    ];
    for (const [x, z] of crateSpots) {
      const s = 0.55 + rng() * 0.35;
      if (rng() < 0.55) {
        props.push(tint(xf(new THREE.BoxGeometry(s, s, s), [x, LAWN_Y + s / 2, z], [0, rng() * 3, 0]), '#9a6a3c'));
        props.push(tint(xf(new THREE.BoxGeometry(s * 1.02, 0.06, s * 1.02), [x, LAWN_Y + s * 0.8, z], [0, 0, 0]), '#6b4528'));
      } else {
        props.push(tint(xf(new THREE.CylinderGeometry(s * 0.4, s * 0.45, s * 1.1, 12), [x, LAWN_Y + s * 0.55, z]), '#8a5a32'));
        props.push(tint(xf(new THREE.TorusGeometry(s * 0.43, 0.025, 4, 16), [x, LAWN_Y + s * 0.8, z], [Math.PI / 2, 0, 0]), '#3a3a3a'));
      }
    }
    // picnic tables with red cloths (right side like the reference)
    for (const [x, z] of [
      [-13.5, 6],
      [-14.5, 9.5],
      [12.5, -5],
    ]) {
      props.push(tint(xf(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 16), [x, LAWN_Y + 0.75, z]), '#c64a3a'));
      props.push(tint(xf(new THREE.CylinderGeometry(0.1, 0.16, 0.75, 8), [x, LAWN_Y + 0.37, z]), '#5a3a26'));
      props.push(tint(xf(new THREE.SphereGeometry(0.12, 8, 6), [x + 0.3, LAWN_Y + 0.85, z]), '#ffd84a'));
      props.push(tint(xf(new THREE.SphereGeometry(0.1, 8, 6), [x - 0.25, LAWN_Y + 0.84, z + 0.2]), '#ff7ab8'));
    }
    // stylised trees (autumn orange + green)
    const trees = [
      [-21, 13, '#e0782a'],
      [22, 16, '#5fa84a'],
      [-25, -12, '#e8a03a'],
      [24, -14, '#4f9a44'],
      [0, 28, '#d9662a'],
      [-8, 30, '#6ab04c'],
    ];
    for (const [x, z, col] of trees) {
      props.push(tint(xf(new THREE.CylinderGeometry(0.25, 0.4, 4, 7), [x, LAWN_Y + 2, z]), '#6b4a30'));
      for (let k = 0; k < 4; k++) {
        const s = 1.6 + rng() * 1.0;
        props.push(tint(jitter(xf(new THREE.IcosahedronGeometry(s, 1), [x + (rng() - 0.5) * 2.2, LAWN_Y + 4.2 + rng() * 1.8, z + (rng() - 0.5) * 2.2]), 0.3, k), col));
      }
    }
    const propMesh = new THREE.Mesh(keep(merge(props, false)), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true })));
    propMesh.castShadow = true;
    propMesh.receiveShadow = true;
    root.add(propMesh);

    // festive bunting: sagging strings from the plaza's finial posts out to the banner poles, with pennants
    {
      const top = LAWN_Y + 8.0;
      const P = 9.48; // inset balustrade half-size (post line)
      const pz = 2.34; // posts at 1/3 of the long edges
      const lines = [
        [[-3.8, top, 14.2], [3.8, top, 14.2], 1.6],
        [[-5.2, top, 14.2], [-pz, 1.95, P], 1.0],
        [[5.2, top, 14.2], [pz, 1.95, P], 1.0],
        [[-3.8, top, 14.2], [-pz, 1.95, P], 0.9],
        [[3.8, top, 14.2], [pz, 1.95, P], 0.9],
        [[15.2, top, 1.2], [P, 1.95, pz], 1.0],
        [[15.2, top, -1.2], [P, 1.95, -pz], 1.0],
        [[-15.2, top, 5.5], [-P, 1.95, pz], 1.0],
        [[-15.2, top, 3.8], [-P, 1.95, -pz], 1.2],
      ];
      const flagCols = ['#e8463a', '#ffd23a', '#2bb3a3', '#ffffff', '#ff7ab8', '#4a8fe0'].map((c) => new THREE.Color(c));
      const strPts = [];
      const flagMats = [];
      const A = new THREE.Vector3();
      const B = new THREE.Vector3();
      const Q = new THREE.Vector3();
      for (const [a, bb, sag] of lines) {
        A.set(a[0], a[1], a[2]);
        B.set(bb[0], bb[1], bb[2]);
        const len = A.distanceTo(B);
        const segs = 24;
        const pt = (t, out) => out.lerpVectors(A, B, t).setY(A.y + (B.y - A.y) * t - Math.sin(Math.PI * t) * sag);
        for (let i = 0; i < segs; i++) {
          pt(i / segs, Q);
          strPts.push(Q.x, Q.y, Q.z);
          pt((i + 1) / segs, Q);
          strPts.push(Q.x, Q.y, Q.z);
        }
        const yaw = Math.atan2(B.x - A.x, B.z - A.z) + Math.PI / 2;
        const count = Math.floor(len / 0.55);
        for (let k = 1; k < count; k++) {
          pt(k / count, Q);
          flagMats.push([Q.x, Q.y, Q.z, yaw, flagCols[(k + Math.round(len)) % flagCols.length]]);
        }
      }
      const strGeo = keep(new THREE.BufferGeometry());
      strGeo.setAttribute('position', new THREE.Float32BufferAttribute(strPts, 3));
      root.add(new THREE.LineSegments(strGeo, keep(new THREE.LineBasicMaterial({ color: '#5a4636' }))));
      const tri = keep(new THREE.BufferGeometry());
      tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.16, 0, 0, 0.16, 0, 0, 0, -0.34, 0], 3));
      tri.computeVertexNormals();
      const flags = new THREE.InstancedMesh(tri, keep(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 })), flagMats.length);
      flagMats.forEach(([x, y, z, yaw, c], i) => {
        _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(1, 1, 1));
        flags.setMatrixAt(i, _m4);
        flags.setColorAt(i, c);
      });
      root.add(flags);
    }

    // gentle banner sway
    animated.push((dt, t) => {
      banners.rotation.y = Math.sin(t * 0.7) * 0.004;
    });
  }

  // ---------------- distant scenery: rock spires, floating islands, cloud sea, hot-air balloons
  {
    const rocks = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.15;
      const r = 120 + rng() * 70;
      const h = 30 + rng() * 55;
      const w = 9 + rng() * 14;
      const g = jitter(new THREE.CylinderGeometry(w * 0.35, w, h, 7, 4), w * 0.25, i);
      g.translate(Math.cos(a) * r, -18 + h / 2, Math.sin(a) * r);
      rocks.push(tint(g, rng() < 0.5 ? '#a99a86' : '#9a8f80'));
      const cap = jitter(new THREE.CylinderGeometry(w * 0.42, w * 0.36, 3, 7, 1), 1.0, i + 50);
      cap.translate(Math.cos(a) * r, -18 + h + 1, Math.sin(a) * r);
      rocks.push(tint(cap, '#6f9a52'));
    }
    // floating islands
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const r = 55 + rng() * 45;
      const y = 12 + rng() * 28;
      const s = 3 + rng() * 6;
      const top = jitter(new THREE.CylinderGeometry(s, s * 0.9, s * 0.4, 9, 1), s * 0.12, i + 100);
      top.translate(Math.cos(a) * r, y, Math.sin(a) * r);
      rocks.push(tint(top, '#76a84f'));
      const bot = jitter(new THREE.ConeGeometry(s * 0.9, s * 2.2, 9, 3), s * 0.2, i + 200);
      bot.rotateX(Math.PI);
      bot.translate(Math.cos(a) * r, y - s * 1.3, Math.sin(a) * r);
      rocks.push(tint(bot, '#9b8a74'));
    }
    const far = new THREE.Mesh(keep(merge(rocks, false)), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));
    far.name = 'farScenery';
    root.add(far);

    // cloud billboards, merged into one mesh; each quad faces the plaza centre
    const quads = [];
    for (let i = 0; i < 46; i++) {
      const a = rng() * Math.PI * 2;
      const r = 70 + rng() * 110;
      const y = i < 30 ? -16 + rng() * 10 : 8 + rng() * 30;
      const w = 30 + rng() * 40;
      const q = new THREE.PlaneGeometry(w, w * 0.5);
      q.lookAt(new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)));
      q.translate(Math.cos(a) * r, y, Math.sin(a) * r);
      quads.push(q);
    }
    // a flat sea of clouds below the island
    const sea = new THREE.PlaneGeometry(700, 700);
    sea.rotateX(-Math.PI / 2);
    sea.translate(0, -24, 0);
    const cloudMat = keep(
      new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, color: '#ffffff', fog: true, side: THREE.DoubleSide }),
    );
    const clouds = new THREE.Mesh(keep(merge(quads)), cloudMat);
    clouds.renderOrder = -10;
    root.add(clouds);
    const seaMesh = new THREE.Mesh(keep(sea), keep(new THREE.MeshBasicMaterial({ color: '#eef4f8', fog: true })));
    root.add(seaMesh);
    animated.push((dt) => {
      clouds.rotation.y += dt * 0.004;
    });

    // hot-air balloons
    const hab = [];
    const habCols = ['#e8b830', '#e05a3a', '#4aa0d8'];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const env = new THREE.SphereGeometry(2.2, 16, 12);
      env.scale(1, 1.2, 1);
      const envMesh = new THREE.Mesh(env, keep(new THREE.MeshStandardMaterial({ map: stripeTexture(habCols[i], '#f5efe2', 10), roughness: 0.7 })));
      keep(env);
      const basket = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.6, 0.5, 0.7, 8)), keep(new THREE.MeshStandardMaterial({ color: '#7a5030' })));
      basket.position.y = -3.6;
      g.add(envMesh, basket);
      const a = 0.6 + i * 1.9 + rng() * 0.5;
      const r = 40 + rng() * 25;
      g.position.set(Math.cos(a) * r, 16 + rng() * 14, Math.sin(a) * r);
      root.add(g);
      hab.push({ g, y0: g.position.y, ph: rng() * 6 });
    }
    animated.push((dt, t) => {
      for (const h of hab) h.g.position.y = h.y0 + Math.sin(t * 0.3 + h.ph) * 0.8;
    });
  }

  // ---------------- spectators on the walkway + Festival Manager NPC
  const crowd = [];
  {
    const spots = [];
    const sideSpots = (n, side) => {
      for (let i = 0; i < n; i++) {
        const along = -5.6 + (11.2 * (i + 0.5)) / n + (rng() - 0.5) * 1.2;
        const depth = IN + 0.55 + rng() * 1.5;
        const [x, z] = side === 0 ? [along, depth] : side === 1 ? [depth, along] : side === 2 ? [along, -depth] : [-depth, along];
        spots.push([x, z]);
      }
    };
    sideSpots(5, 0); // far side (+z)
    sideSpots(4, 1); // +x side
    sideSpots(2, 2); // near side (-z), sparse so the default camera isn't blocked
    sideSpots(4, 3); // -x side
    // NPC corner (far-right from the default camera = -x,+z) must stay clear
    const npcPos = [-(IN + 0.65), IN + 0.65];
    for (const [x, z] of spots) {
      if (Math.hypot(x - npcPos[0], z - npcPos[1]) < 1.6) continue;
      const col = SPECTATOR_COLORS[Math.floor(rng() * SPECTATOR_COLORS.length)];
      const m = createSpectator({ color: col, scale: 0.92 + rng() * 0.16 });
      m.root.position.set(x, 0, z);
      m.root.rotation.y = Math.atan2(-x, -z) + (rng() - 0.5) * 0.6;
      root.add(m.root);
      crowd.push({ m, st: {} });
    }
    const npc = createRiggedMascot({ color: '#7b2430', name: 'Shugo Festival Manager', npc: true, hat: '#d4282a', scale: 1.0 });
    npc.root.position.set(npcPos[0], 0, npcPos[1]);
    npc.root.rotation.y = Math.atan2(-npcPos[0], -npcPos[1]);
    root.add(npc.root);
    crowd.push({ m: npc, st: { moving: false, airborne: false, vy: 0 } });
  }

  let t = 0;
  function update(dt, now) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    t += dt;
    for (const f of animated) f(dt, t, now);
    // spectators run their own idle/cheer/clap brain (anim/riggedMascot.js)
    for (const c of crowd) {
      c.m.update(dt, c.st);
    }
  }

  return {
    update,
    root,
    dispose() {
      for (const c of crowd) c.m.dispose();
      for (const d of disposables) d.dispose && d.dispose();
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      root.removeFromParent();
    },
  };
}
