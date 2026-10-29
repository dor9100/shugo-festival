#!/usr/bin/env node
// Compares bone rest transforms (by name) between GLB files: max rotation angle difference and translation diff per bone.
// Usage: node tools/anim/compare-rest.mjs ref.glb other.glb [...]
import fs from 'node:fs';
function readGlbJson(file) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.toString('utf8', 20, 20 + len));
}
const bones = (g) => {
  const m = {};
  for (const n of g.nodes) m[n.name] = { r: n.rotation || [0, 0, 0, 1], t: n.translation || [0, 0, 0] };
  return m;
};
const [ref, ...others] = process.argv.slice(2);
const A = bones(readGlbJson(ref));
for (const f of others) {
  const B = bones(readGlbJson(f));
  let worst = [];
  for (const k of Object.keys(A)) {
    if (!B[k]) continue;
    const a = A[k].r, b = B[k].r;
    const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    const ang = (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
    const dt = Math.hypot(...A[k].t.map((v, i) => v - B[k].t[i]));
    worst.push([k, ang, dt]);
  }
  worst.sort((x, y) => y[1] - x[1]);
  const missing = Object.keys(A).filter((k) => !B[k]);
  console.log(`${f}: common=${worst.length} missing=${missing.length}  worst rot: ${worst.slice(0, 5).map(([k, a, t]) => `${k} ${a.toFixed(2)}deg dt=${t.toFixed(3)}`).join(' | ')}`);
}
