# Wiki World — prototype handoff

**Date:** 2026-08-31; art, lighting, colour, traffic and shading passes all
2026-09-01
**Status:** art, lighting and shading are done and hand-tuned; a per-element
detail pass against the user's mockup crops (2026-09-01) has covered the
entrance, the hub, LINKS, READ, EDIT and ARCHIVE. See §3.1 for what changed in
each and, more usefully, for the half-dozen rules that pass produced — several
of them cost two or three wrong attempts to find. Everything is **still
unstaged**; `git status` is the only trace of this feature.

**Route:** `/world` — an isometric room-scale companion to `/sky`
**Reference art:** `~/Downloads/ebbebea6-c72a-4693-8807-d23206ddcd03.png` — the
image every art decision below is measured against. Open it before touching the
palette or the lighting.

Resume from this file after a context clear. It carries everything needed to
continue cold.

---

## 1. What this is

A second visualisation of the same archive event stream that drives `/sky`.
Instead of particle fields, agents are blocky avatars walking between rooms of an
office: READ, EDIT, LINKS, ARCHIVE, plus an open HUB plaza and an entrance.

Every avatar on screen is replaying a real session from `archive_events`. Each
step corresponds to one recorded event — nothing is simulated or invented.

Target look: an isometric voxel "video game screen" (concept image supplied by
the user, Minecraft-ish office). Decision taken: **full realtime three.js**, not
a pre-rendered backdrop. Bottleneck confirmed to be asset production, not
rendering.

---

## 2. Files added (all untracked)

```
apps/web/lib/world/layout.ts            floor plan, seats, waypoint graph, BFS, wall check
apps/web/lib/world/choreography.ts      archive_events → per-agent task queues (pure, no THREE)
apps/web/components/world/voxel.ts      voxel model compiler with face culling
apps/web/components/world/vox.ts        MagicaVoxel .vox parser -> VoxelModel
apps/web/components/world/build.ts      box kit: merged geometry, 3 material channels
apps/web/components/world/furniture.ts  ~25 procedural box props
apps/web/components/world/textures.ts   canvas signage, floor tiling, carpet
apps/web/components/world/props.ts      authored voxel models (ARMCHAIR, BOOKSHELF)
apps/web/components/world/avatar.ts     two-segment-leg rig + procedural animation clips
apps/web/components/world/environment.ts  static set dressing
apps/web/components/world/visual.ts      VISUAL_CONFIG: every lighting knob, one place
apps/web/components/world/tune-panel.ts  slider panel, shown only on ?tune=1
apps/web/components/world/world-canvas.tsx  scene, actor scheduler, DOM overlay
apps/web/app/world/page.tsx             page, HUD, SSE wiring
apps/web/test/world-choreography.test.ts   choreography + layout tests
apps/web/test/world-voxel.test.ts          voxel compiler tests
apps/web/test/world-vox.test.ts             .vox parser tests
docs/plans/2026-08-31-wiki-world-prototype.md   this file
```

`three@0.185.1` and `@playwright/test` were already dependencies; nothing was
installed.

The `/world` feature itself modified no existing file. The security fixes in §6
did, and they are the only tracked files this work touches:

```
apps/web/lib/http/handlers.ts           + handleRecordEvent, behind admitWrite
apps/web/app/api/v1/events/route.ts     POST thinned onto that handler
apps/web/test/api/routes.test.ts        + 4 tests for the telemetry gate
apps/web/.env.local                     DATABASE_URL now the scratch DB (gitignored)
apps/web/.env.production.local          the Neon URL, new file (gitignored)
```

---

## 3. Architecture

```
archive_events (Postgres)
  → GET /api/v1/events  +  SSE /api/v1/events/stream  +  ntfy.sh topic
    → buildAgentPlans()        [choreography.ts — pure, tested]
      → Actor scheduler         [world-canvas.tsx]
        → findPath() waypoints  [layout.ts — pure, tested]
          → poseAvatar()        [avatar.ts]
```

### Event → room mapping

The single source of truth is `BEHAVIOUR` in `choreography.ts`. It covers every
value of the `archive_events.event_type` check constraint
(`packages/db/src/schema/index.ts:379`):

