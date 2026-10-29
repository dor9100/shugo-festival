// Rig + clip library for the rigged mascot.
// mascot-anims.glb (tools/anim/build-clips.mjs) holds the UE-Manny-layout skeleton (26 joints, fingers removed) and the
// clips, all rotation-driven plus the pelvis translation. Here we shorten the bone offsets into chibi proportions
// (rotations still apply: the clips "just work"), scale the pelvis track to the new leg length, add procedural
// ear/tail bones, and make a few derived clips (additive hit flinch, a clap solved with 2-bone IK).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const BONES = [
  'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'neck_01', 'neck_02', 'head',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
];
// procedural (not in any clip): ears on the head, a 3-bone tail on the pelvis
export const EXTRA = ['ear_l', 'ear_r', 'tail_1', 'tail_2', 'tail_3'];
export const ALL_BONES = [...BONES, ...EXTRA];
export const BONE_INDEX = Object.fromEntries(ALL_BONES.map((b, i) => [b, i]));

/** Chibi proportions: scale of each bone's offset from its parent, relative to the 1.83 m source rig. */
export const PROPS = {
  legs: 0.31, // pelvis height, thigh/calf/foot lengths (the pelvis translation track is scaled by this too)
  hipWidth: 1.5, // extra hip-joint spacing so the little feet sit apart under the robe (wider = more foot slide from the pelvis twist)
  spine: 0.4, // pelvis -> chest
  clavicle: 0.6,
  shoulders: 0.74, // clavicle length (shoulder width): arms clear the big head when raised
  arms: 0.42, // upper arm + forearm (long enough that waves / cheers read from the overview camera)
  neckBase: 0.2, // chest -> neck
  neck: 0.25,
};

const SPINE = new Set(['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05']);
function offsetScale(name) {
  if (name === 'pelvis' || name.startsWith('thigh_') || name.startsWith('calf_') || name.startsWith('foot_') || name.startsWith('ball_')) return PROPS.legs;
  if (SPINE.has(name)) return PROPS.spine;
  if (name.startsWith('clavicle_')) return PROPS.clavicle;
  if (name.startsWith('upperarm_')) return PROPS.shoulders;
  if (name.startsWith('lowerarm_') || name.startsWith('hand_')) return PROPS.arms;
  if (name === 'neck_01') return PROPS.neckBase;
  if (name === 'neck_02' || name === 'head') return PROPS.neck;
  return 1;
}

// Extra bones: rest position in model space (design units), rest world rotation = identity (so their procedural
// rotations are expressed in character axes: x = pitch, y = yaw, z = roll).
const EXTRA_DEF = {
  ear_l: { parent: 'head', pos: (J) => new THREE.Vector3(0.095, J.headC.y + 0.135, J.headC.z - 0.03) },
  ear_r: { parent: 'head', pos: (J) => new THREE.Vector3(-0.095, J.headC.y + 0.135, J.headC.z - 0.03) },
  tail_1: { parent: 'pelvis', pos: (J) => new THREE.Vector3(0, J.pelvis.y - 0.07, J.pelvis.z - 0.15) },
  tail_2: { parent: 'tail_1', pos: (J) => new THREE.Vector3(0, J.pelvis.y + 0.0, J.pelvis.z - 0.26) },
  tail_3: { parent: 'tail_2', pos: (J) => new THREE.Vector3(0, J.pelvis.y + 0.14, J.pelvis.z - 0.3) },
};

