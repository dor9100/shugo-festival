// Screenshot + perf script for the world preview (not part of the app bundle).
// Usage (from repo root, with `npx vite --port 5174 --strictPort` running):
//   node client/src/world/tools/shoot.mjs [--headed] [--only=name,name] [--perf] [--url=http://localhost:5174/world-preview.html]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const URL = args.url || 'http://localhost:5174/world-preview.html';
const OUT = path.resolve(args.out || 'research/screens');
fs.mkdirSync(OUT, { recursive: true });
const only = args.only ? String(args.only).split(',') : null;
const W = Number(args.w || 1920);
const Hh = Number(args.h || 1080);

const gpuArgs = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'];
if (args.uncapped) gpuArgs.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ headless: !args.headed, args: gpuArgs });
const page = await browser.newPage({ viewport: { width: W, height: Hh }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const q = args.quality ? `&quality=${args.quality}` : '';
await page.goto(`${URL}?shot=1&auto=0${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__previewReady === true, null, { timeout: 30000 });
const gpu = await page.evaluate(() => window.__preview.gpu);
console.log('GPU:', gpu);
const P = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => {
  if (only && !only.includes(name)) return;
  const f = path.join(OUT, `world-${name}.png`);
  await page.screenshot({ path: f });
  console.log('saved', f);
};
const want = (name) => !only || only.includes(name);

await page.evaluate(() => window.__preview.ready());
await wait(500);

// ---------------------------------------------------------------- v2 set: GAME's camera (pitch 33, dist 15, FOV 56)
if (args.set === 'v2') {
  const prefix = 'v2-';
  const vshot = async (name) => {
    const f = path.join(OUT, `world-${prefix}${name}.png`);
    await page.screenshot({ path: f });
    console.log('saved', f);
  };
  const setup = async (fn) =>
    P((src) => {
      const p = window.__preview;
      p.pause(false);
      p.clear();
      p.freeze(true);
      for (const b of p.bots) b.fearUntil = b.immuneUntil = 0;
      p.placeBot(0, 0.2, -2.2, 0);
      p.placeBot(1, -2.6, 0.9, 0.5);
      p.placeBot(2, 2.9, 1.6, -0.4);
      p.placeBot(3, -1.0, 3.6, 0.2);
      p.placeBot(4, 1.7, -4.2, 2.8);
      p.placeBot(5, -4.4, -2.5, 1.2);
      p.setView('v2');
      new Function('p', src)(p);
    }, fn);
  // pause when predicate(p) becomes true (evaluated every frame in the page)
  const pauseWhen = (src) =>
    page.waitForFunction((code) => {
      const p = window.__preview;
      if (new Function('p', code)(p)) {
        p.pause(true);
        return true;
      }
      return false;
    }, src);
    const want2 = (n) => !only || only.includes(n);
  if (want2('overview')) {
    await setup("p.trigger('showcase'); p.trigger('line:slow'); p._t = p.now();");
    await pauseWhen('return p.now() - p._t > 2600;');
    await vshot('overview');
  }
  if (want2('square')) {
    await setup("p.trigger('square:fast'); p._t = p.now();");
    await pauseWhen('return p.now() - p._t > 1500;');
    await vshot('square');
  }
  if (want2('slow-cross')) {
    await setup("p.trigger('cross:slow'); p._t = p.now();");
    await pauseWhen('return p.now() - p._t > 2700;');
    await vshot('slow-cross');
  }
  if (want2('balloons')) {
    await setup("p.trigger('showcase'); p.trigger('greens'); p.trigger('pink'); p._t = p.now();");
    await pauseWhen('return p.now() - p._t > 900;');
    await vshot('balloons');
  }
  if (want2('bomb')) {
    await setup("p.trigger('bombs-wave'); p._t = p.now();");
    await pauseWhen('return p.now() - p._t > 2750;');
    await vshot('bomb');
  }
  if (want2('explosion')) {
    await P(() => window.__preview.pause(false));
    await pauseWhen('const b = p.views.bombs.booms; return b.length > 0 && b[0].t >= 0.1;');
    await vshot('explosion');
    await P(() => window.__preview.pause(false));
    await pauseWhen('const b = p.views.bombs.booms; return b.length > 0 && b[0].t >= 0.7;');
    await vshot('smoke');
  }
  await P(() => {
    window.__preview.pause(false);
    window.__preview.freeze(false);
  });
}

const classic = args.set !== 'v2';
if (classic && want('overview')) {
  await P(() => {
    const p = window.__preview;
    p.setView('overview');
    p.trigger('line');
  });
  await wait(1900);
  await P(() => window.__preview.trigger('greens'));
  await wait(700);
  await shot('overview');
}
if (classic && want('balloons')) {
  await P(() => {
    const p = window.__preview;
    p.clear();
    p.freeze(true);
    p.placeBot(0, 3.5, -1.5, -0.6);
    p.placeBot(1, -3.5, 1.5, 0.4);
    p.placeBot(2, 3.0, 2.5, 0);
    p.placeBot(3, -3.0, 3.0, 0);
    p.placeBot(4, 0.5, 3.5, 0);
    p.placeBot(5, -1.5, 4.5, 0);
    p.setView('balloons');
    p.trigger('showcase');
  });
  await wait(1200);
  await shot('balloons');
  await P(() => {
    window.__preview.clear();
    window.__preview.freeze(false);
  });
}
if (classic && want('ref')) {
  await P(() => {
    const p = window.__preview;
    p.clear();
    p.setView('ref');
    p.trigger('cross');
  });
  await wait(1500);
  await P(() => window.__preview.trigger('greens'));
  await wait(500);
  await shot('ref');
}
if (classic && want('game')) {
  await P(() => window.__preview.setView('game'));
  await wait(300);
  await shot('game');
}
if (classic && want('square')) {
  await P(() => {
    const p = window.__preview;
    p.clear();
    p.setView('overview');
    p.trigger('square');
    p.trigger('pink');
  });
  await wait(1350);
  await shot('square');
}
if (classic && want('cross')) {
  await P(() => {
    const p = window.__preview;
    p.clear();
    p.setView('overview');
    p.trigger('cross');
  });
  await wait(2300);
  await shot('cross');
}
if (classic && want('low')) {
  await P(() => {
    const p = window.__preview;
    p.clear();
    p.setView('low');
    p.trigger('lines');
    p.trigger('greens');
  });
  await wait(1700);
  await shot('low');
}
if (classic && want('bomb')) {
  await P(() => {
    const p = window.__preview;
    p.clear();
    p.freeze(true);
    p.placeBot(0, 1.8, -2.2, 0.3);
    p.placeBot(1, -1.5, 0.8, 2.6);
    p.placeBot(2, 4.5, 3.0, 0);
    p.placeBot(3, -4.0, -3.5, 0);
    p.placeBot(4, 0.2, 2.0, 3.1);
    p.placeBot(5, -4.5, 4.0, 0);
    p.setView('overview');
    p.trigger('bomb-center');
  });
  // pause the world ~2.75 s into the 3.3 s fuse: pillar visible, disc nearly full
  await page.waitForFunction(() => {
    const p = window.__preview;
    const b = [...p.views.bombs.live.values()][0];
    if (b && p.now() - b.b.at >= 2750) {
      p.pause(true);
      return true;
    }
    return false;
  });
  await wait(100);
  await shot('bomb');
  await P(() => window.__preview.pause(false));
}
if (classic && want('explosion')) {
  if (!want('bomb')) {
    await P(() => {
      const p = window.__preview;
      p.clear();
      p.setView('overview');
      p.trigger('bomb-center');
    });
  }
  await P(() => window.__preview.freeze(false));
  // pause ~90 ms into the explosion (screenshots take ~300 ms, so freeze the world first)
  await page.waitForFunction(() => {
    const p = window.__preview;
    const b = p.views.bombs.booms;
    if (b.length > 0 && b[0].t >= 0.09) {
      p.pause(true);
      return true;
    }
    return false;
  });
  await wait(100);
  await shot('explosion');
  await P(() => window.__preview.pause(false));
}
if (classic && want('mascot')) {
  await P(() => {
    const p = window.__preview;
    p.clear();
    p.freeze(true);
    for (const b of p.bots) b.fearUntil = b.immuneUntil = 0;
    p.placeBot(0, 0, -3, 0);
    p.setView('mascot');
  });
  await wait(1800);
  await shot('mascot');
  await P(() => window.__preview.freeze(false));
}
if (classic && want('npc')) {
  await P(() => window.__preview.setView('corner'));
  await wait(500);
  await shot('npc');
}
if (classic && want('top')) {
  await P(() => window.__preview.setView('top'));
  await wait(500);
  await shot('top');
}

if (args.perf) {
  await P(() => {
    const p = window.__preview;
    p.clear();
    p.setView('overview');
    p.auto(true);
  });
  await wait(4000);
  const r = await P(() => window.__preview.measure(5000));
  console.log('PERF', JSON.stringify(r));
}

console.log('console problems:', logs.length ? '\n' + logs.join('\n') : 'none');
await browser.close();
