# Sound: NOTES-SOUND

The SOUND agent owns `client/public/sfx/**`, `client/sfx-preview.html` and this file.

All the audio comes from Dor's own game, `fun-game-test/eclipse-tenkahoho/public/audio/**`. Files were only copied out of that repo, never changed. No recorded human voices are used: nothing from `voice/`, `hila/`, `maor/`, `shir/` voices, `boolbooloni/` or `songs/`. Picks were made from three things: how tenkahoho uses each file (its `SOURCES.md`, `src/audio/*Cands.ts`, `docs/MUSIC.md`), the file names, and ffmpeg analysis (duration, loudness, spectrograms). **No one has listened to these yet.** Use the sound board to choose.

## Audition

Run `npx vite --port 5176` from the repo root, then open **http://localhost:5176/sfx-preview.html**.

- Every slot shows its main file and its alternates. Each row has a ▶ button and the source path.
- Music rows also have a **seam** button. It starts playback 4 s before the end so you hear the loop wrap around.
- Press **keep** on the take you like best in each slot, then **Copy picks** and send us the list.

## Slots

LUFS is max momentary loudness for SFX and integrated loudness for music. Source paths are under `eclipse-tenkahoho/public/audio/`.

| Slot | Main file comes from | Why | Length |
|---|---|---|---|
| `jump` | `dorsfx/daniel-wingbeat-1` played 1.4× faster | Dor's wing-swing take. His own note on that file says to speed it up for "small fast wing waves". The result is a soft, quick "fwip" that won't get tiring on the 100th jump. | 0.36 s |
| `land` | `land` | Tenkahoho's own landing sound, a soft low thud. | 0.31 s |
| `pickup_green` | `combat/co-003968` | From the "Top 5 coin sound effects" video: the classic two-note coin "ba-ding". | 0.63 s |
| `pickup_pink` | `chest-reward` (Magic Spells @0:37.8) | Dor picked this for a chest's reward. A bright magic sparkle suits the invincibility balloon. | 1.15 s |
| `pickup_yellow` | `combat/co-003968` a major third higher, plus `storyui/rd-item_coins_03` at −8 dB | The green coin, pitched up, with a coin jingle under it. Same family, richer sound, because yellow is worth the most. | 0.50 s |
| `immune_on` | `skill/ms-062331` | From the Magic Spells pack: a swell rising into a bright burst, like a shield switching on. | 0.76 s |
| `immune_off` | `skill/kn-phaserdown3` | A short falling "bwoo" (Kenney, CC0). Clearly means "power fading". | 0.39 s |
| `laser_spawn` | `skill/lb-002050` (Laser Beam 2) | A sustained energy-beam hum, cut to 1.1 s and kept soft (−20). | 1.10 s |
| `laser_hit` | `thunder-2` plus `combat/kn-impactsoft_medium_001` at −3 dB | Tenkahoho's taser buzz over a soft thump: a zap plus a small "oof". | 0.32 s |
| `bomb_spawn` | `dorsfx/ink-plop` plus `mob-lantern-hiss-1` at −9 dB, starting 80 ms in | A Splatoon ink plop (the bomb lands) with a crackly hiss (the fuse lights). | 0.88 s |
| `bomb_tick` | `story/clock-1`, cut to 0.18 s | Tenkahoho's clock tick: the classic ticking-bomb tick. | 0.18 s |
| `bomb_boom` | `tony-thunder` | This is Eclipse's `bomb_boom.wav` (the for-royi explosion): a real boom with a quick tail. | 1.33 s |
| `fear` | `combat/kn-pepsound3` plus `mob-overdue-pages-1` (a bird flutter) at −4 dB | A cartoon boing-yelp with a wing flutter: panicked scurrying. | 0.67 s |
| `countdown_tick` | `combat/sy-ting-mid` | A clean struck-bell "ting", made in code for tenkahoho, for 3… 2… 1. | 0.45 s |
| `round_start` | `combat/sy-ting-hi` plus `storyui/rd-gong_01` at −4 dB | The countdown bell, pitched higher, over a festival gong: GO! | 1.13 s |
| `round_end` | `quest-end` | Dor's "quest end" chime: one strike and a ring. Reads as "Time!". | 2.20 s |
| `results` | `level-up` | Dor's level-up sound, which he wanted to "feel good": a bright 2 s rise. | 2.05 s |
| `ui_click` | `combat/kn-pluck_001` | A short, soft pluck (Kenney, CC0). | 0.09 s |
| `ui_error` | `combat/kn-twotone1` | Two quick buzzy pulses: "nuh-uh" for "Cannot glide in current state." | 0.14 s |
| `music_lobby` | `music/roam-town-1` from 10.25 s, loop length 58.61 s | Tenka's town theme, "A Hundred Lanterns at Noon": bright Chinese folk, lively but chill. Instrumental, made by Dor with Suno. | 58.6 s |
| `music_round` | `music/battle-vale-day-1` from 2.75 s, loop length 76.59 s | The Vale's day battle theme: bright, heroic and a little playful, about 140 BPM. Instrumental, made by Dor with Suno. | 76.6 s |

