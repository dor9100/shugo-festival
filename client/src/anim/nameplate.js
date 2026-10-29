// Nameplate (CSS2DObject) for the rigged mascot, per SPEC: title line + name; own player = green title/name plus a
// small red-over-blue bar; fear countdown badge ("2" / "1") under it (the bar turns green while feared).
// Same look as WORLD's mascot nameplate, own CSS prefix so both can coexist.
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const st = document.createElement('style');
  st.id = 'anim-mascot-css';
  st.textContent = `
.am-plate{display:flex;flex-direction:column;align-items:center;gap:1px;pointer-events:none;user-select:none;white-space:nowrap;
  font:600 13px/1.15 system-ui,'Segoe UI',Roboto,sans-serif;color:#fff;
  text-shadow:0 0 2px #000,0 0 3px rgba(0,0,0,.85),0 1px 2px #000;}
.am-title{font-size:11px;font-weight:500;opacity:.92}
.am-title:empty{display:none}
.am-name:empty{display:none}
.am-local .am-name,.am-local .am-title{color:#86ff6e}
.am-npc .am-name,.am-npc .am-title{color:#5ee8d5}
.am-bars{display:none;width:58px;margin-top:2px;padding:1px;background:rgba(0,0,0,.55);border-radius:2px}
.am-local .am-bars{display:block}
.am-hp{height:3px;background:linear-gradient(#ff6b6b,#d0262b);border-radius:1px}
.am-mp{height:2px;margin-top:1px;background:linear-gradient(#78b7ff,#2c66e0);border-radius:1px}
.am-feared .am-hp{background:linear-gradient(#a8ff7a,#38c22e)}
.am-fear{display:none;margin-top:1px;font:900 26px/1 system-ui,'Segoe UI',sans-serif;color:#fff6d8;
  -webkit-text-stroke:1px #5a1030;text-shadow:0 0 6px #ff3aa8,0 0 12px #c01070,0 2px 2px #000}
.am-feared .am-fear{display:block}
`;
  document.head.appendChild(st);
}

export function createNameplate({ name = '', title = '', isLocal = false, npc = false, height = 1.2 } = {}) {
  injectCss();
  const el = document.createElement('div');
  el.className = 'am-plate' + (isLocal ? ' am-local' : '') + (npc ? ' am-npc' : '');
  const titleEl = document.createElement('div');
  titleEl.className = 'am-title';
  titleEl.textContent = title || '';
  const nameEl = document.createElement('div');
  nameEl.className = 'am-name';
  nameEl.textContent = name || '';
  const bars = document.createElement('div');
  bars.className = 'am-bars';
  bars.innerHTML = '<div class="am-hp"></div><div class="am-mp"></div>';
  const fearEl = document.createElement('div');
  fearEl.className = 'am-fear';
  el.append(titleEl, nameEl, bars, fearEl);
  const label = new CSS2DObject(el);
  label.center.set(0.5, 1); // bottom of the plate sits on the anchor
  label.position.set(0, height, 0);
  let fearShown = -1;
  return {
    el,
    label,
    setName: (n) => (nameEl.textContent = n ?? ''),
    setTitle: (t) => (titleEl.textContent = t ?? ''),
    /** seconds left (integer, 0 = hide); DOM writes only on change */
    setFear(n) {
      if (n === fearShown) return;
      fearShown = n;
      fearEl.textContent = n > 0 ? String(n) : '';
      el.classList.toggle('am-feared', n > 0);
    },
    dispose() {
      label.removeFromParent();
      el.remove();
    },
  };
}
