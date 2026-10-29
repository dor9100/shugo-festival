#!/usr/bin/env node
// Builds client/public/models/mascot-anims.glb: ONE skeleton (the UE-Manny layout used by the eclipse-tenkahoho
// fighters, fingers removed: 26 joints) + only the clips the mascot needs, in place, resampled, key-reduced,
// int16 rotations, EXT_meshopt_compression. The mesh is NOT in the file: the mascot body is built in code
// (client/src/anim/riggedMascot.js) on top of this skeleton with chibi proportions.
//
// Sources (read-only, outside this repo):
//   PACK     = fun-game-test/eclipse/shared/animation packs/fighter-manny/clips-manny  (UE "Fighter Animations Pack", in-place)
//   FIGHTERS = fun-game-test/eclipse-tenkahoho/public/assets/fighters/*.glb   (same rig; authored emotes + people-kit gestures)
// All share the same rest pose (tools/anim/compare-rest.mjs: < 0.05 deg).
//
// What is kept per clip: rotation tracks of the 26 joints, the pelvis translation (hips height/sway). Dropped:
// root bone motion (root motion stripped), every other translation, scale, fingers. The jump's vertical travel is
// removed (feet pinned to the floor: physics moves the character, the clip only poses it).
//
// Usage: node tools/anim/build-clips.mjs [-v]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import { readDoc, readSkeleton, readClips, poseAt, fk, posOf, FIGHTERS, PACK, THREE } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const OUT = path.join(repo, 'client/public/models/mascot-anims.glb');
const FPS = 30;
const ROT_TOL = 0.0015; // rad of slerp error a dropped key may cause
const POS_TOL = 0.0008; // m (full-size rig; the mascot is ~1/3 scale)

