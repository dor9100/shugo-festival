// One global toast line (bottom-center, above the NPC bubble). Used by menu and game.
import { h } from './dom.js';
import { UI_TIMING } from '../game/tuning.js';

let el = null;
let timer = 0;

export function toast(text, ms = UI_TIMING.toastMs) {
  if (!el) {
    el = h('div.toast', { role: 'status', 'aria-live': 'polite' });
    (document.getElementById('ui') || document.body).append(el);
  }
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), ms);
}
