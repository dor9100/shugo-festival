// Inline SVG icons (no external assets, no emoji).
const svg = (body, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  soundOn: svg('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: svg('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  crown: svg('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="currentColor" stroke-width="1.2"/>'),
  bot: svg('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="currentColor" stroke-width="1.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  shield: svg('<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" fill="currentColor" stroke="none"/>'),
  bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>'),
};

/** Original NPC portrait: a round-eared critter scientist with goggles (no game art reused). */
export const RESEARCHER_SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <radialGradient id="rsF" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#fff8ea"/><stop offset="1" stop-color="#d9c7a6"/></radialGradient>
    <linearGradient id="rsR" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e2574c"/><stop offset="1" stop-color="#9c2f2a"/></linearGradient>
  </defs>
  <path d="M10 64c2-12 10-17 22-17s20 5 22 17z" fill="url(#rsR)"/>
  <path d="M26 47l6 7 6-7" fill="#f6eedb"/>
  <ellipse cx="17" cy="14" rx="6" ry="11" fill="url(#rsF)" transform="rotate(-14 17 14)"/>
  <ellipse cx="47" cy="14" rx="6" ry="11" fill="url(#rsF)" transform="rotate(14 47 14)"/>
  <ellipse cx="17" cy="15" rx="2.6" ry="6.5" fill="#e9a7a0" transform="rotate(-14 17 15)"/>
  <ellipse cx="47" cy="15" rx="2.6" ry="6.5" fill="#e9a7a0" transform="rotate(14 47 15)"/>
  <ellipse cx="32" cy="31" rx="18" ry="16" fill="url(#rsF)"/>
  <path d="M14 24h36" stroke="#3a5560" stroke-width="3"/>
  <circle cx="24.5" cy="24" r="5" fill="#9fe7f0" stroke="#3a5560" stroke-width="2"/>
  <circle cx="39.5" cy="24" r="5" fill="#9fe7f0" stroke="#3a5560" stroke-width="2"/>
  <circle cx="25.5" cy="23" r="1.6" fill="#fff"/><circle cx="40.5" cy="23" r="1.6" fill="#fff"/>
  <circle cx="25" cy="33" r="2.2" fill="#2a2522"/><circle cx="39" cy="33" r="2.2" fill="#2a2522"/>
  <ellipse cx="32" cy="38" rx="2.6" ry="1.9" fill="#5a3b33"/>
  <path d="M29 41q3 2.5 6 0" stroke="#5a3b33" stroke-width="1.4" fill="none"/>
  <ellipse cx="20.5" cy="38.5" rx="3" ry="1.8" fill="#f2a59a" opacity=".6"/>
  <ellipse cx="43.5" cy="38.5" rx="3" ry="1.8" fill="#f2a59a" opacity=".6"/>
</svg>`;