| Event | Room | Action |
|---|---|---|
| `agent_session_started` | hub | idle |
| `article_opened` | read | read |
| `article_created` | edit | type (+ hub crystal pulse) |
| `article_revised` | edit | type |
| `wikilinks_created` | links | browse |
| `contribution_aborted` | archive | sort |
| `agent_session_ended` | entrance | leave |

### Key design decisions

- **The pure layer has no THREE import.** `choreography.ts` and `layout.ts` are
  testable in isolation. This mirrors the repo's own hexagonal style.
- **Rooms sit at the four cardinal offsets from the hub**, not on the diagonals.
  READ is at -X, EDIT at -Z, LINKS at +Z, ARCHIVE at +X. Under a 45° isometric
  camera that is what lands them in the four corners of the frame with the hub
  between them; the original diagonal plan stacked them along the screen axes
  instead. This is the single change that most altered how the shot reads.
- **A room is closed on the sides whose inner face the camera can see** and
  glazed on the rest. Only +X and +Z normals face a (1, 1, 1) camera, so that
  rule alone decides where the bookshelves, the whiteboard, the wall screen and
  the archive shelving go — and it is why ARCHIVE, nearest the camera, carries
  its shelving on an inner wall.
- **Navigation is a hand-authored waypoint graph + BFS**, not A*. Twelve nodes.
- **The plaza itself carries no planters.** Two used to flank the plinth; with
  the four corridor pairs behind them the middle of the shot was more hedge than
  floor. Removing an obstacle only ever loosens the walk graph, so the route
  tests are unaffected.
- **Props that stand near a route are declared in `layout.ts`, not in the set
  dressing.** `OBSTACLES` carries a footprint per planter, crate stack and low
  table, `environment.ts` places them from that list, and the tests prove no leg
  of any route — including the last one, out to a seat — passes within an
  avatar's width of one. A prop the graph does not know about is a prop avatars
  walk through, which is exactly what a planter on the EDIT corridor and a stack
  of crates in ARCHIVE's doorway were doing.
- **Crowds are kept apart by lanes, not by collision response alone.** Each actor
  takes a lateral offset from `LANES` as it spawns and walks its own line down a
  shared corridor. Without it several actors aim at the *same* waypoint, are
  pushed apart by the separation pass, and are therefore pushed off the very
  point each is trying to reach: the whole group locks up in the middle of the
  plaza. Three rules follow, and all three are needed:
  1. separation only pushes *across* an actor's heading, never back along it;
  2. an actor within 1.6 units of its target is committed and is not pushed at
     all, so it always finishes the walk into its seat;
  3. a leg also ends when the actor is carried past the waypoint, or after
     `STUCK_SECONDS` of being shoved without getting closer — corridor
     waypoints only, because giving up on a seat leaves an avatar acting out
     its task in the middle of the floor.
- **Walls are avoided by construction, not collision detection.** Each room
  declares its `doorways` sides; `segmentCrossesWall()` resolves which face a
  segment actually crosses and the test suite proves every route uses a doorway.
- **Two geometry paths.** `voxel.ts` compiles character-layer models, which pays
  off for the armchair and the bookshelf; everything rectilinear is boxes from
  `build.ts`, because a desk written as character layers is unreadable. The box
  kit bakes a per-normal shade into the vertex colours, which is what separates
  the blocks without a post pass.
- **Three material channels** — lit, unlit and glass — so the whole set is a few
  dozen draw calls. Signs use the unlit channel to hold their flat poster colour.
- **Signage and floor tiling are canvas textures.** Glyphs and a fine grid are
  the two things geometry cannot express cheaply.
- **The regular cast's colours are named, not hashed.** `agentHue` still hashes
  onto a ring of separated stops, but the cast that actually turns up is four
  names, and the hash happened to drop Claude, DeepSeek and Gemini within sixty
  degrees of each other — three avatars that read as the same character. No hash
  fixes that; `NAMED_AGENT_HUES` keys off `displayAgentName`, so every user agent
  string that resolves to one model gets that model's colour, and the hash is
  left to serve everyone else. Claude is the Claude Code mascot's orange (hue
  18). A test holds the four at least thirty degrees apart.
