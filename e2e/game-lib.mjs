// Shared helpers for the GAME agent's Playwright scripts (e2e/game-*.mjs).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SHOTS = `${ROOT}research/screens`;
mkdirSync(SHOTS, { recursive: true });
export const BASE = process.env.BASE_URL || 'http://localhost:47820/';

export async function launch({ headless = process.env.HEADED ? false : true } = {}) {
  const browser = await chromium.launch({
    headless,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  return browser;
}

/** New page with console/pageerror capture. */
export async function openPage(browser, url, { width = 1600, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  return { ctx, page, errors };
}

export async function glInfo(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'no-webgl';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
}

export const shot = (page, name) => page.screenshot({ path: `${SHOTS}/game-${name}.png` });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until fn() (evaluated in page) is truthy. */
export async function waitFor(page, fn, arg, timeout = 15000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 50 });
}

/** Messages the game sent (except 'st'). */
export const sent = (page) => page.evaluate(() => (window.__jj ? window.__jj.sent.map((m) => ({ ...m })) : []));
export const roomNow = (page) => page.evaluate(() => window.__jj.game.session.now());
