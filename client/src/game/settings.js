// Player preferences persisted in localStorage (name, mouse sensitivity, volume, mute, graphics quality).
const KEY = 'jj.settings.v1';
const NAME_KEY = 'jj.name';

// practicePopups: floating +50/-20 score numbers and the red hit vignette (the real game has neither) - default off
const DEFAULTS = { sensitivity: 1, volume: 0.7, musicVolume: 0.5, muted: false, quality: 'high', practicePopups: false };

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota: ignore */
  }
}

export const settings = (() => {
  let stored = {};
  try {
    stored = JSON.parse(read(KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  const s = { ...DEFAULTS, ...stored };
  if (!['high', 'medium', 'low', 'potato'].includes(s.quality)) s.quality = 'high';
  s.sensitivity = Math.min(3, Math.max(0.2, Number(s.sensitivity) || 1));
  s.volume = Math.min(1, Math.max(0, Number(s.volume)));
  if (!Number.isFinite(s.volume)) s.volume = DEFAULTS.volume;
  s.musicVolume = Math.min(1, Math.max(0, Number(s.musicVolume)));
  if (!Number.isFinite(s.musicVolume)) s.musicVolume = DEFAULTS.musicVolume;
  s.muted = !!s.muted;
  s.practicePopups = !!s.practicePopups;
  return s;
})();

const listeners = new Set();

/** Update one or more settings, persist, notify listeners. */
export function setSettings(patch) {
  Object.assign(settings, patch);
  const { sensitivity, volume, musicVolume, muted, quality, practicePopups } = settings;
  write(KEY, JSON.stringify({ sensitivity, volume, musicVolume, muted, quality, practicePopups }));
  for (const fn of listeners) fn(settings, patch);
}

export function onSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadName() {
  return (read(NAME_KEY) || '').slice(0, 16);
}
export function saveName(name) {
  write(NAME_KEY, name);
}