- **Avatars are chibi, not correctly proportioned.** The head is a full third of
  the height and the limbs are slim and short. The reference's own eight-unit
  block figure was tried and rejected: at this camera distance an avatar is
  barely a hundred pixels tall, and a correct figure reads as lanky. The face is
  an 8×8 canvas painted on the head's -Z side alone.
- **The key light's azimuth is the single most consequential value in the set.**
  It sat at 57° against a camera at 45°. Twelve degrees apart is a frontal
  light: the +X and +Z faces of a box — the only two sides this camera can see —
  came back with almost the same N·L (0.505 against 0.328), and every shadow
  fell directly behind the prop casting it, where nothing could see it. At 70°
  those two faces open to about 2.7:1 and the shadows lie across the frame. This
  is what a screenshot reads as "flat", and no amount of contrast or saturation
  substitutes for it. `FACE_SHADE` was never the problem: it is *aligned* with
  the sun (+X 0.90 over -X 0.78, +Z 0.82 over -Z 0.72), so it reinforced the key
  rather than fighting it.
- **The pool of light is a second, shadowless spot, not a spot in place of the
  key.** A `DirectionalLight` has no falloff to give — parallel, infinite rays
  are exactly what make its shadows read as dimetric — so making the key itself
  a `SpotLight` would fan every shadow out radially from one point and lose
  that. Instead a shadowless spot shares the key's axis: it shades the same
  faces, the key keeps the shadows, and the frame gets brighter over the hub and
  dimmer towards its edges. Its decay is 0, so the whole gradient comes from the
  cone rather than from distance — with distance falloff on, a set 120 units
  across lit from 78 away goes dark at the far corners by *range*, which is a
  different effect. It is also not a vignette: the bright point is where the
  key's axis meets the floor, so swinging the azimuth moves the pool with the
  light instead of leaving it pinned to the middle of the screen.
- **The four room lights were the second flattener.** At intensity 16–34 with
  decay 2, the hub crystal alone delivers more light at three units than the sun
  does — and being omnidirectional and shadowless, it lifts every face of every
  prop by the same amount, filling in exactly the corners the AO pass exists to
  darken. They now run at `roomLightScale` 0.55 of their authored intensity, and
  the ambient and hemisphere came down with them (0.72/0.16 → 0.50/0.10).
  (The committed defaults now hold the balance the user tuned by hand on
  2026-09-01, which puts the room lights back up at 1.5 and the key down at
  1.1, with the pool narrowed to a 16° cone over the plaza — the finding
  stands, the taste is theirs.)
- **Every lighting value lives in `visual.ts`, and `?tune=1` puts sliders on it.**
  Finding this balance by eye takes minutes; finding it by editing three files
  and reloading takes hours. Runtime values (exposure, intensities, AO, bloom,
  saturation) apply on the next frame. The two build-time values — `faceShade`
  and `faceShadeStrength` — are baked into vertex colours, so their slider bumps
  a token in `world-canvas.tsx`'s effect dependency and the scene recompiles.
  Each row carries a `↺` that returns just that value to
  `VISUAL_DEFAULTS`, lit when the value is off its default and dim when it is â
  so the panel also reads as a diff of what has been touched. This is not the
  reference's controls panel: it is hidden unless asked for by name, and every
  control on it does something.
- **Saturation is a display-space pass, and it is last and small.** Reaching for
  saturation before the lighting is right buys brighter carpets and no extra
  volume. It sits after `OutputPass` at 1.08.
- **Bloom is threshold 0.9, strength 0.22.** Before the tone map, where the
  crystal and the screens are still above 1 and the white walls are not.
- **Shading is direct light + screen-space AO, not direct light alone.** The set
  is all coplanar boxes meeting at right angles, so a directional light gives
  the junctions nothing: the crease where a wall meets the floor, the underside
  of a desk and the inside of a shelf all came out at the brightness of the open
  floor, which is what read as "flat". A `GTAOPass` between the render and the
  tone map puts the contact shading back. It costs the ambient budget: hemisphere
  and ambient had to come *down* (0.95/0.22 → 0.68/0.14) for the AO to be
  visible at all, and back up again once the shelves went too dark.
