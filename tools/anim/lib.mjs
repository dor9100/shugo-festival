// Shared helpers for the mascot animation tools: read GLB skeletons/clips with gltf-transform, sample tracks,
// forward kinematics with three's math (no renderer needed).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';

export const FT = 'C:/Users/Dor/Desktop/repos/fun-game-test';
export const FIGHTERS = `${FT}/eclipse-tenkahoho/public/assets/fighters`;
export const PACK = `${FT}/eclipse/shared/animation packs/fighter-manny/clips-manny`;

let _io = null;
export async function io() {
  if (_io) return _io;
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  _io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  return _io;
}

const docCache = new Map();
export async function readDoc(path) {
  if (!docCache.has(path)) docCache.set(path, await (await io()).read(path));
  return docCache.get(path);
}

/** Bones (the 40 fighter joints) + their parents and rest TRS, read from a document's node tree. */
export function readSkeleton(doc, names) {
  const nodes = doc.getRoot().listNodes();
  const byName = new Map(nodes.map((n) => [n.getName(), n]));
  const parentOf = new Map();
  for (const n of nodes) for (const c of n.listChildren()) parentOf.set(c, n);
  const bones = names.map((name) => {
    const n = byName.get(name);
    if (!n) throw new Error(`missing bone ${name}`);
    const p = parentOf.get(n);
    return { name, parent: p && names.includes(p.getName()) ? p.getName() : null, t: n.getTranslation(), r: n.getRotation(), s: n.getScale() };
  });
  return bones;
}

/** All animations of a document as plain data: { name, duration, tracks: { bone: { rotation?, translation?, scale? } } } */
export function readClips(doc) {
  const out = new Map();
  for (const a of doc.getRoot().listAnimations()) {
    const tracks = {};
    let duration = 0;
    for (const ch of a.listChannels()) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath();
      const s = ch.getSampler();
      const times = Array.from(s.getInput().getArray());
      const acc = s.getOutput();
      const size = acc.getElementSize();
      const arr = acc.getArray();
      const norm = acc.getNormalized();
      const ct = acc.getComponentType();
      const scale = !norm ? 1 : ct === 5122 ? 1 / 32767 : ct === 5120 ? 1 / 127 : ct === 5123 ? 1 / 65535 : ct === 5121 ? 1 / 255 : 1;
      const values = Float64Array.from(arr, (v) => v * scale);
      duration = Math.max(duration, times[times.length - 1] || 0);
      (tracks[node.getName()] ||= {})[path] = { times, values, size, interp: s.getInterpolation() };
    }
    out.set(a.getName(), { name: a.getName(), duration, tracks });
  }
  return out;
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
/** Sample a track at time t (LINEAR / STEP; CUBICSPLINE treated as linear on the value part). */
export function sampleTrack(tr, t, out) {
  const { times, values, size } = tr;
  const n = times.length;
  const cubic = tr.interp === 'CUBICSPLINE';
  const stride = cubic ? size * 3 : size;
  const off = cubic ? size : 0;
  const at = (i, o) => {
    for (let k = 0; k < size; k++) o[k] = values[i * stride + off + k];
    return o;
  };
  if (n === 1 || t <= times[0]) return at(0, out);
  if (t >= times[n - 1]) return at(n - 1, out);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (times[m] <= t) lo = m;
    else hi = m;
  }
  const f = (t - times[lo]) / (times[hi] - times[lo]);
  if (tr.interp === 'STEP') return at(lo, out);
  if (size === 4) {
    const a = at(lo, [0, 0, 0, 0]);
    const b = at(hi, [0, 0, 0, 0]);
    _qa.set(a[0], a[1], a[2], a[3]);
    _qb.set(b[0], b[1], b[2], b[3]);
    _qa.slerp(_qb, f);
    out[0] = _qa.x;
    out[1] = _qa.y;
    out[2] = _qa.z;
    out[3] = _qa.w;
    return out;
  }
  const a = at(lo, new Array(size));
  const b = at(hi, new Array(size));
  for (let k = 0; k < size; k++) out[k] = a[k] + (b[k] - a[k]) * f;
  return out;
}

/** Local TRS of every bone at time t of a clip (falls back to rest). Returns { bone: {t:[3], r:[4]} }. */
export function poseAt(skel, clip, t, { translations = 'all' } = {}) {
  const pose = {};
  for (const b of skel) {
    const tr = clip?.tracks[b.name];
    const r = tr?.rotation ? sampleTrack(tr.rotation, t, [0, 0, 0, 0]) : [...b.r];
    let tt = [...b.t];
    if (tr?.translation && (translations === 'all' || translations.includes(b.name))) tt = sampleTrack(tr.translation, t, [0, 0, 0]);
    pose[b.name] = { t: tt, r };
  }
  return pose;
}

/** Model-space matrices for a pose. `top` = matrix applied above the topmost bone (e.g. the root's parent). */
export function fk(skel, pose, top = new THREE.Matrix4()) {
  const world = {};
  const one = new THREE.Vector3(1, 1, 1);
  for (const b of skel) {
    const p = pose[b.name];
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p.t), new THREE.Quaternion(...p.r), one);
    world[b.name] = b.parent ? world[b.parent].clone().multiply(m) : top.clone().multiply(m);
  }
  return world;
}

export const posOf = (m) => new THREE.Vector3().setFromMatrixPosition(m);

export { THREE };
