// Tiny DOM + formatting helpers shared by the UI modules.

/** h('div.cls1.cls2', {attr|on*|style}, ...children) */
export function h(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

/** ms -> "mm:ss" (ceil to whole seconds, clamped at 0) */
export function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Competition ranking (1,1,3): returns a new array sorted by score desc with `.rank`. */
export function withRanks(list) {
  const sorted = [...list].sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  let prevScore = null;
  let prevRank = 0;
  return sorted.map((p, i) => {
    const rank = p.score === prevScore ? prevRank : i + 1;
    prevScore = p.score;
    prevRank = rank;
    return { ...p, rank };
  });
}

/** Accepts '#rrggbb', 'rgb()', css names or a 0xRRGGBB number. */
export function cssColor(c) {
  if (typeof c === 'number') return `#${c.toString(16).padStart(6, '0')}`;
  return c || '#cccccc';
}

export function medal(rank) {
  const cls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'plain';
  return h(`span.medal.${cls}`, { text: String(rank) });
}

/** Blur buttons after mouse clicks so Space/Enter keep going to the game. */
export function installButtonBlur(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button, select, input[type=range], input[type=checkbox]');
    if (b && e.detail > 0) b.blur();
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts (LAN http)
    const ta = h('textarea', { style: { position: 'fixed', left: '-9999px' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export const ORB_COLORS = { green: '#62f57e', pink: '#ff6fd8', yellow: '#ffd23f' };
export const PENALTY_COLOR = '#ff4a4a';