export const BONES = [
  'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'neck_01', 'neck_02', 'head',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
];
const LEGS = new Set(['pelvis', 'spine_01', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']);

const pack = (name) => {
  const f = fs.readdirSync(PACK).find((x) => x.startsWith(name + '-') && x.endsWith('.glb'));
  if (!f) throw new Error(`pack clip ${name} not found`);
  return { file: path.join(PACK, f), clip: 'Animation' };
};
const fighter = (who, clip) => ({ file: `${FIGHTERS}/${who}.glb`, clip });

// out name -> spec. `src` single source (+ optional from/to), `segments` concatenation on a new timeline,
// `legs`/`upper` composite, `pin` = keep the lowest foot on the floor (remove baked jump height).
const CLIPS = [
  // --- locomotion (Fighter pack, in-place loops, all 0.667 s except the sprint)
  { out: 'idle', src: pack('Idle_Seq'), loop: true },
  { out: 'run', src: pack('Run_F_0_Loop_IP_Seq'), loop: true },
  { out: 'sprint', src: pack('Run_Fast_Loop_IP_Seq'), loop: true },
  { out: 'run_back', src: pack('Run_B_180_Loop_IP_Seq'), loop: true },
  { out: 'strafe_l', src: pack('Run_F_L_90_Loop_IP_Seq'), loop: true },
  { out: 'strafe_r', src: pack('Run_F_R_90_Loop_IP_Seq'), loop: true },
  // --- jump: jump_air is liftoff -> apex -> touchdown on a normalised 1 s timeline; the runtime scrubs it by vy so it
  //     always spans exactly the physics airtime (JUMP_AIRTIME). jump_land = the landing crouch + recovery.
  {
    out: 'jump_air',
    pin: true,
    segments: [
      { ...pack('Jump_0_Start_Seq'), from: 0.15, to: 0.4, at: 0, len: 0.4 },
      { ...pack('Jump_0_Loop_Seq'), from: 0, to: 0.333, at: 0.4, len: 0.32 },
      { ...pack('Jump_0_End_Seq'), from: 0, to: 0.133, at: 0.72, len: 0.28 },
    ],
  },
  { out: 'jump_land', src: { ...pack('Jump_0_End_Seq'), from: 0.133, to: 0.767 }, pin: true },
  // --- reactions
  { out: 'hit', src: pack('Hit_F_Seq') },
  { out: 'hit_b', src: pack('Hit_B_Seq') },
  // --- fear: the run's legs + Maor's "Waaa" (arms flailing overhead, head thrown back), time-fitted to the run cycle
  { out: 'fear', loop: true, legs: pack('Run_F_0_Loop_IP_Seq'), upper: fighter('maor', 'Maor_Waaa_Loop') },
  // --- spectators / results
  { out: 'cheer', src: fighter('maor', 'Maor_Victory'), loop: true }, // hopping side to side, arms up waving in turn
  { out: 'jazz', src: fighter('boolbooloni', 'Bool_JazzHands'), loop: true }, // jazz hands by the face, knees bobbing
  { out: 'victory', src: fighter('boolbooloni', 'Bool_Victory'), loop: true }, // hand behind head, pointing at the sky
  { out: 'wave', src: fighter('ofek', 'Wave') },
  { out: 'idle_hips', src: fighter('ofek', 'Idle_Hips'), loop: true },
];

// ------------------------------------------------------------------ helpers
function slerpArr(a, b, t) {
  const qa = new THREE.Quaternion(...a);
  return qa.slerp(new THREE.Quaternion(...b), t).toArray();
}
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

function reduce(times, values, size) {
  const n = times.length;
  const at = (i) => values.slice(i * size, i * size + size);
  if (n <= 2) return { times, values };
  const keep = [0];
  let last = 0;
  for (let i = 1; i < n - 1; i++) {
    const a = at(last);
    const b = at(i + 1);
    let ok = true;
    for (let j = last + 1; j <= i && ok; j++) {
      const t = (times[j] - times[last]) / (times[i + 1] - times[last]);
      const v = at(j);
      if (size === 4) ok = angle(slerpArr(a, b, t), v) <= ROT_TOL;
      else ok = Math.hypot(...v.map((x, k) => a[k] + (b[k] - a[k]) * t - x)) <= POS_TOL;
    }
    if (!ok) {
      keep.push(i);
      last = i;
    }
  }
  keep.push(n - 1);
  const first = at(0);
  const constant = keep.every((i) => (size === 4 ? angle(first, at(i)) <= ROT_TOL : Math.hypot(...first.map((x, k) => x - at(i)[k])) <= POS_TOL));
  const ids = constant ? [0] : keep;
  return { times: ids.map((i) => times[i]), values: ids.flatMap((i) => at(i)) };
}

function continuous(values) {
  for (let i = 4; i < values.length; i += 4) {
    const d = values[i] * values[i - 4] + values[i + 1] * values[i - 3] + values[i + 2] * values[i - 2] + values[i + 3] * values[i - 1];
    if (d < 0) for (let k = 0; k < 4; k++) values[i + k] = -values[i + k];
  }
  return values;
}

async function clipOf({ file, clip }) {
  const doc = await readDoc(file);
  const c = readClips(doc).get(clip);
  if (!c) throw new Error(`${file}: no clip ${clip}`);
  return c;
}

// ------------------------------------------------------------------ build
const refDoc = await readDoc(`${FIGHTERS}/ofek.glb`);
const skel = readSkeleton(refDoc, BONES);
const restPose = poseAt(skel, null, 0);
const restW = fk(skel, restPose);
const REST_FOOT = { foot_l: posOf(restW.foot_l).y, foot_r: posOf(restW.foot_r).y, ball_l: posOf(restW.ball_l).y, ball_r: posOf(restW.ball_r).y };

/** frames: array of pose objects (bone -> {t, r}) sampled at times[] */
async function framesFor(spec) {
  const frames = [];
  const times = [];
  if (spec.segments) {
    const total = Math.max(...spec.segments.map((s) => s.at + s.len));
    const N = Math.round(total * FPS);
    const clips = await Promise.all(spec.segments.map(clipOf));
    for (let i = 0; i <= N; i++) {
      const T = (total * i) / N;
      let k = spec.segments.findIndex((s) => T >= s.at - 1e-9 && T <= s.at + s.len + 1e-9);
      if (k < 0) k = spec.segments.length - 1;
      const s = spec.segments[k];
      const u = Math.min(1, Math.max(0, (T - s.at) / s.len));
      frames.push(poseAt(skel, clips[k], s.from + (s.to - s.from) * u));
      times.push(T);
    }
    return { frames, times };
  }
  if (spec.legs) {
    const legs = await clipOf(spec.legs);
    const upper = await clipOf(spec.upper);
    const dur = legs.duration;
    const N = Math.round(dur * FPS);
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = poseAt(skel, legs, u * dur);
      const b = poseAt(skel, upper, u * upper.duration);
      const p = {};
      for (const bn of BONES) p[bn] = LEGS.has(bn) ? a[bn] : b[bn];
      frames.push(p);
      times.push(u * dur);
    }
    return { frames, times };
  }
  const c = await clipOf(spec.src);
  const from = spec.src.from ?? 0;
  const to = spec.src.to ?? c.duration;
  const dur = to - from;
  const N = Math.max(1, Math.round(dur * FPS));
  for (let i = 0; i <= N; i++) {
    const t = from + (dur * i) / N;
    frames.push(poseAt(skel, c, t));
    times.push((dur * i) / N);
  }
  return { frames, times };
}

function pinFeet(frames) {
  // Lower the pelvis so the lowest foot point never rises above its rest height (root space is Z-up: world y = root z).
  for (const p of frames) {
    const w = fk(skel, p);
    const lift = Math.min(...Object.entries(REST_FOOT).map(([b, y0]) => posOf(w[b]).y - y0));
    if (lift > 0) p.pelvis.t = [p.pelvis.t[0], p.pelvis.t[1], p.pelvis.t[2] - lift];
  }
}

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('mascot');
const made = new Map();
const top = doc.createNode('mascot_rig');
scene.addChild(top);
for (const b of skel) {
  const n = doc.createNode(b.name).setTranslation(b.t).setRotation(b.r);
  made.set(b.name, n);
  (b.parent ? made.get(b.parent) : top).addChild(n);
}

const inputs = new Map();
function inputAccessor(times) {
  const key = times.map((t) => t.toFixed(4)).join(',');
  if (!inputs.has(key)) inputs.set(key, doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer));
  return inputs.get(key);
}

