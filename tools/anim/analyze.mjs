#!/usr/bin/env node
// Measures candidate clips on the fighter (UE Manny) skeleton: root motion, pelvis drift/height, foot heights,
// planted-foot ground speed (for loops), and per-frame foot/pelvis heights for jumps (--frames).
// Usage: node tools/anim/analyze.mjs <file.glb> [clipRegex] [--frames]
import { readDoc, readSkeleton, readClips, poseAt, fk, posOf } from './lib.mjs';

export const BONES = [
  'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'middle_metacarpal_l', 'middle_01_l', 'middle_02_l', 'middle_03_l', 'thumb_01_l', 'thumb_02_l', 'thumb_03_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'middle_metacarpal_r', 'middle_01_r', 'middle_02_r', 'middle_03_r', 'thumb_01_r', 'thumb_02_r', 'thumb_03_r',
  'neck_01', 'neck_02', 'head', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
];

const [file, re, ...rest] = process.argv.slice(2);
const frames = rest.includes('--frames') || re === '--frames';
const doc = await readDoc(file);
const present = new Set(doc.getRoot().listNodes().map((n) => n.getName()));
const skel = readSkeleton(doc, BONES.filter((b) => present.has(b)));
const clips = readClips(doc);
const rx = re && re !== '--frames' ? new RegExp(re) : null;

const restW = fk(skel, poseAt(skel, null, 0));
const fwd = posOf(restW.ball_l).sub(posOf(restW.foot_l));
console.log(`rest: pelvis y=${posOf(restW.pelvis).y.toFixed(3)} head y=${posOf(restW.head).y.toFixed(3)} ball_l=${posOf(restW.ball_l).toArray().map((v) => v.toFixed(3))} foot->ball dir=${fwd.normalize().toArray().map((v) => v.toFixed(2))}`);

for (const [name, clip] of clips) {
  if (rx && !rx.test(name)) continue;
  const trans = Object.entries(clip.tracks).filter(([, t]) => t.translation).map(([b, t]) => {
    const v = t.translation.values;
    let mx = 0;
    for (let i = 3; i < v.length; i += 3) mx = Math.max(mx, Math.hypot(v[i] - v[0], v[i + 1] - v[1], v[i + 2] - v[2]));
    return `${b}(${mx.toFixed(3)})`;
  }).filter((s) => !s.endsWith('(0.000)'));
  const N = Math.max(2, Math.round(clip.duration * 60));
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const t = (clip.duration * i) / N;
    const w = fk(skel, poseAt(skel, clip, t));
    rows.push({ t, pel: posOf(w.pelvis), bl: posOf(w.ball_l), br: posOf(w.ball_r), fl: posOf(w.foot_l), fr: posOf(w.foot_r), root: posOf(w.root), head: posOf(w.head), hl: posOf(w.hand_l), hr: posOf(w.hand_r) });
  }
  const minY = Math.min(...rows.map((r) => Math.min(r.bl.y, r.br.y, r.fl.y - 0.08, r.fr.y - 0.08)));
  const drift = rows[rows.length - 1].pel.clone().sub(rows[0].pel);
  // planted foot ground speed: foot (ankle) lowest + nearly still vertically
  let sp = 0;
  let cnt = 0;
  for (let i = 1; i < rows.length; i++) {
    for (const k of ['fl', 'fr']) {
      const a = rows[i - 1][k];
      const b = rows[i][k];
      const low = Math.min(rows[i].fl.y, rows[i].fr.y);
      if (b.y <= low + 0.005 && b.y < minY + 0.08 + 0.05) {
        sp += Math.hypot(b.x - a.x, b.z - a.z) / (rows[i].t - rows[i - 1].t);
        cnt++;
      }
    }
  }
  const pelY = rows.map((r) => r.pel.y);
  console.log(
    `${name.padEnd(30)} ${clip.duration.toFixed(2)}s trans=[${trans.join(' ')}] pelY ${Math.min(...pelY).toFixed(3)}..${Math.max(...pelY).toFixed(3)} (t0 ${pelY[0].toFixed(3)}) drift=${drift.toArray().map((v) => v.toFixed(2))} footMinY=${minY.toFixed(3)} plantedSpeed=${cnt ? (sp / cnt).toFixed(2) : '-'}`,
  );
  if (frames) {
    for (const r of rows.filter((_, i) => i % 2 === 0)) {
      console.log(`   t=${r.t.toFixed(3)} pelY=${r.pel.y.toFixed(3)} pelXZ=${r.pel.x.toFixed(2)},${r.pel.z.toFixed(2)} ankL=${r.fl.y.toFixed(3)} ankR=${r.fr.y.toFixed(3)} handL=${r.hl.y.toFixed(2)} handR=${r.hr.y.toFixed(2)} head=${r.head.y.toFixed(2)}`);
    }
  }
}