/** Builds the shared rig template from the loaded glTF. */
export function buildRigTemplate(gltf) {
  const src = {};
  gltf.scene.traverse((o) => {
    if (BONE_INDEX[o.name] !== undefined && BONE_INDEX[o.name] < BONES.length) src[o.name] = o;
  });
  for (const b of BONES) if (!src[b]) throw new Error(`mascot-anims.glb: missing bone ${b}`);
  const parent = BONES.map((b) => (src[b].parent && src[b].parent.name in src ? src[b].parent.name : null));
  const restT = BONES.map((b) => {
    const t = src[b].position.clone().multiplyScalar(offsetScale(b));
    if (b.startsWith('thigh_')) t.z *= PROPS.hipWidth; // pelvis-local z = character left/right
    return t;
  });
  const restQ = BONES.map((b) => src[b].quaternion.clone());

  // world rest of the clip bones
  const tmp = makeBonesRaw(parent, restT, restQ, BONES);
  tmp.top.updateMatrixWorld(true);
  const W = {};
  for (const b of BONES) W[b] = tmp.byName[b].matrixWorld.clone();
  const J = {};
  for (const b of BONES) J[b] = new THREE.Vector3().setFromMatrixPosition(W[b]);
  // head centre (design units): above the head joint, slightly forward
  J.headC = J.head.clone().add(new THREE.Vector3(0, 0.165, 0.025));

  // extra bones -> local TRS relative to their parents (world rotation identity at rest)
  const allParent = [...parent];
  const allT = [...restT];
  const allQ = [...restQ];
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  for (const e of EXTRA) {
    const d = EXTRA_DEF[e];
    const world = d.pos(J);
    J[e] = world;
    const pW = W[d.parent];
    const pInv = _m.copy(pW).invert();
    const local = world.clone().applyMatrix4(pInv);
    const pq = new THREE.Quaternion().setFromRotationMatrix(pW);
    const lq = pq.clone().invert();
    allParent.push(d.parent);
    allT.push(local);
    allQ.push(lq);
    W[e] = new THREE.Matrix4().compose(world, _q.identity(), new THREE.Vector3(1, 1, 1));
  }
  const boneInverses = ALL_BONES.map((b) => W[b].clone().invert());
  return { parent: allParent, restT: allT, restQ: allQ, W, J, boneInverses };
}

function makeBonesRaw(parent, T, Q, names) {
  const top = new THREE.Group();
  top.name = 'mascot_rig';
  const bones = names.map((name, i) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(T[i]);
    b.quaternion.copy(Q[i]);
    return b;
  });
  const byName = {};
  bones.forEach((b) => (byName[b.name] = b));
  bones.forEach((b, i) => (parent[i] ? byName[parent[i]] : top).add(b));
  return { top, bones, byName };
}

/** A fresh bone set (in rest pose) for one mascot. */
export function makeBones(tpl) {
  return makeBonesRaw(tpl.parent, tpl.restT, tpl.restQ, ALL_BONES);
}

