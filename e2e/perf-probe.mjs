// FPS probe: solo round at a given viewport/DPR/quality, uncapped (no vsync). Usage: node e2e/perf-probe.mjs [base]
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:47832/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
async function probe(w, h, dpr, quality) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  await page.addInitScript((q) => localStorage.setItem('jj.settings.v1', JSON.stringify({ quality: q, muted: true })), quality);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.fill('.menu-card input.field:not(.code-field)', 'Perf');
  await page.click('text=Solo practice');
  await page.waitForFunction(() => window.__jj?.game?.players.size > 0);
  await page.click('text=Add bot'); await page.click('text=Add bot'); await page.click('text=Add bot');
  await page.click('text=Start round');
  await page.waitForFunction(() => window.__jj.game.phase === 'playing', null, { timeout: 15000 });
  await page.waitForTimeout(Number(process.env.SETTLE_MS || 1500)); // auto quality settles
  const r = await page.evaluate(() => new Promise((res) => {
    const ts = []; const t0 = performance.now();
    const f = (t) => { ts.push(t); if (t - t0 < 4000) requestAnimationFrame(f); else {
      const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
      res({ level: window.__app?.autoQuality?.level, fps: Math.round((ts.length - 1) / ((ts.at(-1) - ts[0]) / 1000)), p50: d[d.length >> 1].toFixed(1), p95: d[Math.floor(d.length * 0.95)].toFixed(1), canvas: `${document.querySelector('canvas').width}x${document.querySelector('canvas').height}` });
    } };
    requestAnimationFrame(f);
  }));
  const gl = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL).replace(/ \(0x.*$/, ''); });
  console.log(`${w}x${h} dpr${dpr} ${quality.padEnd(6)} -> ${String(r.level).padEnd(6)} canvas ${r.canvas.padEnd(10)} fps ${String(r.fps).padStart(4)}  frame p50 ${r.p50} ms p95 ${r.p95} ms  [${gl}]`);
  await ctx.close();
}
for (const [w, h, dpr, q] of JSON.parse(process.env.CASES || '[[1920,1080,2,"high"],[1920,1080,2,"medium"],[1920,1080,2,"low"],[1920,1080,1,"high"]]')) await probe(w, h, dpr, q);
await browser.close();
