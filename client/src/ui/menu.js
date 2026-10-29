// Main menu (before joining a room): name, Create room, Join with code, Solo practice, detected mode.
import { h } from './dom.js';
import { muteButton } from './hud.js';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LEN } from '@shared/config.js';

const MODE_TEXT = {
  p2p: 'Online mode: P2P (peer-to-peer, the host’s browser runs the room)',
  server: 'Online mode: Server',
  solo: 'Solo practice only',
};

export class MainMenu {
  constructor(root, { name, code, forcedMode, onCreate, onJoin, onSolo, onToggleMute }) {
    this.nameIn = h('input.field', { type: 'text', maxlength: '16', placeholder: 'Your name', value: name || '', autocomplete: 'nickname', spellcheck: 'false' });
    this.codeIn = h('input.field.code-field', {
      type: 'text',
      maxlength: String(ROOM_CODE_LEN),
      placeholder: 'CODE',
      value: code || '',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Room code',
    });
    this.codeIn.addEventListener('input', () => {
      const v = this.codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v !== this.codeIn.value) this.codeIn.value = v;
      this.err('');
    });
    this.nameIn.addEventListener('input', () => this.err(''));
    this.createBtn = h('button.btn.btn-gold.btn-wide', { type: 'button', text: 'Create room' });
    this.joinBtn = h('button.btn.btn-teal', { type: 'button', text: 'Join' });
    this.soloBtn = h('button.btn.btn-wide', { type: 'button', text: 'Solo practice' });
    this.errEl = h('div.menu-error', { role: 'alert' });
    this.modeEl = h('div.menu-mode', { text: forcedMode ? `${MODE_TEXT[forcedMode] || forcedMode} (forced by ?mode=)` : 'Detecting online mode…' });
    this.mute = muteButton(onToggleMute);

    const run = async (fn) => {
      const nm = this.name();
      if (!nm) {
        this.err('Please enter a name.');
        this.nameIn.focus();
        return;
      }
      this.busy(true);
      try {
        await fn(nm);
      } catch (e) {
        this.err(e?.message || String(e));
      } finally {
        this.busy(false);
      }
    };
    this.createBtn.addEventListener('click', () => run((nm) => onCreate(nm)));
    this.soloBtn.addEventListener('click', () => run((nm) => onSolo(nm)));
    const join = () =>
      run(async (nm) => {
        const c = this.codeIn.value.trim().toUpperCase();
        if (c.length !== ROOM_CODE_LEN || [...c].some((ch) => !ROOM_CODE_ALPHABET.includes(ch))) {
          this.codeIn.focus();
          throw new Error(`Enter the ${ROOM_CODE_LEN}-character room code from your friend.`);
        }
        await onJoin(c, nm);
      });
    this.joinBtn.addEventListener('click', join);
    this.codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    this.nameIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (this.codeIn.value) join();
      else this.createBtn.click();
    });

    this.el = h(
      'div.menu-overlay',
      {},
      h(
        'div.menu-card',
        {},
        h('div.menu-topbar', {}, this.mute),
        h('div.menu-kicker', { text: 'Festival mini-game · practice arena' }),
        h('h1.menu-title', {}, h('span.mt-a', { text: 'Shugo Festival' }), h('span.mt-dash', { text: ' — ' }), h('span.mt-b', { text: 'Jump Jump' })),
        h('p.menu-tag', { text: 'Grab the balloons, jump the lasers, dodge the bombs. Most points in 2:45 wins.' }),
        h('label.menu-label', { text: 'Name' }),
        this.nameIn,
        h('div.menu-actions', {}, this.createBtn),
        h('div.menu-or', {}, h('span', { text: 'or join a friend' })),
        h('div.join-row', {}, this.codeIn, this.joinBtn),
        h('div.menu-or', {}, h('span', { text: 'or' })),
        this.soloBtn,
        this.errEl,
        this.modeEl,
        h('div.menu-controls', { text: 'WASD move · Space jump · drag to orbit · wheel zoom · Tab scores · Esc menu · M mute' }),
      ),
    );
    root.append(this.el);
  }

  name() {
    return this.nameIn.value.trim().slice(0, 16);
  }

  setMode(mode) {
    this.modeEl.textContent = MODE_TEXT[mode] || `Online mode: ${mode}`;
  }

  setMuted(m) {
    this.mute.setMuted(m);
  }

  focusJoin() {
    this.codeIn.focus();
    this.joinBtn.classList.add('attention');
  }

  focusName() {
    this.nameIn.focus();
  }

  busy(on) {
    for (const b of [this.createBtn, this.joinBtn, this.soloBtn]) b.disabled = on;
    this.el.classList.toggle('busy', on);
  }

  err(msg) {
    this.errEl.textContent = msg || '';
    this.errEl.classList.toggle('show', !!msg);
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
  }
}
