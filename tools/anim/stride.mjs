#!/usr/bin/env node
// Planted-foot backward speed of in-place loops (full-size rig, rate 1): the speed the ground must move for the
// feet not to slide. Per foot: frames whose ball height is in the lowest 20% (critic metric) and a stricter
// "within 8 mm of the minimum" contact window. Usage: node tools/anim/stride.mjs [clipRegex]
import { readDoc, readSkeleton, readClips, poseAt, fk, posOf } from './lib.mjs';
const file = new URL('../../client/public/models/mascot-anims.glb', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const doc = await readDoc(file);
const names = doc.getRoot().listNodes().map((n) => n.getName()).filter((n) => n !== 'mascot_rig');
const skel = readSkeleton(doc, names);
const re = new RegExp(process.argv[2] || '^(run|run_back|strafe_l|strafe_r|fear|sprint)$');
for (const [name, clip] of readClips(doc)) {
  if (!re.test(name)) continue;
  const N = 240;
  const out = [];
  for (const foot of ['ball_l', 'ball_r']) {
    const s = [];
    for (let i = 0; i <= N; i++) {
      const t = (clip.duration * i) / N;
      s.push({ t, p: posOf(fk(skel, poseAt(skel, clip, t))[foot]) });
    }
    const v = [];
    for (let i = 1; i <= N; i++) v.push({ y: s[i].p.y, sp: Math.hypot(s[i].p.x - s[i - 1].p.x, s[i].p.z - s[i - 1].p.z) / (s[i].t - s[i - 1].t) });
    const sorted = [...v].sort((a, b) => a.y - b.y);
    const low20 = sorted.slice(0, Math.round(v.length * 0.2));
    const minY = sorted[0].y;
    const strict = v.filter((q) => q.y < minY + 0.008);
    const avg = (a) => a.reduce((x, q) => x + q.sp, 0) / a.length;
    out.push(`${foot}: low20 ${avg(low20).toFixed(2)} m/s, strict ${avg(strict).toFixed(2)} m/s (${((strict.length / v.length) * 100).toFixed(0)}% contact)`);
  }
  console.log(name.padEnd(9), clip.duration.toFixed(3) + 's', out.join(' | '));
}