const stats = [];
for (const spec of CLIPS) {
  const { frames, times } = await framesFor(spec);
  if (spec.pin) pinFeet(frames);
  // root: no motion at all (in place); pelvis: horizontal drift over a loop removed
  if (spec.loop) {
    const a = frames[0].pelvis.t;
    const b = frames[frames.length - 1].pelvis.t;
    const n = frames.length - 1;
    frames.forEach((p, i) => {
      const k = i / n;
      p.pelvis.t = [p.pelvis.t[0] - (b[0] - a[0]) * k, p.pelvis.t[1] - (b[1] - a[1]) * k, p.pelvis.t[2]];
    });
  }
  const anim = doc.createAnimation(spec.out);
  let keys = 0;
  for (const b of skel) {
    if (b.name === 'root') continue;
    const tracks = [['rotation', 4]];
    if (b.name === 'pelvis') tracks.push(['translation', 3]);
    for (const [pathName, size] of tracks) {
      let values = frames.flatMap((p) => (size === 4 ? p[b.name].r : p[b.name].t));
      if (size === 4) values = continuous(values);
      const r = reduce(times, values, size);
      keys += r.times.length;
      const input = inputAccessor(r.times);
      let output;
      if (size === 4) {
        const q = new Int16Array(r.values.length);
        for (let i = 0; i < q.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, r.values[i])) * 32767);
        output = doc.createAccessor().setType('VEC4').setArray(q).setNormalized(true).setBuffer(buffer);
      } else output = doc.createAccessor().setType('VEC3').setArray(new Float32Array(r.values)).setBuffer(buffer);
      const s = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(made.get(b.name)).setTargetPath(pathName).setSampler(s));
    }
  }
  stats.push(`${spec.out.padEnd(10)} ${times[times.length - 1].toFixed(3)}s ${frames.length} frames -> ${keys} keys`);
}

doc.createExtension(KHRMeshQuantization).setRequired(true);
await MeshoptEncoder.ready;
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const nio = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await nio.write(OUT, doc);
const size = fs.statSync(OUT).size;
console.log(`${CLIPS.length} clips, ${skel.length} bones, ${inputs.size} key-time arrays -> ${path.relative(repo, OUT)} (${(size / 1024).toFixed(1)} KB)`);
if (process.argv.includes('-v')) console.log(stats.join('\n'));