- **The reading pose holds a book, and it is held nearly flat.** A book tipped up
  towards its reader's face turns edge-on under a 30° camera and reads as a red
  stick; at `rotation.x` 0.35 the pages face the shot. It hangs off the torso
  rather than a hand, because the read pose is static.
- **The VSM blur radius came down from 7 to 5.** VSM's variance bound bleeds
  light as the blur grows, and that bleed lands hardest exactly where depth
  varies most — under a desk, under a chair, along the wall-to-floor crease.
  Those are the contact shadows the set was missing. The AO pass picked up the
  difference (blend 0.7 → 0.95, radius 1.1 → 1.3). Switching to PCF, which is
  the obvious-looking fix, would put the razor edge back: see below.
- **Shadow softness is bought with resolution, not radius.** The shadow map is
  1792, not 3072: VSM blurs the map, so the penumbra a given `radius` buys is
  measured in texels and fewer texels over the same shadow camera is what makes
  the blur wide in world units. Pushing `radius` instead washes the shadow out —
  VSM's variance bound bleeds light as the blur grows, and at radius 9 over a
  3072 map the props cast nothing at all.
- **Shadows are VSM, not PCF.** PCF's penumbra is capped by the shadow-map texel
  size, so a 4096 map over this set gave a razor edge; variance shadow maps store
  depth moments, which lets `shadow.radius` blur the map itself. Two things had
  to follow: the map dropped to 3072 (the blur, not the resolution, is what sets
  the softness) and the shadow camera widened to ±58, because a VSM blur that
  runs off the edge of the shadow camera smears into grey streaks at the frame
  edges rather than simply stopping.
- **Every neutral in the set is a warm grey.** The sky fill, the corridor tile,
  the walls, the outer floors and the sheet behind the building were all cool
  greys, and a hundred cool greys read as a colour cast that no amount of warm
  sun can cancel — the frame came out cold however warm the key light was. They
  are warm greys now and the only cool light left is the low back fill, which is
  what keeps the shadows blue against a warm floor.
- **The palette is sampled from the reference, and the woods run lighter than
  they look.** Every box face is already multiplied by a per-normal shade and
  then again by AO, so a hex picked straight off the reference lands two steps
  too dark on screen; `PALETTE.wood` is a full stop lighter than the tone it is
  meant to read as.
- **The glass is tinted, and the floor sits below the walls.** Both were tuned by
  screenshot. Glass at 0.22 opacity read as an open gap and the rooms lost their
  edges; past ~0.4 the panes go milky and swallow what is behind them, so it
  sits at 0.32 over a bluer `PALETTE.glass`. The corridor tile was the brightest
  thing in the frame — it is a step down in value now, with the hub, entrance
  and archive carpets following it down.
- **The face smiles.** The mouth's corner pixels sit one row *above* its middle.
  They started one row below, which reads as a frown at every camera distance.
- **Each room has its own colour of light.** Four shadowless point lights — the
  reading lamp, the hub crystal, the LINKS wall screen, the EDIT monitors — sit
  just off the prop they belong to. This is most of what separates the reference
  from a uniformly lit model, and it is cheap: no second shadow map.
- **Materials are `MeshStandardMaterial`, not Lambert.** Lambert has no response
  worth the name to the point lights above, and the glass partitions needed
  `MeshPhysicalMaterial` reflectance to keep an edge against a pale wall.
- **Both geometry paths emit UVs measured in blocks**, so one shared grain
  texture lands at the same density on a keyboard and on a reception counter.
  The texture is the block: a bevel dark on the -U/-V edges and light on the
  others, plus a speckle. The lip is three pixels of sixty-four because a block
  is only ~20 screen pixels wide here and a hairline vanishes.
- **The camera is 2:1 dimetric, not true isometric.** Elevation 30°, azimuth 45°:
  with that pair a floor axis draws at screen slope sin(30°) = 0.5, the two-
  across-one-down staircase the reference tiles follow. True isometric would be
  35.26° and visibly steeper.

### Rotation convention (easy to get wrong — was wrong once)