// ------------------------------------------------------------------ clips
const UPPER = new Set(['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'neck_01', 'neck_02', 'head']);
const trackBone = (t) => t.name.slice(0, t.name.lastIndexOf('.'));

function prepareClips(gltf, tpl) {
  const clips = {};
  for (const c of gltf.animations) {
    for (const t of c.tracks) {
      if (t.name === 'pelvis.position') {
        // scale the hips track to the new leg length (it is in the root's space, like the pelvis rest offset)
        const v = t.values;
        for (let i = 0; i < v.length; i++) v[i] *= PROPS.legs;
      }
    }
    clips[c.name] = c;
  }
  // additive flinches (upper body only), relative to their first frame
  for (const name of ['hit', 'hit_b']) {
    if (!clips[name]) continue;
    const c = clips[name].clone();
    c.tracks = c.tracks.filter((t) => UPPER.has(trackBone(t)) && t.name.endsWith('.quaternion'));
    THREE.AnimationUtils.makeClipAdditive(c, 0, c, 30);
    c.name = `${name}_add`;
    clips[c.name] = c;
  }
  clips.clap = synthClap(tpl, clips.idle_hips || clips.idle);
  return clips;
}

/** Pose the bones from a clip at time t (no mixer), quaternion + position tracks. */
function poseFromClip(byName, clip, t) {
  for (const tr of clip.tracks) {
    const b = byName[trackBone(tr)];
    if (!b) continue;
    const interp = tr.createInterpolant();
    const v = interp.evaluate(t);
    if (tr.name.endsWith('.quaternion')) b.quaternion.fromArray(v);
    else if (tr.name.endsWith('.position')) b.position.fromArray(v);
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
/** Rotate `bone` (world-space delta) so the direction from it to `childWorld` points at `targetWorld`. */
function aimBone(bone, childPos, targetPos) {
  const p = bone.getWorldPosition(_a);
  const from = _b.copy(childPos).sub(p).normalize();
  const to = _c.copy(targetPos).sub(p).normalize();
  _qd.setFromUnitVectors(from, to);
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  _qw.premultiply(_qd);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

/** Two-bone IK: shoulder (upperarm), elbow (lowerarm), wrist (hand) -> hand at `target`, elbow toward `pole`. */
function solveArm(byName, side, target, pole) {
  const up = byName[`upperarm_${side}`];
  const lo = byName[`lowerarm_${side}`];
  const hd = byName[`hand_${side}`];
  const S = up.getWorldPosition(new THREE.Vector3());
  const E = lo.getWorldPosition(new THREE.Vector3());
  const H = hd.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E);
  const b = E.distanceTo(H);
  const toT = target.clone().sub(S);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const dir = toT.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = pole.clone().sub(S);
  perp.addScaledVector(dir, -perp.dot(dir)).normalize();
  const elbow = S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  aimBone(up, E, elbow);
  aimBone(lo, hd.getWorldPosition(new THREE.Vector3()), S.clone().addScaledVector(dir, d));
}

/** A clap loop (two claps, 0.8 s) on top of a base idle: the arms are solved with IK so the paws meet in front. */
function synthClap(tpl, base) {
  const { top, byName } = makeBones(tpl);
  const D = 0.8;
  const N = 24;
  const times = [];
  const tracks = {};
  const names = ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'spine_03', 'spine_05', 'head', 'neck_01'];
  for (const n of names) tracks[n] = [];
  const pelvisPos = [];
  const pelvisQ = [];
  const J = tpl.J;
  for (let i = 0; i <= N; i++) {
    const t = (D * i) / N;
    times.push(t);
    for (let k = 0; k < tpl.restQ.length; k++) {
      const b = byName[ALL_BONES[k]];
      b.position.copy(tpl.restT[k]);
      b.quaternion.copy(tpl.restQ[k]);
    }
    poseFromClip(byName, base, (t * 1.3) % base.duration);
    // a little happy bounce in the spine and head on each clap
    const beat = (t / D) * 2; // two claps per loop
    const ph = beat - Math.floor(beat);
    const close = Math.pow(Math.max(0, Math.cos(ph * Math.PI * 2)), 3); // 1 at the clap
    const bounce = Math.sin(ph * Math.PI * 2);
    byName.spine_03.rotateZ(0.04 * bounce);
    byName.head.rotateZ(-0.08 * bounce);
    byName.head.rotateY(0.06 * Math.sin(t * Math.PI * 2 / D));
    top.updateMatrixWorld(true);
    // paws: apart (open) -> touching (clap) in front of the chest, a bit above it
    const chest = J.spine_05.clone();
    const sep = 0.012 + 0.075 * (1 - close);
    const y = chest.y + 0.02 + 0.02 * close;
    const z = J.spine_05.z + 0.16;
    for (const [side, sx] of [['l', 1], ['r', -1]]) {
      const target = new THREE.Vector3(sx * sep, y, z);
      const pole = new THREE.Vector3(sx * 0.35, chest.y - 0.25, J.spine_05.z - 0.05);
      solveArm(byName, side, target, pole);
    }
    for (const n of names) tracks[n].push(...byName[n].quaternion.toArray());
    pelvisPos.push(...byName.pelvis.position.toArray());
    pelvisQ.push(...byName.pelvis.quaternion.toArray());
  }
  const kf = names.map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, tracks[n]));
  // the base clip's legs/hips at the same times (so the clap is a full-body clip, no rest-pose bleed)
  const keep = base.tracks.filter((tr) => !names.includes(trackBone(tr)));
  const resampled = keep.map((tr) => {
    const interp = tr.createInterpolant();
    const vals = [];
    for (const t of times) vals.push(...interp.evaluate((t * 1.3) % base.duration));
    return new tr.constructor(tr.name, times, vals);
  });
  return new THREE.AnimationClip('clap', D, [...kf, ...resampled]);
}

// ------------------------------------------------------------------ loading
let assetsPromise = null;
/** Load mascot-anims.glb once (cached). Resolves to { tpl, clips }. */
export function loadRigAssets(url) {
  if (!assetsPromise) {
    const href = url || new URL('models/mascot-anims.glb', document.baseURI).href;
    assetsPromise = (async () => {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(href);
      const tpl = buildRigTemplate(gltf);
      const clips = prepareClips(gltf, tpl);
      return { tpl, clips };
    })();
  }
  return assetsPromise;
}
