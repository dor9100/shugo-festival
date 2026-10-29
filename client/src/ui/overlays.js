// In-room overlays: lobby side panel, results screen, Tab scoreboard, Esc menu.
import { h, fmtInt, medal, withRanks, cssColor, mmss } from './dom.js';
import { ICONS } from './icons.js';
import { settings, setSettings } from '../game/settings.js';

// ------------------------------------------------------------------------------------------- Lobby
export class LobbyPanel {
  constructor(root, actions) {
    this.codeEl = h('div.lp-code');
    this.listEl = h('ul.lp-players');
    this.countEl = h('span.lp-count');
    this.startBtn = h('button.btn.btn-gold', { type: 'button', text: 'Start round', onclick: () => actions.start() });
    this.addBot = h('button.btn', { type: 'button', onclick: () => actions.bot(true) }, h('span.btn-icon', { html: ICONS.bot }), 'Add bot');
    this.remBot = h('button.btn', { type: 'button', text: 'Remove bot', onclick: () => actions.bot(false) });
    this.hostBox = h('div.lp-host', {}, this.startBtn, h('div.lp-bots', {}, this.addBot, this.remBot));
    this.waitBox = h('div.lp-wait', {}, h('span.spinner'), 'Waiting for host…');
    this.shareBox = h(
      'div.lp-share',
      {},
      h('button.btn.btn-small', { type: 'button', onclick: () => actions.copyCode() }, h('span.btn-icon', { html: ICONS.copy }), 'Copy code'),
      h('button.btn.btn-small', { type: 'button', onclick: () => actions.copyInvite() }, h('span.btn-icon', { html: ICONS.link }), 'Copy invite link'),
    );
    this.el = h(
      'aside.panel.lobby-panel.interactive',
      {},
      h('div.lp-title', {}, h('span', { text: 'Jump Jump' }), h('span.lp-sub', { text: 'Room lobby' })),
      h('div.lp-label', { text: 'Room code' }),
      this.codeEl,
      this.shareBox,
      h('div.lp-label', {}, 'Players ', this.countEl),
      this.listEl,
      this.hostBox,
      this.waitBox,
      h('p.lp-tip', { text: 'Run around while you wait — WASD to move, Space to jump.' }),
    );
    root.append(this.el);
    this.show(false);
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
  }

  update({ code, mode, players, hostId, you, isHost, maxPlayers }) {
    this.codeEl.textContent = code;
    this.shareBox.style.display = mode === 'solo' ? 'none' : '';
    this.countEl.textContent = `${players.length}/${maxPlayers}`;
    this.listEl.replaceChildren(
      ...players.map((p) =>
        h(
          `li${p.id === you ? '.me' : ''}`,
          {},
          h('span.lp-dot', { style: { background: cssColor(p.color) } }),
          h('span.lp-name', { text: p.name }),
          p.id === you ? h('span.tag.tag-you', { text: 'you' }) : null,
          p.bot ? h('span.tag.tag-bot', { html: ICONS.bot, title: 'Bot' }) : null,
          p.id === hostId ? h('span.tag.tag-host', { html: ICONS.crown, title: 'Host' }) : null,
        ),
      ),
    );
    this.hostBox.style.display = isHost ? '' : 'none';
    this.waitBox.style.display = isHost ? 'none' : '';
    const bots = players.filter((p) => p.bot).length;
    this.remBot.disabled = bots === 0;
    this.addBot.disabled = players.length >= maxPlayers;
  }

  dispose() {
    this.el.remove();
  }
}

// ----------------------------------------------------------------------------------------- Results
export class ResultsScreen {
  constructor(root, actions) {
    this.body = h('tbody');
    this.again = h('button.btn.btn-gold.btn-wide', { type: 'button', text: 'Play again', onclick: () => actions.start() });
    this.back = h('div.res-back');
    this.el = h(
      'div.results-overlay',
      {},
      h(
        'div.results',
        {},
        h('div.res-crest', {}, h('div.crest-ring', {}, h('span', { text: 'JJ' }))),
        h('div.res-title', { text: 'Jump Jump' }),
        h('div.res-orn'),
        h('div.res-sub', { text: 'Event Complete' }),
        h(
          'div.res-panel',
          {},
          h('div.res-head', { text: 'Event Results' }),
          h('table.res-table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Rank' }), h('th', { text: 'Name' }), h('th', { text: 'Points' }))), this.body),
          h('div.res-actions', {}, this.again, this.back),
        ),
      ),
    );
    root.append(this.el);
    this.show(false);
  }

  show(on) {
    this.el.classList.toggle('show', on);
  }

  update({ ranking, you, isHost }) {
    this.body.replaceChildren(
      ...ranking.map((r) =>
        h(
          `tr${r.id === you ? '.me' : ''}`,
          {},
          h('td', {}, medal(r.rank)),
          h('td.res-name', {}, h('span.lp-dot', { style: { background: cssColor(r.color) } }), r.name, r.bot ? h('span.tag.tag-bot', { html: ICONS.bot }) : null),
          h('td.res-pts', { text: fmtInt(r.score) }),
        ),
      ),
    );
    this.again.style.display = isHost ? '' : 'none';
  }

  setBackIn(ms) {
    this.back.textContent = ms > 0 ? `Back to lobby in ${mmss(ms)}` : '';
  }

  dispose() {
    this.el.remove();
  }
}