The avatar faces **-Z**, and a limb hangs along **-Y**, so a **positive**
`rotation.x` swings it **forward**. Using negative values folds a seated figure
backwards through its own chair. Documented in the `poseAvatar` docblock.

`SEAT_HEIGHT = 0.58` in `avatar.ts` must stay equal to
`4 * ARMCHAIR.voxelSize` in `props.ts`. A test asserts this.

---

## 3.1 The mockup detail pass (2026-09-01)

The user supplied one cropped screenshot of the reference per room and asked for
each to be matched, keeping decisions already made (extra seats stay, the HUD
log stays). What follows is the residue worth carrying forward.

### Rules that cost more than one attempt to find

- **Unlit colours are crushed hard by the tone map. Author them about two stops
  light.** READ's poster is authored `0x3f9455` and lands on screen at
  `0x004505`; the plaque frame is authored `0x878d95` to read as the `0x323a47`
  charcoal the reference draws. Guessing at this twice looked like "the edit did
  nothing" — sample the pixels instead of eyeballing it.
- **A plaque frame has to be unlit.** Lit, the only side of it this camera sees
  is the one the key never reaches, and between the hemisphere falloff and the
  AO in the crease against the wall it comes back near black *at any colour*.
  Lightening it from `ink` to `0x8b929b` changed nothing at all.
- **`placeText` defaults to `#e6e3db`, deliberately under the 0.9 bloom
  threshold.** White is luminance 1.0 and blooms, and a haloed caption reads as
  a smear at this camera distance. Pass `#ffffff` explicitly only where the
  bloom is wanted — the LINKS screen glyphs do, which is also why they are pure
  white rather than a tasteful off-white.
- **Which way is screen left depends on the prop's rotation, and it flips.**
  For the entrance's `CAMERA_FACING` props, local **+X renders screen left**.
  For a `-Math.PI / 2` prop like the LINKS screen, local **+X is screen left**
  too, but for the `Math.PI` walls (EDIT, READ, ARCHIVE) it is **-X**. Both got
  placed backwards once. Check with a screenshot before committing to a side.
- **Hang room point lights high and run them bright, not low and dim.** With
  decay 2 the ratio between what a prop gets and what an avatar's crown gets is
  set by the ratio of their distances, so a lamp just above head height blows
  the head out at any intensity that still reaches the shelving. ARCHIVE's went
  through 2.8 → 3.4 → 5.2 before landing at **y 8.0, intensity 30**, where the
  two distances are within a fifth of each other. The user confirmed this one
  by watching an agent walk in.
- **1 world unit ≈ 24 px vertically at 1600x900.** Needed whenever a sign near
  the frame edge moves. READ's plaque top now sits 11 px inside the frame; a
  probe at +1.0 clipped it entirely.

### What changed, room by room

- **Entrance.** Reception rebuilt: stone plinth and end piers under a wood
  counter, stepped board corners, and a monitor, card terminal and intercom on
  the top. `plantTall` got stone planters and larger foliage.
- **Hub.** The stepped dais became a stone basin with corner shrubs and a lit
  floor tile. A voxel-mosaic crystal shell with WIKI/W lettering was tried and
  **rejected** — the crystal keeps its glass shell and pulsing core, seated in
  the basin. Do not re-propose the mosaic.
- **LINKS.** Floor stays weave but goes pale sea-green (`0x74a9a1`); a tiled
  floor was tried and **rejected**. The wall screen is now a lit cyan panel with
  a title tab top-left and text runs down both margins. Workstation moved under
  the screen. A lounge corner (`loungeChair`, `loungeTable`) and `shelfBoxes`
  fill the +X half — clear of every route by construction, not by `OBSTACLES`,
  since the doorway legs all run down the -X side to the seats. This was checked
  before placing them and should be rechecked if they move.
- **READ.** `BOOKSHELF` rewritten with a dark back board and a gapped top row
  per bay, so the spines run at mixed heights instead of reading as a painted
  panel. `lampTable` became a side cabinet with an open bay of books — sides,
  back and base only, since a solid carcass buries them — turned by `Math.PI` so
  the bay faces the camera. The back wall lost its `windowWall` (the glazing
  bays read as blank pictures) and carries one enlarged `KNOWLEDGE IS POWER`
  frame, widened to 4.4 because `placeText` sizes its plane from the canvas
  aspect and the type was overrunning the mount.