Every SFX slot has 3 alternates in `client/public/sfx/alt/<slot>__<n>.mp3`. Each music slot has 1:

- `music_lobby__1`: `roam-isle-1`, Okinawan sanshin, a 55 s loop.
- `music_round__1`: `boss-boolbooloni-1`, a goofy orchestra, a 72.7 s loop.

Each alternate's source and the reason it was offered are in `manifest.json` and on the sound board.

## How to swap a sound

- **Use an alternate:** copy it over the main file. For example, `cp client/public/sfx/alt/jump__2.mp3 client/public/sfx/jump.mp3`. If you want the manifest's `source` and `why` to stay accurate, update the slot's entry too. The game only reads `file`.
- **Use your own file:** drop in `client/public/sfx/<slot>.mp3`. Keep it a mono MP3 at 44.1 kHz, ~128 kbps, about −16 LUFS for short sounds. The game falls back to its synthesized sound when a file is missing or fails to decode.
- **Retune loudness:** each SFX slot's level is listed under `processing` in `manifest.json`. Changing the game's per-play `vol` is usually easier than re-encoding.

## How the files were made

Done with ffmpeg and numpy in a scratch script that is not in the repo. The exact cut, speed and layer settings for every file are under `processing` in `manifest.json`.

**SFX:**

1. Decode to 44.1 kHz mono, then speed change or layering where listed.
2. Remove DC offset.
3. Trim from 2 ms before the first sound to where it falls 50 dB under its peak.
4. Apply a 2 ms fade-in and a cosine fade-out (80 ms, or 0.25–0.8 s where a long sound was cut short).
5. Gain to a max-momentary target: −16 for most slots; −15 for round_start, round_end, laser_hit and yellow; −14 for the boom; −19 to −20 for frequent or soft sounds (jump, land, laser_spawn, bomb_tick, ui_click).
6. Hold true peak at −1 dBTP. The shortest clicks hit this peak limit before their target, so they measure quieter, which is fine for ticks.
7. Encode as 128 kbps MP3.

**Music:**

1. Choose the loop start S and length L by matching the spectrum of the 4 s after S with the 4 s after S+L, then refine the match sample by sample.
2. Mix the 2 s that follow S+L into the start of the loop with an equal-power crossfade, so the wrap from the end back to the start is continuous.
3. Normalize to −22 LUFS integrated and encode as 44.1 kHz stereo 128 kbps MP3.

Chromium's `decodeAudioData` trims the MP3 encoder delay and padding. The decoded lengths match exactly (58.610 s and 76.590 s), so `AudioBufferSourceNode.loop = true` loops without a gap. An `<audio loop>` element would leave a small gap.

**Size:** `client/public/sfx/` is about 5.1 MB. Music is about 4.2 MB of that.

## Integration note for GAME / lead

`client/src/game/audio.js` `loadFiles()` fetches `new URL(manifest[slot], new URL('./sfx/', document.baseURI))`. The manifest uses the requested form `"file": "sfx/<slot>.mp3"`, so that resolves to `sfx/sfx/<slot>.mp3`, gets a 404, and the game falls back to synth for every slot. Either fix works:

- resolve `file` against `document.baseURI` instead of `./sfx/`, or
- strip a leading `sfx/` from `file`.

The SOUND agent does not own `audio.js`, so this needs a change there.

## Licence notes (from tenkahoho's own SOURCES.md)

The user says everything in tenkahoho is free to use. Before a public release, tenkahoho's own docs mark these as needing clearance:

- **Dor's downloads, licence not verified:** coins, Magic Spells, Magic Light, Laser Beam, Splatoon, level-up, quest-end, the Eclipse recordings.
- **Game rips, private use only:** `skill/ls-*` (Lost Ark), `storyui/sb-*` (Stellar Blade), `story/fanfare-*` (Elden Ring). Only some alternates use these: `laser_spawn__2`, `bomb_spawn__3`, `results__3`. No main file does.

These are cleared already:

- `kn-*` (Kenney) and `rd-*` (rubberduck) are CC0.
- `sy-*` and `land` were made in code.
- The music is Dor's own Suno tracks.

## User feedback (2026-10-29)
- No jump or landing sound (removed from the game and the manifest).
- The former `land` sound (`eclipse-tenkahoho/public/audio/land.mp3`) is now every `pickup_*` slot, pitched 1.0 / 1.06 / 1.12 for green / pink / yellow. The previous pickup sounds are kept as `alt/pickup_*__prev.mp3`.
- No bomb sounds (spawn, fuse tick, boom), no fear sound and no laser sounds (spawn, hit). Those slots were removed from the game, the manifest and the files.