// -------------------------------------------------------------------------------------- Scoreboard
export class Scoreboard {
  constructor(root) {
    this.body = h('tbody');
    this.el = h(
      'div.panel.scoreboard',
      {},
      h('div.sb-head', {}, h('span', { text: 'Scoreboard' }), h('span.kbd-hint', {}, 'hold ', h('kbd', { text: 'Tab' }))),
      h('table.res-table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Rank' }), h('th', { text: 'Name' }), h('th', { text: 'Points' }))), this.body),
    );
    root.append(this.el);
    this.visible = false;
  }

  show(on) {
    this.visible = on;
    this.el.classList.toggle('show', on);
  }

  update(players, you) {
    const ranked = withRanks(players);
    this.body.replaceChildren(
      ...ranked.map((p) =>
        h(
          `tr${p.id === you ? '.me' : ''}`,
          {},
          h('td', {}, medal(p.rank)),
          h('td.res-name', {}, h('span.lp-dot', { style: { background: cssColor(p.color) } }), p.name, p.bot ? h('span.tag.tag-bot', { html: ICONS.bot }) : null),
          h('td.res-pts', { text: fmtInt(p.score) }),
        ),
      ),
    );
  }

  dispose() {
    this.el.remove();
  }
}

// ---------------------------------------------------------------------------------------- Esc menu
export class EscMenu {
  constructor(root, actions) {
    this.actions = actions;
    const slider = (label, key, min, max, step, fmt) => {
      const out = h('span.val', { text: fmt(settings[key]) });
      const input = h('input', { type: 'range', min, max, step, value: settings[key] });
      input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = fmt(v);
        setSettings({ [key]: v });
      });
      return { row: h('label.setting', {}, h('span', { text: label }), input, out), input, out };
    };
    this.sens = slider('Mouse sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => `${Number(v).toFixed(2)}×`);
    this.vol = slider('Sound effects', 'volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
    this.music = slider('Music', 'musicVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
    this.muteBox = h('input', { type: 'checkbox', checked: settings.muted });
    this.muteBox.addEventListener('change', () => actions.setMuted(this.muteBox.checked));
    this.popups = h('input', { type: 'checkbox', checked: settings.practicePopups });
    this.popups.addEventListener('change', () => setSettings({ practicePopups: this.popups.checked }));
    const QNAME = { high: 'High', medium: 'Medium', low: 'Low', potato: 'Lowest' };
    this.quality = h('select', {}, ...Object.keys(QNAME).map((q) => h('option', { value: q, text: QNAME[q] })));
    this.quality.value = settings.quality;
    this.quality.addEventListener('change', () => actions.setQuality(this.quality.value));
    this.el = h(
      'div.esc-overlay',
      { onclick: (e) => e.target === this.el && this.show(false) },
      h(
        'div.panel.esc-menu.interactive',
        { role: 'dialog', 'aria-label': 'Menu' },
        h('div.esc-head', {}, h('span', { text: 'Menu' }), h('button.icon-btn', { type: 'button', title: 'Close (Esc)', html: ICONS.close, onclick: () => this.show(false) })),
        this.sens.row,
        this.vol.row,
        this.music.row,
        h('label.setting.check', {}, h('span', { text: 'Mute all sound' }), this.muteBox, h('span.val', { text: 'M' })),
        h('label.setting', {}, h('span', { text: 'Graphics quality (max, lowered automatically if FPS drops; F3 shows FPS)' }), this.quality, h('span.val')),
        h('label.setting.check', { title: 'Floating +50 / −20 numbers over heads and a red screen-edge pulse on laser hits. The real game shows neither.' }, h('span', { text: 'Practice popups (score numbers & hit vignette)' }), this.popups, h('span.val')),
        h('div.esc-actions', {}, h('button.btn', { type: 'button', text: 'Resume', onclick: () => this.show(false) }), h('button.btn.btn-danger', { type: 'button', text: 'Leave room', onclick: () => actions.leave() })),
        h('div.esc-controls', { text: 'WASD/arrows move · Space jump · drag (left/right mouse) orbit · wheel zoom · Q/E rotate · Tab scores · M mute' }),
      ),
    );
    root.append(this.el);
    this.visible = false;
  }

  show(on) {
    this.visible = on;
    this.el.classList.toggle('show', on);
    if (on) {
      this.muteBox.checked = settings.muted;
      this.popups.checked = settings.practicePopups;
      this.vol.input.value = settings.volume;
      this.vol.out.textContent = `${Math.round(settings.volume * 100)}%`;
      this.music.input.value = settings.musicVolume;
      this.music.out.textContent = `${Math.round(settings.musicVolume * 100)}%`;
    }
    this.actions.onVisible?.(on);
  }

  toggle() {
    this.show(!this.visible);
  }

  dispose() {
    this.el.remove();
  }
}