- **EDIT.** Cork board removed, `archiveShelf(2,2)` replaced by a `BOOKSHELF`
  voxel, plaque moved along -X to clear the roster HUD. The monitor screen is a
  light page (`0xf2fbff`, blue title strip, dark type), not a dark terminal.
- **ARCHIVE.** Its joinery runs a whole stop lighter than the rest of the set
  (`PALETTE.archiveWood`, `archiveWoodShade`, lighter `card`). Colour alone was
  not enough — the case wall faces +Z, which the key at azimuth 70 barely
  grazes — so the room needed a light of its own. `archiveShelf` was rebuilt at
  depth 1.2 with an oversailing cornice and plinth: at 0.5 it stood 0.1 proud of
  the plaster and read as a carved relief. The floor is `createParquetTexture`,
  four staggered courses in a deliberately narrow band of tan (a wider spread
  turns into a chequerboard, which is how the LINKS tile attempt failed).

### Elsewhere

- **Plaque walls.** `addWall` takes an optional height, and each plaque wall
  runs taller than the 4.2 standard so the plaque clears what is under it:
  `LINKS_WALL_HEIGHT` 6.4, `READ_WALL_HEIGHT` 5.6, `EDIT_WALL_HEIGHT` 6.0,
  `ARCHIVE_WALL_HEIGHT` 6.6. READ's is capped by the frame edge, not by taste.
- **`roomSign` takes an optional `height`** (default 2.5) so a plaque can shrink
  without shrinking its lettering, which is a separate canvas texture.
- **The open rooms carry no floor of their own.** `addCarpet` runs only for
  `!room.open`, so the plaza and the entrance sit on the concourse tiling; slabs
  under them read as rugs nobody laid.
- **Foliage was warmed** from around hue 95 to hue 85 (`PALETTE.leaf`,
  `leafDark`, and the hedge greens).
- **Lighting values the user set by hand:** `saturation` 0.9, `keyIntensity`
  1.4, `keyAzimuthDeg` 70, `keyElevationDeg` 50, `shadowRadius` 8.25,
  `keySpotAngleDeg` 10. Azimuth 70 and elevation 50 were each moved and then
  moved back by the user — leave them alone without being asked.

## 4. How to run

The production Neon database must **not** be used for this work — see §6.

```sh
# One-time: scratch database on the local postgres@14 (already created as
# wiki_world_proto; recreate with `createdb wiki_world_proto` if missing)
DATABASE_URL="postgresql://massimo@localhost:5432/wiki_world_proto" pnpm migrate

# Dev server on 3100 (port 3000 is occupied by an unrelated Vite app).
# `.env.local` now names the scratch database, so no inline DATABASE_URL is
# needed — see §6.
PORT=3100 pnpm dev
```

Then open <http://localhost:3100/world>.

The scratch DB already holds 17 synthetic events across 4 sessions (`demo-s1`
… `demo-s4`, agents Claude / ChatGPT / DeepSeek / Gemini), inserted directly
into `archive_events` with `article_id NULL` and titles in `safe_metadata`. No
fake articles were created.

### Verification

```sh
pnpm lint                                    # clean
pnpm --filter @agent-memory-wiki/web typecheck   # clean
npx vitest run --project web                 # 18 files, 106 tests passing
```

### Screenshots

The Chrome extension was not connected; screenshots were taken with Playwright.
Throwaway scripts were used and deleted. To redo, write a script under
`apps/web/` (so `@playwright/test` resolves) launching chromium with
`args: ["--use-gl=angle", "--enable-unsafe-swiftshader"]`, goto
`http://localhost:3100/world`, wait ~10s for agents to be seated, screenshot.
Navigate with `waitUntil: "domcontentloaded"` — the SSE stream never closes, so
`networkidle` just times out. READ is empty for most of a replay loop; to catch
an avatar seated with its book, shoot a burst of frames ~10-35s in and diff them
against the first.

The detail pass ran this loop dozens of times, and it is worth reusing verbatim:

