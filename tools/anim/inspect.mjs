#!/usr/bin/env node
// Lists skeleton nodes, skins and animation clips (name, duration, channel count) of .glb files
// by parsing the GLB JSON chunk (no deps). Usage: node tools/anim/inspect.mjs file.glb [--nodes] [--filter=regex]
import fs from 'node:fs';

function readGlbJson(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(20);
  fs.readSync(fd, head, 0, 20, 0);
  if (head.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  const jsonLen = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonLen);
  fs.readSync(fd, json, 0, jsonLen, 20);
  fs.closeSync(fd);
  return JSON.parse(json.toString('utf8'));
}

const args = process.argv.slice(2);
const showNodes = args.includes('--nodes');
const filt = args.find((a) => a.startsWith('--filter='));
const re = filt ? new RegExp(filt.slice(9), 'i') : null;
for (const file of args.filter((a) => !a.startsWith('--'))) {
  const g = readGlbJson(file);
  const nodes = g.nodes || [];
  console.log(`\n== ${file}  nodes=${nodes.length} meshes=${(g.meshes || []).length} skins=${(g.skins || []).length} anims=${(g.animations || []).length}`);
  for (const s of g.skins || []) console.log(`  skin ${s.name || ''}: ${s.joints.length} joints: ${s.joints.slice(0, 80).map((j) => nodes[j].name).join(', ')}`);
  if (showNodes) {
    const parent = {};
    nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
    nodes.forEach((n, i) => {
      let d = 0, p = i;
      while (parent[p] !== undefined) { d++; p = parent[p]; }
      console.log(`  ${'  '.repeat(d)}${i} ${n.name} t=${JSON.stringify((n.translation || []).map((v) => +v.toFixed(3)))} s=${JSON.stringify(n.scale || '')}`);
    });
  }
  for (const a of g.animations || []) {
    if (re && !re.test(a.name)) continue;
    let dur = 0;
    const paths = {};
    for (const c of a.channels) {
      const s = a.samplers[c.sampler];
      const acc = g.accessors[s.input];
      if (acc.max) dur = Math.max(dur, acc.max[0]);
      paths[c.target.path] = (paths[c.target.path] || 0) + 1;
    }
    console.log(`  ${a.name.padEnd(36)} ${dur.toFixed(2)}s  ${JSON.stringify(paths)}`);
  }
}
