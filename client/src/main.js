// Entry: builds the world once, shows the main menu, starts/ends Game sessions, runs the render loop.
import './style.css';
import { createRenderer, createArena, Effects, loadMascotAssets } from './game/worldApi.js';
import * as realNet from './net/session.js';
import * as fakeNet from './game/devSession.js';
import { Input } from './game/input.js';
import { OrbitCamera } from './game/camera.js';
import { Game } from './game/game.js';
import { MainMenu } from './ui/menu.js';
import { settings, setSettings, loadName, saveName } from './game/settings.js';
import { audio } from './game/audio.js';
import { toast } from './ui/toast.js';
import { AutoQuality } from './game/autoQuality.js';
import { installButtonBlur } from './ui/dom.js';
import { ROOM_CODE_LEN } from '@shared/config.js';

const params = new URLSearchParams(location.search);
const forcedMode = ['p2p', 'server', 'solo'].includes(params.get('mode')) ? params.get('mode') : undefined;
// ?mode=fake: GAME's scripted in-browser fake session (compressed round; ?fakeRound=<s>&fakeResults=<s>) for UI tests
const net = params.get('mode') === 'fake' ? fakeNet : realNet;
const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LEN);

const worldEl = document.getElementById('world');
const uiEl = document.getElementById('ui');
installButtonBlur(uiEl);

// ---- world (created once, reused across rooms)
loadMascotAssets(); // mascots attach their bodies once the clip GLB is loaded
const view = createRenderer(worldEl);
const autoQuality = new AutoQuality({ apply: (q) => view.setQuality(q), notify: (msg) => toast(msg, 3500), renderer: view.renderer });
autoQuality.reset(settings.quality);
const arena = createArena(view.scene);
const effects = new Effects(view.scene);
const world = { scene: view.scene, camera: view.camera, effects };
const input = new Input(window);
const orbit = new OrbitCamera(view.camera, worldEl);
orbit.auto = 0.06;

let game = null;

function setQuality(q) {
  setSettings({ quality: q });
  autoQuality.reset(q);
}

function toggleMute(force) {
  const muted = typeof force === 'boolean' ? force : !settings.muted;
  setSettings({ muted });
  menu.setMuted(muted);
  game?.hud.setMuted(muted);
  toast(muted ? 'Muted' : 'Sound on');
  if (!muted) {
    audio.unlock();
    audio.play('ui_click');
  }
}

function startGame(session) {
  const invite = net.inviteLink
    ? net.inviteLink(session.code)
    : `${location.origin}${location.pathname}?room=${session.code}${forcedMode ? `&mode=${forcedMode}` : ''}`;
  menu.show(false);
  menu.err('');
  orbit.auto = 0;
  orbit.reset();
  game = new Game({
    world,
    session,
    uiRoot: uiEl,
    input,
    orbit,
    inviteUrl: invite,
    toggleMute,
    setQuality,
    onExit: (msg) => {
      game = null;
      backToMenu(msg);
    },
  });
}

function backToMenu(msg) {
  menu.show(true);
  menu.err(msg || '');
  orbit.auto = 0.06;
  orbit.snapTo({ x: 0, y: 0, z: 0 });
  audio.setMusic('music_lobby');
}

async function enter(promise) {
  const session = await promise;
  if (!session) throw new Error('Could not start the session.');
  startGame(session);
}

const menu = new MainMenu(uiEl, {
  name: loadName(),
  code: roomParam,
  forcedMode,
  onCreate: (name) => {
    saveName(name);
    return enter(net.createRoom({ name, mode: forcedMode }));
  },
  onJoin: (code, name) => {
    saveName(name);
    return enter(net.joinRoom({ code, name, mode: forcedMode }));
  },
  onSolo: (name) => {
    saveName(name);
    return enter(net.createRoom({ name, mode: 'solo' }));
  },
  onToggleMute: () => toggleMute(),
});
menu.setMuted(settings.muted);
audio.setMusic('music_lobby');
if (roomParam) menu.focusJoin();
else if (!loadName()) menu.focusName();
if (!forcedMode) {
  net
    .detectMode()
    .then((m) => menu.setMode(m))
    .catch(() => menu.setMode('p2p'));
}

// ---- main loop
let last = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  autoQuality.frame(t - last, t);
  let dt = (t - last) / 1000;
  last = t;
  if (!(dt > 0)) dt = 0;
  dt = Math.min(dt, 0.05); // clamp: tab switches / hitches never teleport anyone
  try {
    if (game) game.frame(dt);
    else orbit.update(dt, null, 0);
    arena.update(dt, game ? game.session.now() : performance.now());
    effects.update(dt);
    view.render();
  } catch (err) {
    console.error(err);
  }
}
requestAnimationFrame(loop);

function uiScale() {
  const s = Math.min(1.12, Math.max(0.74, Math.min(window.innerWidth / 1500, window.innerHeight / 850)));
  document.documentElement.style.setProperty('--s', s.toFixed(3));
}
uiScale();
window.addEventListener('resize', () => {
  view.resize();
  uiScale();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') last = performance.now();
});

window.__app = { menu, world, orbit, input, audio, autoQuality, get game() { return game; } };