```js
// apps/web/.shot.tmp.mjs — write, run with `node .shot.tmp.mjs`, then delete
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3100/world", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(13000);
await page.screenshot({ path: process.env.OUT, clip: { x: 1000, y: 330, width: 600, height: 400 } });
await browser.close();
```

Two things that save time. **Give it ~13s**, not 10: below that the dev server
is sometimes still compiling and the shot shows the *previous* build, which
looks exactly like an edit that did nothing. And **read the pixels rather than
the picture** when a colour is in question —
`Image.open(p).convert("RGB").getpixel((x, y))` in a throwaway python heredoc
settled several "did that change anything?" questions that eyeballing did not.
Room crops used through the pass, at 1600x900 before `deviceScaleFactor`:
READ `x 120 y 0 w 640 h 360`, LINKS `x 100 y 340 w 620 h 420`,
EDIT `x 880 y 0 w 720 h 380`, ARCHIVE `x 1000 y 330 w 600 h 400`,
hub `x 620 y 180 w 460 h 360`, entrance `x 480 y 620 w 700 h 280`.

---

## 5. Known rough edges (ordered by value)

1. **Speech bubbles overlap** when two agents share a room. Offset the bubble's
   screen Y by the actor's seat index. Still the top of the list — the avatars
   themselves no longer overlap, but their captions do.
2. **No real occlusion.** Walls are open towards the camera so it does not show.
3. **The `● LIVE` badge never returns to `○ REPLAY`** once the first SSE event
   arrives.
4. The replay loops the archive so the room is never empty between live events.
5. `articleCountRef` in `world-canvas.tsx` is assigned but not yet consumed.
6. **The EDIT whiteboard sits behind the roster HUD.** The EDIT plaque was
   moved along -X to clear it; the whiteboard at x 6.4 still is not. Fixing it
   means the same -X move, or moving the HUD. The user has not raised it.
7. Signs near the frame edge are placed against a 16:9 window. READ's plaque
   has 11 px of headroom there and less at taller aspects; it is the one sign
   that cannot go higher.
8. The reference's controls panel (WASD / Interact / Open Page / Tab / Esc) is
   deliberately **not** drawn: nothing on the page is interactive, and a panel
   promising input the page does not accept would be a lie. Decided 2026-09-01.
9. The bottom-left activity log is deliberately **kept**, though the reference
   has nothing there — it is where the article titles and the live feed show.
   Speech bubbles also kept their captions for the same reason.
10. Only walkers are separated from each other; two actors standing still are
   left alone, which is safe because seats are reserved one per actor.
11. The lane an actor takes is handed out by spawn order, not by where it is
   going, so two agents walking opposite ways down one corridor can still draw
   the same lane and have to slide past each other.

## 6. Findings from the surrounding codebase (both now fixed)

Both were discovered while working on `/world`; both were fixed on 2026-09-01.

**`apps/web/.env.local` pointed at the production Neon database**, so a plain
`pnpm dev` on this machine wrote to the live archive — which is why all the
prototype work ran against a scratch DB with the URL passed inline.

The Neon URL moved to `apps/web/.env.production.local`, which Next loads only
when `NODE_ENV=production`, and `.env.local` now names the scratch database. So
`pnpm dev` is local by default and `pnpm build` / `pnpm start` still reach Neon.
Both files match the `.env.*` rule in `.gitignore`, and Vercel supplies its own
copy from the dashboard, so nothing about deployment changes. `pnpm dev` with no
inline environment now boots on `wiki_world_proto`; the run command in §4 no
longer needs its `DATABASE_URL=` prefix, though it is harmless.

**`POST /api/v1/events` had no authentication, no rate limit and no body bound**,
while `POST /api/v1/articles` two files away was carefully guarded. Anyone who
knew the endpoint could invent sessions, agent names and titles, and they
surfaced verbatim in `/sky`, `/world` and the `/patterns` metrics.

It now goes through `handleRecordEvent` in `lib/http/handlers.ts`, on the same
`admitWrite` gate the article writes use: network rate limit, credential
authentication, per-credential rate limit, and a 32 KiB body bound from
`parseWrite`. **This does not close the endpoint to anonymous callers** — a
request with no `Authorization` header falls back to the `open_public`
credential exactly as a submission does, so it stays anonymous but becomes
rate limited and revocable. Verified against the scratch DB: an anonymous POST
returns 200, and the 60-per-minute network budget first returns 429 on request
60. Four tests in `test/api/routes.test.ts` cover the gate, the anonymous
fallback, the refusal path and the body bound.

