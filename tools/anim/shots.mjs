#!/usr/bin/env node
// Screenshots + perf of client/anim-preview.html with Playwright (GPU chromium).
// Needs the dev server: npx vite --port 5177 --strictPort   (from the repo root)
// Usage: node tools/anim/shots.mjs [shot ...] [--perf] [--headed] [--out=research/screens] [--wait=1500]
//   shot = a demo state name (idle, run, back, "strafe L", jump, fear, hit, immune, cheer, clap, jazz, victory, wave, runner),
//          "overview", "arena", or name@dist,pitch,yaw  (e.g. run@2.4,10,90 for a side view)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const OUT = path.resolve(repo, opt('out', 'research/screens'));
const WAIT = +opt('wait', 1500);
const BASE = opt('base', 'http://localhost:5177');
const shots = args.filter((a) => !a.startsWith('--'));
fs.mkdirSync(OUT, { recursive: true });

const gpuArgs = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
if (args.includes('--uncapped')) gpuArgs.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
async function launch(headless) {
  const browser = await chromium.launch({ headless, args: gpuArgs });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return { browser, page, errors };
}

async function open(page, query) {
  await page.goto(`${BASE}/anim-preview.html${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__anim && window.__anim.me.m.ready, null, { timeout: 30000 });
}

let headless = !args.includes('--headed');
let { browser, page, errors } = await launch(headless);
await open(page, '?shot=overview');
let gl = await page.evaluate(() => window.__anim.glInfo());
console.log('WebGL renderer:', gl);
if (/swiftshader|software|llvmpipe/i.test(gl) && headless) {
  console.log('software GL in headless -> relaunching headed');
  await browser.close();
  headless = false;
  ({ browser, page, errors } = await launch(false));
  await open(page, '?shot=overview');
  gl = await page.evaluate(() => window.__anim.glInfo());
  console.log('WebGL renderer (headed):', gl);
}

for (const s of shots) {
  let [name, cam] = s.split('@');
  let q;
  if (name === 'overview') q = `?shot=overview${cam ? `&dist=${cam}` : ''}`;
  else if (name === 'arena') q = `?arena=1&shot=overview${cam ? `&dist=${cam}` : ''}`;
  else if (name === 'perfview') q = `?perf=1`;
  else if (name === 'game') q = `?cam=game${cam ? `&dist=${cam}` : ''}`;
  else if (name === 'gameperf') q = `?perf=1&cam=game${cam ? `&dist=${cam}` : ''}`;
  else if (name === 'gamearena') q = `?arena=1&cam=game${cam ? `&dist=${cam}` : ''}`;
  else {
    const [dist = 3.2, pitch = 18, yaw = 0] = (cam || '').split(',').filter(Boolean).map(Number);
    q = `?solo=${encodeURIComponent(name)}&shot=${encodeURIComponent(name)}&dist=${dist}&pitch=${pitch}&yaw=${yaw}${opt('extra', '')}`;
  }
  await open(page, q);
  await page.waitForTimeout(WAIT);
  const tag = `${opt('prefix', '')}${name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}${cam && !args.includes('--plain') ? '-' + cam.replace(/[^0-9.-]+/g, '_') : ''}`;
  const STRIP = +opt('strip', 0);
  if (STRIP > 0 && !['overview', 'arena', 'perfview'].includes(name)) {
    // K frames STEP ms apart, cropped around the centre, side by side in one image
    // deterministic: pause the preview and advance the simulation by `step` ms between frames
    const step = +opt('step', 90);
    const crops = [];
    await page.evaluate(() => window.__anim.setPaused(true));
    if (opt('pre', '')) await page.evaluate(opt('pre', ''));
    for (let i = 0; i < STRIP; i++) {
      await page.evaluate((d) => window.__anim.step(d), step / 1000);
      await page.waitForTimeout(60);
      const buf = await page.screenshot({ clip: { x: 440, y: 120, width: 400, height: 480 } });
      crops.push('data:image/png;base64,' + buf.toString('base64'));
    }
    await page.evaluate(() => window.__anim.setPaused(false));
    const sp = await browser.newPage({ viewport: { width: 200 * STRIP, height: 240 } });
    await sp.setContent(`<body style="margin:0;display:flex;background:#000">${crops.map((c) => `<img src="${c}" style="width:200px;height:240px">`).join('')}</body>`);
    const file = path.join(OUT, `anim-${opt('prefix', '') ? '' : 'strip-'}${tag}${opt('prefix', '') ? '-strip' : ''}.png`);
    await sp.screenshot({ path: file });
    await sp.close();
    console.log('strip', path.relative(repo, file));
    continue;
  }
  const file = path.join(OUT, `anim-${tag}.png`);
  await page.screenshot({ path: file });
  console.log('shot', path.relative(repo, file));
}

if (args.includes('--slide')) {
  await open(page, '?solo=runline');
  const r = await page.evaluate(() => window.__anim.measureSlide(180));
  console.log(`SLIDE planted ball speed while running at ${r.ground} m/s: L ${r.ball_l} m/s, R ${r.ball_r} m/s`);
}

if (args.includes('--perf')) {
  await open(page, '?perf=1');
  await page.waitForTimeout(3000);
  await page.evaluate(() => (window.__anim.fps.samples.length = 0));
  await page.waitForTimeout(8000);
  const r = await page.evaluate(() => {
    const s = window.__anim.fps.samples;
    const info = window.__anim.renderer.info;
    const c = window.__anim.cpu;
    return { samples: s.map((x) => +x.toFixed(1)), avg: s.reduce((a, b) => a + b, 0) / s.length, min: Math.min(...s), calls: info.render.calls, tris: info.render.triangles, per: window.__anim.trisPer, anim: c.anim, render: c.render, players: 1 + window.__anim.bots.length, specs: window.__anim.specs.length };
  });
  console.log(`PERF ${r.players} players + ${r.specs} spectators: avg ${r.avg.toFixed(1)} fps, min ${r.min.toFixed(1)}, ${r.calls} draw calls, ${r.tris} tris (${r.per} per mascot), anim update ${r.anim.toFixed(2)} ms/frame, render() call ${r.render.toFixed(2)} ms`, JSON.stringify(r.samples));
  const file = path.join(OUT, 'anim-perf.png');
  await page.screenshot({ path: file });
  console.log('shot', path.relative(repo, file));
}

console.log(errors.length ? `console errors/warnings (${errors.length}):\n  ${[...new Set(errors)].slice(0, 20).join('\n  ')}` : 'no console errors');
await browser.close();
