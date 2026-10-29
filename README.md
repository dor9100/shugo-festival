# Shugo Festival — Jump Jump (practice clone)

A multiplayer 3D web clone of Aion 2's Shugo Festival "Jump Jump" minigame, tuned frame by frame against real gameplay
footage so it feels the same: 0.89 s jumps, the same laser hitbox and speed, the same run speed and snappy turning.

- Touch balloons: green **+50**, pink **+60** and 8 s laser invincibility, yellow **+70** (3 spawn with every bomb).
- Jump over the sweeping lasers. Each beam that touches you costs **−20**.
- Bombs fill their circle for 3.3 s, then explode and make everyone inside run in fear for 2.3 s.
- A round lasts 2:45 and the highest score wins.

## Controls

| Key | Action |
|---|---|
| W A S D / arrows | move (camera-relative) |
| Space | jump |
| Mouse drag (left or right button) | orbit camera |
| Mouse wheel | zoom |
| Q / E | rotate camera |
| Tab (hold) | scoreboard |
| M | mute / unmute (there is also a speaker button) |
| Esc | menu: sensitivity, volumes, graphics quality, leave |

## Play with friends

**Online (no server needed, P2P):** deploy the static build (GitHub Pages workflow included). Open the site,
**Create room**, then send your friend the 5-letter code or the invite link. Your browser hosts the room, so keep your
tab open. If the host leaves, the room ends.

**Local / LAN (Node server)**: runs on port **47820** (override with `PORT=...`):
```bash
npm install
npm run dev            # http://localhost:47820  (also prints LAN URLs your friends on the same network can open)
# or production:
npm run build && npm start
```
On the Node server, rooms live on the server, so the host can leave without ending the room.

**Solo practice:** use the **Solo practice** button and **Add bot** to practice against bots. Works offline.

Force a mode with `?mode=p2p`, `?mode=server` or `?mode=solo`.

## Tuning and assets

- Every gameplay and feel number is in `shared/config.js`, with its source (`research/MECHANICS.md`, `research/FEEL.md`).
- Sounds are in `client/public/sfx/<slot>.mp3`. Audition every slot and its alternates at
  `http://localhost:47820/sfx-preview.html` (dev server), then copy an alternate over the main file to swap it.
- Mascot animation clips are in `client/public/models/mascot-anims.glb` (built by `tools/anim/`). There's a preview at `/anim-preview.html`.
- The 3D world preview is at `/world-preview.html`.

## Tests

```bash
npm test                         # unit + server integration + browser (solo/server/P2P) tests
node e2e/feel-measure.mjs        # measures jump/run/turn feel of the client (needs a running server, BASE_URL=...)
```

## Layout

`shared/` holds the room rules (`room.js`), the laser schedule and math, bots and config, and runs on the server *and* in the host's
browser. `server/` is the Node http + WebSocket server. `client/src/net/` handles sessions (server / P2P via PeerJS / solo).
`client/src/game/` is the controller, camera, HUD wiring and audio. `client/src/world/` is the arena and effects. `client/src/anim/` is
the rigged mascot. `client/src/ui/` holds the menus and HUD. See `SPEC.md` for the architecture and protocol.

Fan-made practice tool; not affiliated with NCSoft. All art is procedural/original.