`GET /api/v1/events` was left alone: it is a read, already capped at 500 rows
and cached.

**Still open, and deliberately untouched:** `apps/web/.env.local` carries
`CREDENTIAL_HASH_SECRET` **twice, with two different values**. Whichever one
dotenv resolves last is the digest key every credential in that database was
hashed under, so removing the wrong line silently invalidates every credential.
It needs someone who knows which value is live, not a guess.

(Separately, the earlier admin-auth hardening was already committed by the user
as `52e8120`; residual issues noted there: the in-memory login rate limiter
resets on `loginAttempts.clear()` at 500 entries and is per-serverless-instance,
`x-forwarded-for.split(",")[0]` is client-controllable, and sessions have no
revocation because `getSignKey` prefers `CREDENTIAL_HASH_SECRET`.)

---

## 7. Next step

The `.vox` parser (§below), the art pass and the shading pass are all done.
What is left, in rough order:

0. **Ask the user for the next mockup crop.** The detail pass in §3.1 is the
   live thread: they send one crop at a time and the matching room is reworked
   against it. Every room has had one pass; a second pass on any of them is
   theirs to call, not yours to propose.
0b. **Do not re-tune the lighting unprompted.** `VISUAL_CONFIG` holds a balance
   the user set by hand, and they have already reverted two of my changes to it.
   To change it when asked: open `/world?tune=1`, drag, hit `copy config`, paste
   back into `VISUAL_DEFAULTS` in `visual.ts`. Each row's `↺` returns one value
   to its default, and lights up while it is off it.
1. **Bubble offsets**, so two agents in one room do not overlap their captions.
2. **`.vox` assets.** The parser has no callers yet: there are no `.vox` files in
   the repo. Anything authored in MagicaVoxel can now be dropped into
   `apps/web/public/world/` (that directory does not exist yet) and loaded with
   `loadVoxModel`, alongside the box props rather than instead of them.
3. **The `observe_world()` MCP tool** discussed earlier — a read-only tool
   letting agents see who is in which room, which adds emergent social behaviour
   without giving agents a movement verb that would change what the experiment
   measures. If a movement verb is ever added, it should go behind a new
   versioned instruction set (`pilot-v5`) and separate credentials so the corpus
   stays comparable across generations.

### The MagicaVoxel `.vox` parser

`components/world/vox.ts`, 12 tests. `parseVox(buffer, voxelSize)` returns one
`VoxelModel` per model in the file; `parseVoxModel` takes the first;
`loadVoxModel(url, voxelSize)` fetches and parses one. Output goes straight into
`buildVoxelGeometry`.

- **Axis convention.** MagicaVoxel is Z-up with Y running away from the viewer;
  our models are Y-up with Z towards the camera. The mapping is
  `layers[voxZ][sizeY - 1 - voxY][voxX]` — negating one axis rather than
  swapping two, so imported models are not mirrored. A test pins this.
- **Palette characters.** Colour index `i` is encoded as
  `String.fromCharCode(0x41 + i)`, so all 255 indices fit the character-layer
  representation `props.ts` already uses.
- **The `RGBA` chunk is off by one** by design of the format: colour index `i`
  reads entry `i - 1`.
- **The default palette is generated, not tabulated** — a 6×6×6 colour cube with
  black omitted (215 entries) followed by blue, green, red and grey ramps of ten
  (40), giving 255. It only fires for files with no `RGBA` chunk.
- **Scene transforms (`nTRN`/`nGRP`/`nSHP`) are ignored.** A multi-model file
  comes back as models at their own origins.
- Unknown chunks are walked over, not rejected.

---

## 8. Background processes

A `pnpm dev` on port 3100 was left running in this session. After a context
clear it may still be alive — check with `lsof -nP -iTCP:3100 -sTCP:LISTEN`.
Port 3000 belongs to an unrelated Vite app of the user's; do not kill it.
