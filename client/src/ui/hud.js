// In-game HUD: room panel (top-left), rank panel + event tracker (top-right), key hints (right edge),
// red system message (top-center), big center text (countdown / Time!), NPC tip bubble (bottom-center),
// status chips (immunity / fear), hit vignette, fear tint, toasts.
import { h, fmtInt, medal, withRanks } from './dom.js';
import { ICONS, RESEARCHER_SVG } from './icons.js';
import { UI_TIMING } from '../game/tuning.js';
import { toast } from './toast.js';

const MODE_LABEL = { p2p: 'P2P', server: 'Server', solo: 'Solo' };

export function muteButton(onToggle) {
  const b = h('button.icon-btn.mute-btn', { type: 'button', title: 'Mute / unmute (M)', 'aria-label': 'Toggle sound' });
  b.addEventListener('click', onToggle);
  b.setMuted = (m) => {
    b.innerHTML = m ? ICONS.soundOff : ICONS.soundOn;
    b.classList.toggle('is-muted', m);
    b.setAttribute('aria-pressed', String(m));
  };
  return b;
}

export class Hud {
  constructor(root, actions) {
    this.actions = actions;
    this.el = h('div.hud');
    root.append(this.el);

    // ---- top-left room panel
    this.codeEl = h('span.rp-code');
    this.modeEl = h('span.chip');
    this.pingEl = h('span.chip');
    this.countEl = h('span.chip');
    this.mute = muteButton(() => actions.toggleMute());
    const copyBtn = h('button.icon-btn', { type: 'button', title: 'Copy room code', html: ICONS.copy, onclick: () => actions.copyCode() });
    const linkBtn = h('button.icon-btn', { type: 'button', title: 'Copy invite link', html: ICONS.link, onclick: () => actions.copyInvite() });
    this.copyBtns = [copyBtn, linkBtn];
    this.roomPanel = h(
      'div.panel.room-panel.interactive',
      {},
      h('div.room-row', {}, h('span.rp-label', { text: 'Room' }), this.codeEl, copyBtn, linkBtn, this.mute),
      h('div.room-meta', {}, this.modeEl, this.pingEl, this.countEl),
    );

    // ---- top-right rank panel + event tracker
    this.rankOwn = h('div.rank-own');
    this.rankList = h('div.rank-list');
    this.rankEmpty = h('div.rank-empty', { text: 'No Point acquisition information.' });
    this.rankPanel = h(
      'div.panel.rank-panel',
      {},
      h('div.rank-head', {}, h('span', { text: 'Rank' }), h('span.kbd-hint', {}, h('kbd', { text: 'Tab' }), ' View All')),
      this.rankOwn,
      this.rankList,
      this.rankEmpty,
      h('div.rank-foot', { text: 'Displayed when points are acquired' }),
    );
    this.timerEl = h('span.et-time', { text: '02:45' });
    this.tracker = h(
      'div.panel.event-tracker',
      {},
      h('span.et-icon', { html: ICONS.flag }),
      h('span.et-name', { text: 'Jump Jump' }),
      h('span.et-clock', { html: ICONS.clock }),
      this.timerEl,
    );
    this.topRight = h('div.top-right', {}, this.rankPanel, this.tracker);

    // ---- key hints
    const hint = (label, ...keys) => h('div.hint', {}, h('span', { text: label }), h('span.keys', {}, ...keys.map((k) => h('kbd', { text: k }))));
    this.hints = h(
      'div.key-hints',
      {},
      hint('Jump', 'Space'),
      hint('Forward', 'W'),
      hint('Back', 'S'),
      hint('Left', 'A'),
      hint('Right', 'D'),
      hint('Rotate view', 'Q', 'E'),
      hint('Scoreboard', 'Tab'),
      hint('Mute', 'M'),
      hint('Menu', 'Esc'),
    );

    // ---- center / messages
    this.sys = h('div.sys-msg');
    this.big = h('div.big-text');
    this.chips = h('div.status-chips');
    this.immuneChip = h('div.status-chip.immune', {}, h('span.sc-icon', { html: ICONS.shield }), h('span', { text: 'Invincible' }), h('b'));
    this.fearChip = h('div.status-chip.fear', {}, h('span.sc-icon', { html: ICONS.bolt }), h('span', { text: 'Surprised!' }), h('b'));
    this.chips.append(this.immuneChip, this.fearChip);
    this.npcText = h('div.npc-text');
    this.npc = h(
      'div.npc-bubble',
      {},
      h('div.npc-portrait', { html: RESEARCHER_SVG }),
      h('div.npc-body', {}, h('div.npc-name', { text: 'Jump Researcher' }), this.npcText),
    );
    this.vignette = h('div.hit-vignette');
    this.fearTint = h('div.fear-tint');
    this.immuneTint = h('div.immune-tint');

    this.el.append(this.vignette, this.fearTint, this.immuneTint, this.roomPanel, this.topRight, this.hints, this.sys, this.big, this.chips, this.npc);
    this._sysT = 0;
    this._bigT = 0;
    this._npcT = 0;
    this._rankKey = '';
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
  }

