#!/usr/bin/env node
// Tiles screenshots (centre-cropped) into one labelled contact sheet.
// Usage: node tools/anim/sheet.mjs out.png img1.png img2.png ... [--crop=x,y,w,h] [--cols=4] [--w=320]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] ?? d;
const [out, ...files] = args.filter((a) => !a.startsWith('--'));
const [cx, cy, cw, ch] = opt('crop', '400,110,480,520').split(',').map(Number);
const cols = +opt('cols', 4);
const W = +opt('w', 300);
const H = Math.round((W * ch) / cw);
const imgs = files.map((f) => ({ name: path.basename(f, '.png').replace(/^anim-/, ''), src: 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') }));
const rows = Math.ceil(imgs.length / cols);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: cols * W, height: rows * (H + 18) } });
await p.setContent(`<body style="margin:0;background:#222;font:12px system-ui;color:#fff;display:grid;grid-template-columns:repeat(${cols},${W}px)">${imgs
  .map((i) => `<div><div style="width:${W}px;height:${H}px;background:url(${i.src}) -${(cx * W) / cw}px -${(cy * W) / cw}px / ${(1280 * W) / cw}px auto no-repeat"></div><div style="height:18px;text-align:center">${i.name}</div></div>`)
  .join('')}</body>`);
await p.waitForTimeout(200);
await p.screenshot({ path: out });
await b.close();
console.log('sheet', out);