  setPhase(phase) {
    this.el.dataset.phase = phase;
  }

  setRoom({ code, mode }) {
    this.codeEl.textContent = code;
    this.modeEl.textContent = MODE_LABEL[mode] || mode;
    this.roomPanel.classList.toggle('solo', mode === 'solo');
  }

  setNet({ ping, players, mode }) {
    this.pingEl.textContent = mode === 'solo' ? 'offline' : `${Math.round(ping || 0)} ms`;
    this.countEl.textContent = `${players} player${players === 1 ? '' : 's'}`;
  }

  setMuted(m) {
    this.mute.setMuted(m);
  }

  /** players: [{id,name,score,scored}] — only players that acquired points this round are listed. */
  renderRank(players, you) {
    const listed = players.filter((p) => p.scored);
    const key = listed.map((p) => `${p.id}:${p.name}:${p.score}`).join('|') + `#${you}`;
    if (key === this._rankKey) return;
    this._rankKey = key;
    const ranked = withRanks(listed);
    const row = (p, own) =>
      h(`div.rank-row${own ? '.own' : ''}${p.id === you ? '.me' : ''}`, {}, medal(p.rank), h('span.rr-name', { text: p.name }), h('span.rr-pts', { text: fmtInt(p.score) }));
    const mine = ranked.find((p) => p.id === you);
    this.rankOwn.replaceChildren(...(mine ? [row(mine, true)] : []));
    this.rankList.replaceChildren(...ranked.map((p) => row(p, false)));
    this.rankEmpty.style.display = ranked.length ? 'none' : '';
  }

  setTimer(text) {
    if (this.timerEl.textContent !== text) this.timerEl.textContent = text;
  }

  sysMessage(text) {
    this.sys.textContent = text;
    this.sys.classList.remove('show');
    void this.sys.offsetWidth; // restart animation
    this.sys.classList.add('show');
    clearTimeout(this._sysT);
    this._sysT = setTimeout(() => this.sys.classList.remove('show'), UI_TIMING.systemMsgMs);
  }

  bigText(text, variant = '', ms = UI_TIMING.bigTextMs) {
    this.big.textContent = text;
    this.big.className = `big-text show ${variant}`;
    void this.big.offsetWidth;
    this.big.classList.add('pop');
    clearTimeout(this._bigT);
    if (ms > 0) this._bigT = setTimeout(() => this.big.classList.remove('show', 'pop'), ms);
  }

  hideBig() {
    clearTimeout(this._bigT);
    this.big.className = 'big-text';
  }

  tip(text, ms = UI_TIMING.npcTipMs) {
    this.npcText.textContent = text;
    this.npc.classList.add('show');
    clearTimeout(this._npcT);
    this._npcT = setTimeout(() => this.npc.classList.remove('show'), ms);
  }

  hideTip() {
    clearTimeout(this._npcT);
    this.npc.classList.remove('show');
  }

  hitPulse() {
    this.vignette.classList.remove('pulse');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('pulse');
  }

  setImmunity(msLeft) {
    const on = msLeft > 0;
    this.immuneChip.classList.toggle('show', on);
    this.immuneTint.classList.toggle('show', on);
    if (on) this.immuneChip.querySelector('b').textContent = `${Math.ceil(msLeft / 1000)}s`;
  }

  setFear(msLeft) {
    const on = msLeft > 0;
    this.fearChip.classList.toggle('show', on);
    this.fearTint.classList.toggle('show', on);
    // like the original badge: 2.3 s of fear reads "2" then "1"
    if (on) this.fearChip.querySelector('b').textContent = String(Math.max(1, Math.floor(msLeft / 1000)));
  }

  toast(text) {
    toast(text);
  }

  dispose() {
    for (const t of [this._sysT, this._bigT, this._npcT]) clearTimeout(t);
    this.el.remove();
  }
}

