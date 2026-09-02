# Wiki World — handoff

**Date:** 2026-08-31; art, lighting, colour, traffic and shading passes all
2026-09-01; shipped 2026-09-01; the human-visitor pass of §10, the portrait
pass, the compaction pass and the set editor also 2026-09-01
**Status:** **in production.** `main` is live at
<https://agent-memory-wiki.vercel.app/world>, linked from the home art entry as
*Visit Wiki World →*. #78–#88 are shipped; §10 below was among them, and every
branch this header used to name is merged.

**§11 shipped in #88** on 2026-09-02 — 19 modified files plus 4 new ones, 213
tests, green on typecheck, `pnpm lint` and `next build`. **Do not open a PR
unprompted; the user calls the deploy.**

Two things in §11 were written from measurements taken **before** that deploy
and are now stale as descriptions of production, though the reasoning still
holds. Production's beacon frame at #87 was `{"title": "Archive Threshold (/)",
"query": "arrived at archive"}` — no `page`, no `country`; that is what §11.8
and §11.9 argue against. From #88 the live frames carry both. **Re-read the
topic before reasoning about what production emits**; do not carry the #87
numbers forward.

**Almost none of §11 was ever seen rendered** — the Chrome extension stayed
disconnected for that session. The scan pose, the shelf stations and every new
caption went to production unlooked-at. Look at `/world` first.

**Route:** `/world` — an isometric room-scale companion to `/sky`
**Reference art:** `~/Downloads/ebbebea6-c72a-4693-8807-d23206ddcd03.png` — the
image every art decision below is measured against. Open it before touching the
palette or the lighting. The user then sent a series of *cropped* references,
one per element; those drove §3.1 and §3.2.

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

## 2. Files added (all shipped in #78)

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

The `/world` feature itself modified one existing file, `apps/web/app/page.tsx`,
to add the home link. The security fixes in §6 modified the rest:

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

## 3.2 The second detail pass (2026-09-01, after §3.1)

Same working method: the user sends one cropped reference at a time and the
matching element is reworked against it. This pass ran after §3.1 and is what
the shipped set looks like.

### Rules this pass produced

- **A texture with a bevelled border, repeated once per box, is a grid.** The
  box kit measures UVs in blocks of a fixed 0.5 world units, and
  `createSurfaceTexture` draws a lip at the tile border. Making that block
  per-prop so one tile covered one 0.28 leaf cube framed every cube, and the
  canopies came back as wire grids. The fix was not a different block size but
  a **fourth material channel**: `kit.leaf` is lit and face-shaded exactly like
  `kit.box`, but its geometry gets `createFoliageTexture` — broad patches, no
  border, one tile per ~1.4 world units. The per-prop block size was reverted.
- **One tile repeated is one tile, whatever noise you paint into it.** The
  corridor floor was a single 128 px maiolica repeated 48×48, so every tile was
  identical by construction and no amount of grain varied it. `createTileTexture`
  now paints a **4×4 block** of tiles, each with its own tint jitter (one in six
  fired a stop off) and its own grain, and divides the caller's `repeat` by the
  grid. The joint still lands on a continuous grid because every tile draws it
  on the same two edges.
- **A lit transparent pane is invisible on a bright set.** The partitions were
  `MeshPhysicalMaterial`, so the pane's colour was `PALETTE.glass` times the
  light on it; standing in the spot's pool, the key blew them to white, and
  white at a third opacity over pale plaster is nothing at all. The glass
  material is now **unlit** `MeshBasicMaterial`, like the `glow` channel, so
  what blends over the room is exactly the authored tint. Two earlier attempts
  — saturating the palette entry, then unshading the glass channel — moved the
  needle without fixing it.
- **The `glass` and `glow` channels are not face-shaded; `box` and `leaf` are.**
  Baked face shading put the four orientations of a pane 0.58 to 0.85 apart
  before a single light was applied, so partitions on one side of a room read
  as glazed and those on another as empty frames. A pane has no lit side.
- **Tone mapping is what keeps signage under the bloom threshold, so lettering
  that must bloom needs `toneMapped: false`.** `placeText` takes a `glow`
  option for this; the hub's `WIKI` and `W` use it. Raising `bloomStrength`
  alone did not do it.
- **`createTextTexture`'s padding and tracking come straight off the glyph
  size.** The hub lettering was illegible at the default 0.5 padding and 0.18
  tracking, not because the plane was small. At `padding: 0.12, tracking: 0.05`
  the same plane carries glyphs 1.5× taller. `padding` was added to
  `TextTextureOptions` for this.
- **A rotating box inside a shell must be narrower than the shell by a factor
  of √2**, or its corners swing out through the glass every quarter turn.

### What changed

- **Corridor floor.** Kept maiolica — a moquette version was tried at the
  user's request and rejected as flat and repetitive. Tiles were made smaller
  (`repeat` 34 → 48), then given the grain and the 4×4 variation above.
- **Plants.** New `plantFicus`: a stone cube planter under a canopy of ~136
  individual 0.28 leaf blocks on a lattice, kept when a **seeded** hash puts
  them inside a soft ellipsoid, so the silhouette frays and every build is
  identical. It replaced `plantTall` inside the four rooms; `plantTall` stays in
  the corridor, the entrance and the outer rooms. `hedgePlanter` was rebuilt the
  same way — a rounded loaf of 0.2 blocks over a trough with a proud rim —
  because its two flat slabs read as a painted wedge. Greens were warmed towards
  yellow twice.
- **Doorway planters.** The four corridor planters ran *perpendicular* to the
  room facades in the middle of the plaza. They now sit parallel to the wall,
  under the glazed panel on either side of the opening, clear of the route
  through it. `OBSTACLES` carries the new footprints and the route tests pass.
- **Hub.** Rebuilt from the reference: `hubMonolith` is a static glass shell
  wired with 12 glowing edge bars, and `hubCrystal` is now only the lit core the
  animation spins and breathes. The mosaic on the faces was deliberately
  skipped — the user called it barely hinted.
- **Entrance stairs removed.** They rose out of the floor, which made no sense;
  a descending version would need a hole in the 140-unit floor plate, which the
  plate does not have. `F.stairs` was deleted with them.
- **READ's poster** ground is now white, and the partition frames were taken
  through anthracite and grey before being **reverted to the original cream**.

---

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

Then open <http://localhost:3100/world>. Production is
<https://agent-memory-wiki.vercel.app/world>, on the live Neon archive.

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
   themselves no longer overlap, but their captions do. Seen again in §10's
   screenshots with two readers in READ, so this is not theoretical.
2. **No real occlusion.** Walls are open towards the camera so it does not show.
3. ~~The `● LIVE` badge never returns to `○ REPLAY`.~~ Fixed in #79; see §9.
   The *other* half of that lie — the SSE backlog — is fixed in §10.
4. ~~The replay loops the archive, so the room is never empty.~~ Still true by
   default, but it is now a switch; see §9.
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

**First: §10 is sitting uncommitted and the user decides when it ships.** Do not
open a PR for it until they ask. Then, in rough order:

0. **Ask the user for the next crop.** Two detail passes have run (§3.1, §3.2);
   both worked the same way — one cropped reference at a time, one element
   reworked against it. A third pass is theirs to call, not yours to propose.
0b. **Do not re-tune the lighting unprompted.** `VISUAL_DEFAULTS` holds a
   balance the user set by hand and has reverted changes to twice. To change it
   when asked: open `/world?tune=1`, drag, hit `copy config`, paste back into
   `VISUAL_DEFAULTS` in `visual.ts`. They have also handed the whole JSON over
   directly, which is the fastest path. Each row's `↺` returns one value to its
   default and lights up while it is off it.
1. ~~**Decide whether browser page views belong on the stage.**~~ Decided: they
   belong, and they are now drawn as people rather than filtered out. See §10.
2. **Bubble offsets**, so two agents in one room do not overlap their captions.
   Still the top of the art list, and §10 made it more visible: a human reader
   now holds their seat for as long as they are reading, so two captions sit on
   top of each other for minutes rather than seconds.
3. **`.vox` assets.** The parser has no callers: there are no `.vox` files in
   the repo. Anything authored in MagicaVoxel can be dropped into
   `apps/web/public/world/` (that directory does not exist yet) and loaded with
   `loadVoxModel`, alongside the box props rather than instead of them.
4. **The `observe_world()` MCP tool** discussed earlier — a read-only tool
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

**A `pnpm dev` is running on port 3100** as of the end of the compaction session
— it was used for every screenshot in that pass and left up. Check with
`lsof -nP -iTCP:3100 -sTCP:LISTEN` before starting another, and kill that pid
rather than starting a second. Port 3000 belongs to an unrelated Vite app of the
user's; do not kill it.

---

## 9. Shipping, and what "live" means (2026-09-01)

### How it was shipped

Two squash merges onto `main`, which is what Vercel deploys to production:

- **#78 `2bf443d`** — the whole feature, the home link, and the `POST
  /api/v1/events` gate from §6.
- **#79 `b719288`** — the live-only stage below.

`main` is protected: it refuses a direct push and requires two status checks, so
this goes through a PR every time. CI is `verify` (~3 min) plus `secrets`;
Vercel builds a preview per PR and production on merge.

### The data is real, and it does not look it

The user asked how to be sure the page was live. Querying production directly
settles it: `GET /api/v1/events?limit=500` returns **172 events across 47
sessions, 21–31 Aug**, with identifiers like `gpt-5.6-luna` (66 events),
`Qwen3.8`, `Grok 4`, `claude-opus-5`, `mistral-medium-3.5`, `Nemotron-3-Ultra`.
Nothing synthetic.

What made it *look* fake was two separate things:

- **A crowd of `Explorer` avatars.** 14 of the 47 sessions carry a browser user
  agent, and `displayAgentName` maps anything with `mozilla`/`chrome`/`safari`
  in it to `Explorer`. They are human page views recorded by the site's own
  telemetry. The next-largest name is `ChatGPT` at 15; everyone else appears
  once or twice. So two names own 29 of 47 actors.
- **The replay looped**, so the same sessions rewalked the same routes forever
  and the badge — which latched on at the first SSE frame and never reset —
  claimed `LIVE` over it.

### The live-only stage

`WorldCanvas` takes a `replay` prop, read through a ref so the switch takes
effect on the next frame without rebuilding the scene. The `● LIVE` badge is now
a statement about the last `LIVE_WINDOW_MS` (120 s) rather than about the whole
session, and it is also the switch: clicking it turns the replay off, leaving
only the avatars a live event put on the floor. `?live=1` opens straight into
that mode. An idle archive then shows an empty floor and the roster reads
`waiting for a live event…`, which is the honest picture.

**To prove liveness by hand:** open `/world?live=1`, then open any article on
the live site in another tab. The visit is recorded as `article_opened`, an
avatar appears, a line lands in the activity log, and the badge goes green for
two minutes.

---

## 10. The human-visitor pass (2026-09-01, uncommitted)

Everything in this section is **in the working tree, not merged**. The user
asked for changes to `/world` and said explicitly: no PR per change, wait until
they call the deploy. Branch `docs/world-handoff`, on top of `28521b9`.

The thread running through it: the archive stream carries two kinds of actor,
and until now the world drew them as one. Agents submit through the API; people
read the wiki in a browser and are recorded by the site's own page telemetry.
Both walk the same floor. Telling them apart, and letting a person behave like a
person, is what this pass is.

### 10.1 A visitor is now one session, not one per page view

The bug, and it was not a timing bug. `broadcaster.ts` did
`sessionId: event.sessionId || randomUUID()`, and every page render called it.
So a reader who opened `/` and then an article produced **two unrelated
sessions**, hence two unrelated avatars: the first entered the hub, said its
line, ran out of tasks and walked straight out — before the visitor had finished
choosing what to read. That is what the user saw when they tested by hand.

`lib/telemetry/visitor.ts` (new) mints the identity:
`visitorSessionId(ip, userAgent, now)` — a salted SHA-256 of the client address,
the user agent and a 30-minute bucket, truncated to 32 hex characters.

The choice was put to the user with three options; they picked this one.

- **No cookie, nothing stored on the device**, so no consent question and no
  middleware. The rejected alternative was a `middleware.ts` setting a session
  cookie: more accurate, survives NAT, but it writes to the visitor's machine.
- **Salted on purpose.** Session identifiers travel over the public event
  stream. An unsalted digest would let anyone confirm that a given address had
  visited. Salt comes from `TELEMETRY_SESSION_SECRET`, else
  `CREDENTIAL_HASH_SECRET`, else a constant — this is a display-grouping
  identifier, not a security boundary, so no new environment variable is
  required.
- **Two accepted costs**, both documented in the module: visitors behind one
  address on the same browser merge into one avatar, and a visit straddling a
  bucket boundary is seen as two. A sliding window needs per-visitor state,
  which is the thing this design exists to avoid.

Wired into all seven client-facing broadcast sites: `/`, `/articles/[slug]`,
`/wanted`, `/skill`, `llms.txt`, `index.md`, `skill/SKILL.md`. Six tests in
`test/telemetry-visitor.test.ts`.

**A second, independent drop was throttling the article.** The broadcaster's
2.5-second cooldown was keyed on the address alone, so opening an article within
2.5 s of the home page had the article silently discarded — the avatar reached
the hub and never walked to READ. The key is now
`${address}:${eventType}:${articleId}`, which is per address *and page*. The
global 6-per-second cap still bounds the total.

### 10.2 People are dressed; agents are one colour

`createAvatar(hue, { human, variant })`. A human gets a flesh head, a coloured
shirt and trousers that do not match; an agent stays monochrome. That contrast
*is* the classification, so it has to survive contact with the palette:

- **Shirts are kept out of the flesh band.** The first attempt included an ochre
  and a warm brick, and a tan shirt under a tan head reads as one bare torso —
  the head stops being a head. The seven shirts are now crimson, blue, green,
  violet, magenta, teal and charcoal: nothing near hue 20–40 at a middling
  saturation.
- **The outfit is picked by session hash, not by agent name.** Every browsing
  human classifies to the same name and therefore the same hue, so the session
  identifier from §10.1 is the *only* thing that separates two readers. Four
  skins × seven shirts × five trousers, each indexed independently
  (`pick(palette, stride)` with strides 1 / 4 / 28), giving 140 outfits.
- **`avatarPalette(hue, style)` is exported** so the HUD paints the same head.
  A roster swatch that disagrees with the avatar it stands for is worse than no
  swatch.
- **Agents in the orange band had to move.** An agent is one hue with the torso
  a couple of stops darker — which in the oranges is exactly skin over a tan
  shirt, and Claude's mascot orange sits in the middle of it. The user sent a
  screenshot; sampling it gave a `#cca06f` head over a `#986c49` torso from an
  authored `hsl(18, 72%, 50%)`, because the tone map lifts and desaturates it.
  Hues **8°–52° now build at `s 0.95, l 0.42`** — same hue, saturated, reads as
  a machine. Outside the band nothing changed: a blue or violet agent was never
  going to be mistaken for a face. *The user asked for exactly this ("aumenta un
  po' la saturazione dell'arancione di Claude"), so it is their call, not a
  taste change to revert.*

### 10.3 Classifying a human, in both shapes the archive holds

`isHumanAgent()` in `choreography.ts`. Two shapes exist and both must pass:
events recorded through the API carry the **raw user agent**, while events the
site broadcasts for its own page views carry the already-classified
**`Human Explorer`**, which contains no browser token at all.

The first version tested for `chrome` / `safari` anywhere in the string and that
was too loose. An `agentIdentifier` on an EDIT event is the *claimed* agent name
from a submission, so any claimed name carrying a browser word would be dressed
as a human — and EDIT is a room no visitor can reach. The rule is now: exactly
`human explorer`, or an identifier **starting with `mozilla/`** that does not
also look like a crawler. Tests cover `Chrome-Assistant/2.1`,
`safari-research-agent`, GPTBot and bingbot.

`displayAgentName` now puts both shapes under one roster name, `Explorer` — it
used to yield `Explorer` for a raw user agent and `Human Explorer` for the
classified one, listing one cast as two.

The user reported seeing a human in EDIT. **It was never reproduced** from local
data: the only human events in the scratch database map to hub and READ, and a
90-second watch of the stage never put an Explorer in EDIT. The loose substring
test above is the one mechanism that could do it, and it is closed. If it turns
up again, that assumption is wrong and the next place to look is whatever event
put them there.

### 10.4 The roster flags them

Humans were always *listed* — a 90-second scrape confirmed it. What was missing
is that nothing said which rows were people: the chip was painted the agent hue,
so a human's row looked like an agent's.

`RosterEntry` now carries `human`, `head` and `shirt`, resolved once at spawn
from `avatarPalette`. The chip is the avatar's real head colour with its shirt
drawn under it as `inset 0 -0.3rem 0`, and the row carries a `HUMAN` tag. It
reads `[▣] Explorer [HUMAN] Reading`.

### 10.5 A live task lasts until the next event

This replaced an earlier, worse shape. The first fix for §10.1 was a 45-second
*linger* bolted on after a task ran out — a wait, not a task. The user then
asked for the right model directly: a reader should stay seated as long as they
are reading, change bubble when they open another article, walk to the hub when
they go home, and leave only after being idle.

So for a **live** actor a task no longer lasts `durationMs`. It lasts **until
the next event**, with `LIVE_IDLE_EXIT_MS` (90 s) as the timeout for the case
where none ever comes — they closed the laptop, or the beacon in §10.6 never
fired. Replayed archive actors are untouched: their sessions are finished, so
their tasks keep their fixed durations. `holdFor(actor, task)` is the one place
that decides.

Three details that are easy to get wrong:

- **Same room means stay in the chair.** If the next event belongs to the room
  the actor is already settled in, `beginNextTask` swaps the caption and returns
  without re-pathing. Standing a reader up to walk a circuit back to the chair
  they are sitting in is the wrong picture of what happened.
- **The caption runs on its own clock** (`bubbleMs`, still the choreography's
  `durationMs`). A speech bubble held up for ninety seconds is a label, not a
  line of dialogue. For replayed actors the two clocks are equal, so nothing
  changes for them.
- **The exit task is exempt from the hold**, or a live actor stands at the
  entrance for ninety seconds instead of despawning.

An earlier iteration of the linger had to carry the *action* forward rather than
dropping to `idle`, because the idle pose stands the avatar up — a reader rose
out of the armchair to wait in it. That trap is gone with the linger, but the
lesson stands if anyone reintroduces a synthetic task.

### 10.6 Leaving the site is detectable; leaving a page already was

The user asked whether a visitor leaving a page can be detected. The answer
splits, and the split is the whole design:

- **Moving between pages of the wiki was already detected**, server-side, and
  needed nothing. Each render broadcasts its own event under the same visit
  identifier, so opening another article just walks the avatar to the next room.
  A client-side Next navigation does not raise `pagehide`, which is exactly the
  behaviour wanted — an internal move is not a departure.
- **Leaving the site is not knowable server-side at all** — no request is made
  when a tab closes — so it takes a beacon from the page.

`components/visit-beacon.tsx` (new) registers `pagehide` and calls
`navigator.sendBeacon("/api/v1/events/leave")`. Mounted on the four page routes:
`/`, `/articles/[slug]`, `/wanted`, `/skill`.

- **`pagehide`, not `visibilitychange`.** Switching tabs hides a page without
  leaving it; reporting that as a departure walks an avatar off the floor every
  time its reader glances elsewhere.
- **`sendBeacon`, not `fetch`.** A request started during unload is cancelled.

`app/api/v1/events/leave/route.ts` (new) **reads no body**. It re-derives the
session from the request's own address and user agent, exactly as the page
render derived it, so a beacon cannot name a session other than its own —
trusting a client-supplied identifier would let anybody walk any avatar off the
floor. It broadcasts `agent_session_ended` and **writes nothing to the archive**:
page views are broadcast, never recorded, and the corpus is what the experiment
measures. Returns 204.

Two guards in the world for it:

- **`LEAVE_GRACE_MS` (8 s).** A reload also raises `pagehide`, followed a moment
  later by the page view for the same visit. Acted on at once, that pair walks
  the avatar to the door and straight back. Any event inside the grace cancels
  the pending exit (`Actor.exitAt`).
- **A departure for someone never on stage is ignored.** Spawning an avatar for
  its own exit puts one at the door for the length of a walk to the same door.

### 10.7 Bug found while verifying: the SSE stream faked liveness

`GET /api/v1/events/stream` replays the last ten archive rows on connect, so a
client has something immediately. `/world` counted them as live: the `● LIVE`
badge went green the instant the page loaded and `?live=1` came up already
populated — over an archive where nothing had happened for hours. This is the
same honesty problem #79 set out to fix, leaking through the backlog.

Backlog frames now carry `historical: true` (a new optional field on `SkyEvent`)
and `/world`'s `ingest` drops them; the archive fetch the page already makes
covers that data. `/sky` is unaffected — it ignores the unknown field. After the
fix `?live=1` opens on an empty floor, which is the honest picture.

### 10.8 ARCHIVE's parquet

Boards and joint down a full stop, `#d9ba90…` → `#a37a51…`, joint `#b0906a` →
`#75543a`; on screen `#c9a37a` → `#986d42`. The narrow tonal band between the
four boards is unchanged — widening it is what turns a parquet into a
chequerboard at this camera distance, which is how the LINKS tile attempt failed
in §3.2.

### What is not tested, and why

The §10.5 and §10.6 world logic lives in `world-canvas.tsx`, a THREE/React
component with no test harness in this repo — only the pure `choreography.ts` /
`layout.ts` layer is unit-tested, which is the hexagonal split the repo keeps on
purpose. It was verified instead by driving real events at the running page with
Playwright and reading the DOM (`.world-row`, `.world-bubble`) plus screenshots.
That loop is worth reusing: post to `/api/v1/events` with a chosen `sessionId`
and `agentIdentifier`, then scrape the roster every few seconds.

Confirmed by that method: a reader seated in READ swaps caption from
`On Forgetting` to `On Remembering` **without leaving the chair**; a following
`agent_session_started` puts them back on the floor towards the hub
(`Moving`, log line `entered the hub`); closing the visitor's tab flips them to
`Leaving` after the grace and not before.

### Files

```
apps/web/lib/telemetry/visitor.ts              new — the visit identifier
apps/web/components/visit-beacon.tsx           new — pagehide beacon
apps/web/app/api/v1/events/leave/route.ts      new — broadcast-only departure
apps/web/test/telemetry-visitor.test.ts        new — 6 tests
apps/web/lib/telemetry/broadcaster.ts          throttle key per address AND page
apps/web/lib/world/choreography.ts             isHumanAgent, stableHash, one name
apps/web/components/world/avatar.ts            human palettes, avatarPalette, flesh band
apps/web/components/world/world-canvas.tsx     hold model, exit grace, roster fields
apps/web/components/world/textures.ts          darker parquet
apps/web/components/sky-canvas.tsx             SkyEvent.historical
apps/web/app/api/v1/events/stream/route.ts     marks the backlog
apps/web/app/world/page.tsx                    drops historical, HUMAN tag, real swatch
apps/web/app/{page,wanted/page,skill/page}.tsx + articles/[slug]  sessionId + beacon
apps/web/app/{llms.txt,index.md,skill/SKILL.md}/route.ts          sessionId
apps/web/test/world-choreography.test.ts       +4 tests
```

`pnpm lint`, `pnpm --filter @agent-memory-wiki/web typecheck` clean;
`npx vitest run --project web` → 19 files, **115 tests** passing.

---

## Portrait and mobile — 2026-09-01, uncommitted

Not a PR yet. Three files are modified in the working tree; `main` is at #82
(`e6fd280`, the home link renamed *Visit Wiki World →*).

### What was wrong

A phone screenshot, 390 CSS px wide:

- The title card (`minWidth: 13rem`) and the roster (`13.5rem`) are 26.5rem
  together against 24.4rem of viewport, so they overlapped and the version line
  read `33 speci…`.
- The REPLAY sign is `top: 1.15rem; left: 50%` — exactly under both of them. The
  page's only control was unreachable.
- A second card repeated `ACTIVE AGENTS` as a count, under the title.
- The log, at `maxWidth: 22rem`, covered about 40% of the floor.
- `camera.top/bottom` were pinned to the frustum and only the width followed the
  aspect, so a portrait frame held ±7.6 units of floor against a desktop's ±26.6
  and the building ran off both sides.

### The HUD

Every panel's position was an inline style, which no media query can override,
so all four moved into classes (`.world-hud-title/count/roster/log`) at the same
values. Above them sits `.world-hud-top`, which is `display: contents` on a
desktop — it changes nothing there — and becomes the top bar on a phone.

Under `max-width: 720px` **or** `max-height: 520px`, which also catches a phone
held sideways:

- one bar: `← WIKI WORLD · n specimens`, `● n/6`, `REPLAY`, in that flex order;
- the roster as a horizontally scrolling row of pills, its own heading dropped
  because the count is in the bar;
- the log full width at the foot, clamped to three lines by
  `:nth-child(n + 4) { display: none }`, lines truncated rather than wrapped;
- the sign's tooltip hung from its right edge, and opened by tap:
  `@media (hover: none) { .world-sign:focus .world-sign-tip { opacity: 1 } }`;
- bubbles capped at `min(20rem, 68vw)`, credit lifted clear of the log.

### The camera

`applyCameraFrustum` now reads the shape of the window, not just its ratio:

- **Width.** In portrait the frustum grows until `PORTRAIT_MIN_HALF_WIDTH` (20)
  of floor is in shot, capped at `PORTRAIT_MAX_SCALE` (2) so the avatars survive.
- **Lift.** All that extra room otherwise appears as bare tile along the bottom,
  because the target sits at the hub and the building's mass does not. `lift =
  (half - frustum) * 0.15` hands a little back to the top.
- **Elevation.** The four rooms are a symmetric cross, which at 30° projects as a
  wide shallow diamond — the worst silhouette a tall frame could ask for. Screen
  height scales with `sin(elevation)`, so portrait stands the camera up to 45°:
  the building fills 78% of the frame's height against 61% at 30°, measured at
  1145×1570. Landscape and desktop keep the reference's 30°.

  The horizontal crop is unchanged by this — screen x depends on `(x − z)` alone
  — so on a 390px phone the LINKS and ARCHIVE signs still sit outside the edges,
  and no angle would bring them in.

### The corner offices

The three rooms at (-25,-27), (-27,25), (27,-25) exist to keep a wide shot's
corners off bare floor. A portrait frame has no such corners, so there they read
as rooms adrift. `BuiltEnvironment.setSceneryOpacity` fades them out.

They needed materials of their own: the four channel materials are shared with
the building — an outer desk is the same material as a desk in EDIT — so fading
them where they stood would have faded the building too. Each mesh in the group
gets a clone, blending is switched on only while the fade runs, and `castShadow`
goes at the start of it so a shadow does not hold at full strength under a room
that is leaving.

The fade and the elevation share one half-second clock in the frame loop, so a
rotation reads as one move; `prefers-reduced-motion` snaps both. The first frame
is not a change of shape and is not animated.

### Rejected: a portrait room layout

Moving the rooms for portrait was considered and dropped. It would not have paid:
the cross is symmetric, so any rearrangement that keeps it projects as the same
wide diamond. Only re-authoring the set into a diagonal stack would help.

It is also three unsynchronised sources of truth. `ROOMS` feeds `wallBoxes` and
collision, but `WAYPOINTS` is a separate table of twelve literal nodes — move a
room without them and agents walk into walls, silently. `environment.ts` places
59 props at literal coordinates and reads `ROOMS` five times; signs, room lights,
carpets, planters and glass are all hand-written numbers. And every one of them
is a module-level `const` consumed at import, so a portrait variant means a
second coordinate set plus a scene rebuild on each rotation, with the actors in
flight to re-path.

### Files

```
apps/web/app/world/page.tsx                 HUD classes, the mobile media query
apps/web/components/world/world-canvas.tsx  frustum, lift, elevation, the eased clock
apps/web/components/world/environment.ts    outerOffices group, setSceneryOpacity
```

Verified with Playwright at 390×844, 844×390, 1145×1570 and 1440×900: the bar
does not overlap (title ends at 183px, count 251–301, sign 308–381), the pill
strip scrolls (624px of chips in 390), the log shows three lines, and the desktop
frame is pixel-unchanged. `pnpm lint`, typecheck and `next build` clean;
`npx vitest run --project web` → 19 files, **123 tests** passing.

---

## Compaction — 2026-09-01, uncommitted

On top of the portrait pass, still not a PR. The user's note: *"nel mockup
originale la disposizione degli elementi era molto più compatta, gli ambienti
erano più vicini"* — and measured against the reference it is true. The plan put
26 units of bare tile between the READ and ARCHIVE facades, nearly two room
widths; the reference's plaza is about half that, which is why the shot read as
four rooms scattered on a floor rather than one office around a lobby.

### One knob, not a hundred coordinates

The obvious move — restate every coordinate at a tighter spacing — is the one
the "rejected: a portrait room layout" note above argues against, and for the
same reason: `ROOMS`, `WAYPOINTS` and `environment.ts`'s 59 literal placements
are three tables that have to agree, and nothing checks two of them.

So nothing was restated. `layout.ts` gained **`ROOM_INSET`** (5) and
**`ROOM_SHIFT`**, which slides each room along its own axis towards the hub —
READ east, ARCHIVE west, EDIT south, LINKS north, the entrance three quarters of
that on the diagonal. The authored plan is now `PLAN_ROOMS`, and `ROOMS` is that
plan with the shift applied to every centre, seat, standby spot and glass spot.
Waypoints and obstacles carry the room they travel with and are shifted the same
way. In `environment.ts` each room's props go into a `THREE.Group` positioned by
`ROOM_SHIFT` — `inRoom(id, …)` — so every literal in that file still reads
against the same plan `layout.ts` states, and a room moves in one place.

Two consequences worth keeping:

- **A coordinate in this file now means one of two things**, and which one
  depends on whether it is inside an `inRoom` block. Props are authored in the
  room's own frame; anything read out of `layout.ts` — the carpets, the obstacle
  list — is already shifted and is placed at the root. Both are commented.
- **`inRoom` hands the body its *authored* room**, so the READ armchairs and the
  EDIT desks still derive from `plan.seats` without picking up the shift twice.

### What the inset broke, and why each fix is where it is

Pulling the rooms in shortens every corridor, and three things that had room
before stopped having it. All three were found by measuring, not by looking: a
throwaway test walked every route leg past every wall, obstacle and the plinth
and printed the closest approach.

- **The way out to the entrance runs through a notch.** LINKS' east face never
  moves off x 5, because LINKS slides in z, so ARCHIVE's west face alone sets
  that corridor's width. One junction in the middle of it was not enough: the
  hub waypoint sits on the same 45° diagonal as LINKS' front corner, so a single
  node drew a leg **straight over that corner** (measured clearance 0.00). It is
  two nodes now, `c_e` and `c_s`, down the middle of the channel and then out —
  which is also what a corridor between two rooms looks like. Both are derived
  from the two facades rather than written flat, so they follow the knob.
- **ARCHIVE does not take the full inset.** At the full 5 the channel above was
  three units wide, half of it spoken for by an actor's ±1.2 lane offset, and
  the way in to the building read as a gap between two panes rather than as a
  way in. `ARCHIVE_RELIEF` (2) hands ARCHIVE back two of its five, which puts
  the channel at five units. The cost is that ARCHIVE stands two units further
  from the hub than the other three rooms, which does not read: the reference
  does not stand its rooms at equal distances either. Both facades are now taken
  off the rooms themselves rather than written down, so the junctions, the notch
  centre and the corner offices all follow whatever the shifts are set to.
- **The plinth is 6.2 across, not the 5.4 the old comment claimed**, and the
  legs that pass it lost half their margin. `c_ne` moved to two units off
  ARCHIVE's facade and `d_edit` off the middle of EDIT's opening to x 3.5; the
  worst plinth clearance is 0.82 (it was 1.5). `d_read` moved to z −0.5 for the
  same reason. Both openings are six units wide, so there is room to lean away
  from the plinth without leaving the doorway.
- **Three plaza props were standing in what became a wall.** The info pillar and
  the kiosk hug a facade, so they went into that room's frame and keep their
  distance at any inset — the pillar to the *north* of ARCHIVE's doorway, which
  is where the reference has it, because south of it is now the channel. The two
  small plants sit on the diagonal, belong to neither room, and were moved by
  hand out of what is now floor inside EDIT and READ.

### The frame followed the rooms in

A building ten units narrower on both floor axes under the same camera is a
building with more bare tile around it, which is the opposite of the ask. The
frustum came down 16.6 → **13.6**, the same ratio as the building's own
(22/27), so the set holds the frame exactly as it did and the avatars are
bigger. `PORTRAIT_MIN_HALF_WIDTH` came down 20 → 16 for the same reason, which
leaves the portrait framing where the portrait pass put it. The three corner
offices moved in by the inset too: left where they were they would have stood
off across bare floor.

### The three adjustments after it (same session)

Asked for on the strength of the shot, and all three are one value each in the
same tables:

- **Two hedges at the reception, not four**, and the desk moved down with them.
  The outer pair stood four units further out on the same diagonal and read as a
  hedge run rather than as a reception.
- **`LINKS_RELIEF`, 2 → 3 → 4.** LINKS' plaque covered READ's third armchair. At
  a relief of 2 the plaque cleared the chair but LINKS' west wall — 6.4 high,
  raised for that plaque — still hid it; 3 cleared the chair; 4 was asked for on
  top, as straight down. The unit of −X that came with the first two steps was
  given back at the third: **+Z alone moves a thing down *and* left in equal
  parts**, so −X is what buys left, and the last step was to be down only. That
  relation is worth keeping in mind for any move on this floor.
- **The entrance nearly stopped taking the inset.** It reads better *out* of the
  plaza: the reception belongs at the bottom of the frame, where the reference
  runs the building off the edge. At a shift of (0, 0) the desk's base and its
  step fell outside a 16:9 frame, so it takes a unit and a half — enough to sit
  on the edge without being cut by it.
- **The concourse that opened up between the reception and the two near rooms
  was then dressed**, since it was the one bare patch in the frame: the kiosk
  moved out into it from beside LINKS' doorway, one of the reception's hedges
  went against LINKS' east glass, and two more stand outside ARCHIVE's east
  glass, which is the wall the frame's bottom-right corner looks straight at.
  None of them is in `OBSTACLES` — the kiosk and the LINKS hedge sit three units
  or more off the line the entrance route takes, and no route reaches ARCHIVE's
  east side at all, which is served only by the doorway on the far one.
- **ARCHIVE's info pillar came round to its doorway.** North of the room, where
  the reference has it, ARCHIVE's own north wall stands in front of it and hides
  all but the top; beside the door on the screen-right side it reads.
- **The fountain moved with it**, `ROOM_SHIFT.hub` (0.6, 1.6), down the screen
  and a little left, so it sits under the shifted LINKS rather than square in
  the middle of a plaza that is no longer square. Two things had to follow:
  - **the hub waypoint is tagged to move with the fountain.** The plinth's south
    face and the hub node are three units apart and *every* corridor leg crosses
    that gap, so a fountain that moved south on its own would have pushed the
    READ leg into its own corner (measured 1.21 → 0.27).
  - **the node then went from z 3 to 3.6.** Moving with the fountain is not
    enough on its own, because the fountain moves *along* those legs rather than
    away from them; the extra half unit is what puts the worst of them back at
    0.94.

The fountain is now built inside `inRoom("hub", …)` like any other room, and
that block returns the crystal and its material — the two things
`world-canvas.tsx` animates.

### Two things about working in this repo, learned the hard way

- **Do not run `prettier --write` here.** There is no prettier config and no
  format script: the repo is *eslint*-checked and happens to be prettier's
  output at **`--print-width 100`**, with two deliberately longer lines
  (`wallMaterial`'s 101 and `addCarpet`'s texture ternary at 103). A plain
  `npx prettier --write` reformats at the default 80 and buries the real diff.
  Worse, prettier **keeps an object literal split once it has been split**, so a
  second run at 100 does not undo it — the recovery is to join every line ending
  in `{` to the next (skipping comment lines), reformat at 100, and put those
  two long lines back by hand.
- **Measure the routes, do not look at them.** Every clearance figure in this
  section came from a throwaway test under `test/`, deleted after use: walk
  `findPath` over all room pairs plus the last leg out to every seat and standby
  spot, and for each leg print the closest approach to every wall box, every
  `OBSTACLES` footprint and the hub plinth (6.2 × 6.2 at the fountain's own
  shift, which is *not* in `OBSTACLES`). Sort ascending and read the top ten.
  Two clearances that read fine on screen — a leg over LINKS' corner and a leg
  through the plinth — were exactly 0.00, and neither was visible in a
  screenshot of an empty floor.

### Where it stands

Verified at 1600×900, 390×844 and 844×390. `pnpm lint`, typecheck and
`next build` clean; `npx vitest run --project web` → 19 files, **123 tests**.

Final values, all in `layout.ts` unless said otherwise: `ROOM_INSET` 5,
`ARCHIVE_RELIEF` 2, `LINKS_RELIEF` 4 (with LINKS' x nudge back at 0),
`ROOM_SHIFT.hub` (0.6, 1.6) with the hub waypoint at authored z 3.6,
`ROOM_SHIFT.entrance` (−1.5, −1.5), and `frustum` 13.6 with
`PORTRAIT_MIN_HALF_WIDTH` 16 in `world-canvas.tsx`.

Known, and both pre-existing rather than caused by this:

1. **The two hub standby spots route through the plinth.** The legs from the hub
   waypoint out to the two spots behind the fountain cross it, and moving the
   fountain moved both together so it is unchanged rather than fixed. The plinth
   is not in `OBSTACLES`, so no test sees it. The fix is to re-author those two
   spots beside the plinth instead of behind it — two coordinates — and it was
   left alone because nothing in this pass asked for it.
2. ~~One lane in six brushes the channel glass.~~ Fixed by `ARCHIVE_RELIEF`:
   the channel is five units wide, and the widest lane offset is 1.2, so every
   lane clears both panes.

To change the spacing: `ROOM_INSET` in `layout.ts`, one value, with
`ARCHIVE_RELIEF` beside it holding the entrance corridor open. Below 4 the plaza
gets its bare tile back; above 5, raise the relief with it or the corridor
closes again.

---

## The set editor — 2026-09-01, branch `feat/world-editor`

Asked for as: *"un editor che mi consenta di muovere gli elementi manualmente
wysiwyg sia le stanze complete che i singoli elementi… permettendoti però di
ricostruire i path, gli ostacoli, ecc"* — with the standing instruction to plan
first and to say if it made the project less stable.

Five commits, in this order, each green on its own.

### What it is, and the one thing it deliberately is not

`/world?edit=1` turns the page into a WYSIWYG editor for the set. Click a room
or a prop, drag it on the floor, and the panel measures what that did to the
walk graph *while you drag*. Arrow keys nudge, `q`/`e` change height, `r`
rotates by 15°, the snap cycles free / 0.25 / 0.5 / 1, and Export hands back the
numbers to paste.

**It does not rebuild the waypoint graph, and that is a decision rather than a
gap.** The graph is authored: twelve nodes plus an adjacency table saying which
corridors exist. It encodes where a corridor *is*, not the shortest way across
an empty floor. Generating it from the geometry means a grid navmesh, and a grid
navmesh would cut the plaza diagonally and lose the thing the reference art is
about. What travels automatically is what already did — nodes tagged to a room
move with it, and the three plaza junctions re-derive from the facades either
side of them. Everything else is measured and reported, and fixing it is a
human's call.

**It does not write to disk either.** The floor is authored in two files whose
prose carries the reasoning behind every coordinate; a tool that rewrote them
would eventually mangle that prose, and a tool that only *proposes* numbers
costs nothing when it is wrong. Export names each change by the authored
position it was written at, which is what makes the line greppable back to the
call that wrote it.

### The four things that had to exist first

**1. Measurement, not a boolean** (`lib/world/validate.ts`). `layout.ts` answers
"does this leg cross a wall or clip a prop". The editor needs "by how much", and
so does anyone moving a room: the two worst things this set has shipped were a
leg over LINKS' corner and a leg through the plinth, both at a measured 0.00 and
neither visible in a screenshot. §"Compaction" found both with a throwaway
script and deleted it twice. It is a module now, and the test beside it pins
what the floor measures today: **exactly two legs touch anything** — the walk
out to the two hub standby spots behind the fountain, the known rough edge —
and everything else clears more than an avatar's width. A third zero means
something moved and took a route with it.

`HUB_PLINTH` moved into `layout.ts` at the same time. It stays out of
`OBSTACLES` on purpose: listing it would make those two standby spots
unreachable rather than fix them.

**2. The floor plan as a value** (`deriveFloor` in `layout.ts`). Everything the
shifts touch was computed once at import into module constants — right for a
plan that never changes, wrong for asking what a *different* arrangement would
do. `deriveFloor(shift)` returns rooms, waypoints, obstacles, plinth and wall
boxes together; `DEFAULT_FLOOR` is that applied to `ROOM_SHIFT`, and every
export the page already used is one of its fields, so no consumer changed.
`findPath`, `segmentCrossesWall` and `segmentHitsObstacle` take a floor,
defaulting to that one.

Verified by identity rather than by reading: rooms, waypoints, obstacles, plinth
and all thirty-six room-to-room paths dumped to JSON before and after, and the
two files are the same. **Reuse that trick for any change to this file.**

**3. Stamps, not a data table** (`environment.ts`). A prop had geometry and a
position and no identity, so a tool that drags one has nothing to call it.
Lifting sixty-five placements into a data table would have restated two days of
by-eye tuning as an unreviewable diff. Instead `place`, `placeVoxel` and
`placeText` record what they were given on the object itself —
`userData.editable` carries a positional id, the geometry key, the room frame,
and the coordinates as authored. Lettering that sits on a prop passes that
prop's id to both calls, so a dragged plaque does not slide out from under its
own letters.

**4. A room that is actually one thing.** Carpets, doorway strips, obstacle
props and room lights were placed at the root from the already-shifted tables.
That worked — `plan + shift` is what those tables hold — but it split a room
across two frames, so moving its group would have left its floor, its planters
and its lamp behind. All three now go into the room's own frame from the plan,
which also collapses the ambiguity §"Compaction" left behind: outside the corner
offices and the concourse plants, which belong to no room, every coordinate in
`environment.ts` is in the plan now.

### What the panel shows, and why that is the whole point

Six tightest clearances, green while a leg has room, amber inside the ±1.2 lane
budget, red at zero. Drag ARCHIVE two and a half units west and the corridor
legs past the plinth go **0.94 → 0.14**, because `c_ne` is measured off
ARCHIVE's own facade. Nothing about that is visible in the frame; it is a number
that turns amber under your hand. That single behaviour is the reason the
measurement had to come before the editor.

`MAX_LANE` is a budget to read a figure against, not a number to subtract from
it: the offset is perpendicular to the leg, so a doorway node standing a unit
off its own facade is not brought closer to it by a lane running past.

### Cost in production

One `URLSearchParams` read in `world-canvas.tsx`, plus the `userData` stamps.
The editor is a dynamic import: `next build` puts it in a 10KB chunk of its own
that the world page's bundle does not reference. Actors are not staged while it
is on — an actor mid-leg is walking a path derived from a floor that is moving
under it, and an empty floor is what you want to look at anyway. The activity
log is hidden, because it owns the same corner as the panel and was swallowing
its clicks.

### Verified

Driven end to end with Playwright against the dev server: room picking resolves
at five points across the floor, a prop drag moves its obstacle footprint with
it (`archive seat 0` 1.21 → 0.95 and the export line names
`PLAN_OBSTACLES archive-crates-w`), and a room drag breaks two corridors and
says which. The two refactors were checked against screenshots at 1600×900 —
the set is in the same pixels, and the only differences in the frame are the
avatars and the HUD.

### Where it stands, and what is worth doing next

- **Waypoints are not draggable yet.** They are the one part of the plan the
  editor reports on but cannot move, and they are also the fix for most of what
  it reports. Rendering the twelve nodes as pickable markers is the obvious
  next step and needs no new machinery: they are already a table.
- **The two hub standby spots still route through the plinth.** Unchanged, and
  now pinned by a test rather than by a paragraph. Two coordinates.
- **Export is one-way.** Applying a patch is a human's or an agent's job; that
  is the point, but a `--check` that reads the current source and says whether
  it matches the last export would close the loop without writing anything.


---

## The editor's first layout — 2026-09-01, branch `feat/world-editor`

The first set of numbers to come back out of `?edit=1` and go into the source.
Fourteen lines pasted from Export: three room shifts and eleven props, one of
which was a no-op. Applied verbatim, then measured.

### What the export could not tell us

Three of the moves broke a clearance and one fixed one, and **none of the four
was visible in the frame or caught by a test**, because all four props involved
are placed by hand in `environment.ts` and were in no list at all. The editor's
own panel reported the plinth, which is in `layout.ts`; it could not report the
other three, and that gap is what the pass below closes.

| | before | after the paste | fixed to |
|---|---|---|---|
| `lounge-table` · links standby 2 | 1.70 | **0.00** | 1.45 |
| `info-pillar` · edit→read leg 2 | 0.93 | **0.42** | 1.15 |
| `read→edit leg 2` · plinth | 0.94 | **0.64** | 1.04 |
| `kiosk` · entrance standby 1 | **0.00** | 5.50 | — |

The kiosk row is the one worth staring at: it had been at zero since the
concourse was dressed, through two passes and a ship, and the thing that found
it was measuring a prop that had moved for an unrelated reason.

### The four repairs

- **LINKS' side table had landed on that room's third standby spot** — not near
  it, on it, so an avatar queuing there wore it. Walked north to `z 25.4`. The
  standby row is a straight queue at `x -1`; bending the queue round the
  furniture would have been the worse trade.
- **The info pillar and `c_ne` are derived from the same facade**, so ARCHIVE
  moving east carried them together and closed them to 0.42. The pillar went a
  unit north; it stays south of the wall that would hide it.
- **The fountain moved south again and took the READ corridor with it.** The hub
  waypoint travels with the hub, so its own relation to the plinth held — but
  `d_read` does not travel with anything, and that leg came back at 0.64. The
  hub node's gap to the plinth's south face went 3.6 → 4.6, which is the third
  time this number has moved and always for this leg. **If the fountain moves
  again, check `read→edit leg 2` first.**
- **The two hub standby spots that had routed through the plinth since the
  compaction pass are gone**, re-authored at `(±5.5, 0.6)` — beside the fountain
  rather than behind it, which is the fix §"The set editor" described and
  nothing had asked for. Both legs now measure 1.82. The floor has **no leg
  touching anything**, and `world-validate.test.ts` pins that rather than
  pinning the two zeroes.

### `PLAN_SCENERY`: measured, not placed

`PLAN_OBSTACLES` is a *placement* list — `environment.ts` draws a prop for every
entry — so a prop that file already authors by hand cannot be added to it
without drawing it twice. That is why the kiosk, the pillar, the lounge pair and
the four plaza plants were in nothing: the only list that could have held them
would have duplicated them.

`PLAN_SCENERY` in `layout.ts` is the other half. A footprint per hand-placed
prop that stands on open floor near a route, carried on `Floor.scenery`, read by
`validate.ts`, placed by nobody. It deliberately **does not change pathing**:
`findPath` still routes around `PLAN_OBSTACLES` alone, and a prop here is
something the clearance test reports rather than something the graph swerves
for — the same division the editor draws.

Two things to know before adding to it: the footprint is the prop's widest part
*at the height an avatar occupies*, which for `plantTall` is the canopy at
y 1.95 and not the pot; and a prop placed at a rotation needs the bound of the
rotated box, which is why the kiosk is 1.56 square rather than 1.2 × 1.0.

The cost is a second place to edit when one of these moves. That is the trade
the waypoint table already makes, and the test is what catches the drift.

### Consequences for the layout knobs

- `LINKS_RELIEF` went 4 → **2.5** and `ARCHIVE_RELIEF` 2 → **3.25**, and both
  rooms now carry a nudge *across* their own axis (`links.x` +1.5,
  `archive.z` +0.5) that the relief formula has no slot for. `ROOM_INSET` is
  still the one knob for the spacing; the cross-axis terms are framing and do
  not scale with it.
- **LINKS' east face moves now.** The `ARCHIVE_RELIEF` docblock used to say it
  never left x 5 because LINKS slid in z alone. With the x nudge the notch out
  to the entrance is 4.75 rather than 5, so both reliefs bear on that corridor.
- `ROOM_SHIFT.hub` (0.6, 1.6) → **(1, 2.75)**.

### Still open

- **The editor measures a dragged *room* against the scenery, but not a dragged
  *prop*.** `walkClearances(candidateFloor())` sees `Floor.scenery`, so a room
  drag now reports it; the prop-drag path resolves its selection through
  `PLAN_OBSTACLES` alone, so dragging a scenery prop moves it on screen without
  moving its footprint in the measurement. Export has the same shape: it emits a
  `PLAN_OBSTACLES` line and no `PLAN_SCENERY` one.
- Two pre-existing tight pairs are unchanged and were tight before this pass:
  `archive seat 2 · archive-crates-e` at 0.87 and `read glass · read-table` at
  0.97. Both clear `AVATAR_CLEARANCE`.

### The editor's second pass — drag, turn, clone, delete, undo

Four requests, all on `?edit=1`.

- **The panel drags by its title bar.** It owns the bottom-left corner, and the
  corner it owns is sometimes the one holding the prop you are placing in it. It
  positions from `bottom` until first grabbed and from `top` after — an element
  cannot be dragged in y while `bottom` is what pins it — and clamps so 40px of
  it always stays on screen, or the grip would be ungrabbable.
- **Rotation is by fixed turn, 90° by default** (`r` / shift-`r`, or the two
  buttons; the step cycles 90 / 45 / 15). 90 first because the set is built on
  the floor's own axes: everything in `environment.ts` is at 0, ±π/2 or π, and a
  prop at some other angle reads as dropped rather than laid out.
  - **It turns the group about its anchor, not each object about its own
    centre**, which is what it used to do. A sign is its plaque *and* the
    lettering placed in front of it; spinning both in place at ninety degrees
    left the letters facing out of the wall they are painted on.
  - **A room does not rotate**, and says so. Its walls, doorways, seats and
    waypoints are authored axis-aligned in `layout.ts` and none of them would
    follow, so turning the frame would silently disagree with the walk graph.
  - Rotation is now **exported**, which it never was: the panel turned things and
    the patch said nothing. It comes back spelled the way the file spells it —
    `CAMERA_FACING`, `-Math.PI / 2` — with a plain number as the signal that a
    prop has been left off-axis.
- **Clone (`c`) and delete (`del`).** Neither writes anything. A clone has no
  call to amend, so it exports as a line to *write*, naming the prop it was
  copied from and that prop's authored position, which is what makes the
  original one grep away; the builder argument comes back as `<builder>`,
  because it is a function reference this module cannot name and a guess at
  `F.something` is a paste that does not compile. A deletion exports as the call
  to remove, named by its authored position, plus its footprint entry if it has
  one. Cloning shares geometry and material, so a copy costs a transform and
  nothing on the GPU.
- **Undo (`ctrl`/`cmd-z`)** is a stack of closures that put back the fields one
  action touched — there is no serialisable document here to diff, only a scene
  graph and four maps. An entry is taken *before* the change, so a drag captures
  on pointer-down and pushes on pointer-up, and only if it went anywhere: a
  click that merely selects is not an action to undo.

### Three defects this pass found in the editor as it stood

All three were found by driving the page, not by reading it.

- **The scenery footprints were not wired to anything.** `PLAN_SCENERY` named
  its entries readably (`kiosk`) and `environment.ts` stamps positional ids
  (`kiosk#1`), so the lookup never matched and the list was dead on arrival. It
  carries a `prop` field naming the stamp now. With it wired, dragging the kiosk
  ten units back onto the entrance route takes the panel to **0.10** — before,
  the prop moved on screen and the panel reported the floor it had *before* the
  drag, which is worse than reporting nothing.
- **A cloned object's rotation exported as 0 however it was turned.**
  `Object3D.copy` carries orientation as a quaternion, and the Euler derived
  back from one is only *an* equivalent: a half-turn about Y comes back as
  (π, 0, π), not (0, π, 0). The copy looked right and reported `rotationY` 0.
  Copying the source's Euler outright keeps the screen and the patch agreeing.
- **The glass swallowed every pick.** Every room is glazed on the sides facing
  the camera, so the pane was the first thing the ray met and the props inside a
  room were unselectable — which makes rotate, clone and delete useless exactly
  where they are wanted. Picking now prefers the nearest hit that is not a pane,
  falling back to the pane so one is still selectable over empty floor. A grid
  scan of the frame reaches 72 distinct props, desks and crates included.

Verified by driving the running page: the panel moves from (12, 570) to
(660, 110); `r` takes a pane from `Math.PI / 2` to `Math.PI` and the export says
so; a clone selects itself and exports as a new call inside the right `inRoom`
frame; deleting a scenery prop drops its footprint from the measurement and
exports both the call and the entry; and twenty undos return the export to
`nothing moved yet.` No console errors.

**Still one-way, deliberately.** Export proposes, a human applies. A `--check`
that reads the current source and says whether it matches the last export is
still the thing that would close the loop without writing.

---

## The fountain, and the editor's third layout — 2026-09-01

The user's report, alongside a second export: *"la fontana dell'hub non sembra
essere considerata tra gli ostacoli. vedo che gli agenti la attraversano."*
Both true, and they are two different problems.

### The fountain was not an obstacle, and that is now fixed

`PLAN_PLINTH` sat outside `Floor.obstacles` by design — §"The set editor"
records why: two of the hub's standby spots stood *behind* it, so listing it
would have made them unreachable rather than fixed anything, and the note said
the fix was to re-author those two spots beside it. That was done earlier the
same day. **The exception had outlived its reason**, so `deriveFloor` now puts
the fountain in `Floor.obstacles` like everything else, under a new
`ObstacleKind` of `"fountain"`. It is still placed by the hub's own dressing:
`PLAN_OBSTACLES` is a placement list and the fountain is not in it.

### But that is bookkeeping. Walking through it was geometry

Listing it changes nothing on screen, because avatars do not consult the
obstacle list — they walk the authored waypoint legs. The reason they walked
through the water is arithmetic:

- the tightest leg passed the plinth at **1.04**;
- an actor does not walk the centre line, it takes a lane offset of up to
  `MAX_LANE` (1.2), and `AVATAR_CLEARANCE` (0.55) of body reaches past that.

So the bar is **1.75**, and at 1.04 three of the six lanes drove through the
fountain. This is the first clearance on this floor with a *target* rather than
a floor of "more than an avatar's width", and the target is written down in the
test.

**Sliding waypoints could not reach it.** The hub node was the obvious lever and
it tops out: at plan z 5.6 the leg reaches 1.67, and past 6.1 the hub's own
waypoint stands outside the hub room. Moving `d_read` south instead trades the
fountain against READ's doorway planter — a sweep of the whole (x, z) grid for
that node has no cell where both clear. The node is back at 4.6, where it was.

**Routing round it did.** The east side of the plaza has had junctions since the
compaction pass, for exactly this reason: the plinth is between the hub and
EDIT, so that route steps out east first. The fix is to say the same thing about
the other three quadrants and mean it:

- **`c_w`**, new, a unit and a half west of the plinth's west face and a little
  past its south one, measured off the fountain so it follows it. `hub`–`d_read`
  is **gone**: BFS counts hops and would have taken the shorter, worse route.
- **`hub`–`c_ne` is gone too.** With the west fixed, that leg became the binding
  one at 1.59 — it cut the fountain's *south-east* corner. EDIT is now reached
  through `c_e`, which already stood clear of the plinth with a run to both.

The floor now clears the fountain by **1.82** everywhere, and READ↔EDIT reads
`read → d_read → c_w → hub → c_e → c_ne → d_edit → edit`: a walk around a
fountain rather than through it.

`read-planter-s` moved half a unit south with it, to 3.5. The new west route
passes it on the way in and clipped it at 0.80; it now measures 1.10, at the
price of overhanging the glazed panel it is tucked under by 0.3.

### A note on the lanes, not acted on

`LANES` is `[0, 0.8, -0.8, 0.4, -0.4, 1.2]` — five symmetric offsets and one
stray. The widest lane exists on one side of a corridor only, so which side of a
leg a prop stands on decides whether the sixth actor clears it. `MAX_LANE` is
honest about the number; the asymmetry looks unintended. Left alone because
nothing asked for it and it is a behaviour change, not a measurement.

### What the layout paste moved

`ROOM_SHIFT.archive` to (-0.75, 0.5) (`ARCHIVE_RELIEF` 4.25); the kiosk, the
info pillar, both LINKS lounge pieces, a plaza plant, two entrance plants, two
glass runs and the hub sign; READ's low table turned a quarter turn; a hedge
cloned from `read-planter-s`; and LINKS' second picture frame deleted.

Two things needed a hand:

- **READ's low table landed in the fan of legs out of READ's own waypoint**, at
  0.00 against four of them including the walk in through the doorway. Its z
  came back from 0.75 to 3.5. This is the third time this table has had to be
  moved off that line.
- **The cloned hedge keeps READ's frame**, because that is the frame the prop it
  was copied from lives in — so it travels with READ while standing behind
  LINKS' north wall. Kept as exported and commented, because re-homing it
  silently changes where it lands the next time a room moves. Worth a look.

Still open: `links seat 1 · scenery:lounge-table` at **0.65**. That clears an
avatar's width and reads as a side table beside a chair, so it was left alone —
but it is the tightest thing on the floor now.

### Two bugs in the editor, both visible in the paste itself

- **A footprint tracked its prop from the wrong anchor.** `movedObstacles` and
  `movedScenery` recorded `plan + (position − selectionOrigin)`, and a
  selection's origin is taken afresh on every click — so a prop dragged,
  released, clicked and dragged again recorded only the second drag. Two entries
  in the paste disagreed with their own `place` lines because of it
  (`lounge-table` by (1.5, 2.75), `info-pillar` by (0.25, 1.0)); the `place`
  lines were the correct ones and are what was applied. The anchor is the
  prop's **authored** position now, which is fixed and stateless.
- **A quarter turn did not swap a footprint's extents.** READ's table was turned
  90° and its exported footprint kept `width: 1.8, depth: 1.1` — a footprint at
  right angles to the prop standing in it, which is the one thing
  `PLAN_OBSTACLES` exists to prevent. The export swaps them now and says it did.
  The placement loop had the same gap in the other direction: `coffee-table` was
  placed at rotation 0 whatever its footprint said, so it now turns by its own
  extents the way a planter does.

### LINKS' lounge corner — the table, and a red chair

**The table went back beside its chair**, from authored (-7.25, 20) to
(-6, 14.5). Where the editor left it it stood 0.65 off the walk into LINKS'
middle seat, the tightest thing on the floor; it now measures 1.55, with 0.15
between the two footprints — a side table beside a chair, which is what it is.

Worth recording *why* 0.65 was not the emergency it looked like, because the
same arithmetic applies to every seat on this floor. **The last leg of a walk
carries no lane offset.** `legTarget` in `world-canvas.tsx` returns the waypoint
unchanged when `isFinal`, because the last point of a path is the seat the actor
reserved and is already its own. So the bar for a leg into a seat is
`AVATAR_CLEARANCE` alone (0.55), not the `MAX_LANE + AVATAR_CLEARANCE` (1.75)
that the fountain needed — the lane budget applies to corridors, where a crowd
shares a line, and tapers to nothing at the destination. `archive seat 2` has
sat at 0.87 against its crates for the same reason.

**The chair is red.** It was a slate blue, in the same family as LINKS' cyan
screen and teal weave; a red is the only warm thing in that room.

It took two goes, and the second is the point. `0xa8443f` — a fair mid red on
paper, at the blue's own lightness — sampled off the screen at **`0x261215`**,
which is black. That corner is the darkest place in the set: the key at azimuth
70 never reaches those faces and the AO in the corner takes what is left. At
`0xe0655a` / `0xf98c80` / `0xed7468` the same faces read `0x5c1a1f` with the
cushion at `0xa22b2c`, brighter than the blue it replaced ever managed
(`0x18273d`), and it reads as red rather than as maroon.

That is the third time this file has recorded the same lesson — §3.1 for the
plaque, §10.2 for Claude's orange, this. **Sample the pixels, do not judge the
hex**, and expect a warm hue in an unlit corner to need authoring two stops up.


---

## 11. Session of 2026-09-02 — shipped in #88

Read this section before touching anything below `apps/web/lib/world/` or the
`/world` HUD: it is the only record of why these files look the way they do.

This shipped as one commit in #88. What it touched:

```
 M apps/web/app/articles/[slug]/page.tsx
 M apps/web/app/index.md/route.ts
 M apps/web/app/llms.txt/route.ts
 M apps/web/app/page.tsx
 M apps/web/app/skill/SKILL.md/route.ts
 M apps/web/app/skill/page.tsx
 M apps/web/app/wanted/page.tsx
 M apps/web/app/world/page.tsx
 M apps/web/components/world/avatar.ts
 M apps/web/components/world/environment.ts
 M apps/web/components/world/world-canvas.tsx
 M apps/web/lib/analytics.ts
 M apps/web/lib/graph.ts
 M apps/web/lib/public-data.ts
 M apps/web/lib/world/choreography.ts
 M apps/web/lib/world/layout.ts
 M apps/web/lib/world/validate.ts
 M apps/web/test/world-choreography.test.ts
?? apps/web/lib/telemetry/geo.ts
?? apps/web/lib/version.ts
?? apps/web/test/public-data.test.ts
?? apps/web/test/telemetry-geo.test.ts
```

`pnpm exec tsc -p apps/web/tsconfig.json --noEmit` clean, `pnpm exec eslint`
clean on every changed file, `pnpm exec vitest run` **213 passed / 32 files**.
**Almost nothing in this session was seen rendered.** The Chrome extension
stayed disconnected throughout, so the visual claims below are reasoned from the
code and the numbers. The one exception is a screenshot the user sent of
`localhost:3100/world`, which confirmed §11.2 and §11.3 on screen: the roster in
the bottom right reading `ACTIVE AGENTS ● 1 / 6` with a green dot over a live
avatar, `By NuvolaProject` under the sign, `v1.0.0`, the REPLAY sign dark. The
scan pose (§11.5), the shelf spots and every caption remain unseen. Look at
`/world` before shipping.

### 11.1 The A–Z index was showing twenty of thirty-five articles

Reported as "I can't find *Maintenance Is a Form of Creation* in the index".

`latestArticles()` in `apps/web/lib/public-data.ts` was hard-coded to
`limit: 20`. It is a front-page feed and twenty is right for that, but four
pages that describe the **whole corpus** were reading the same feed and silently
claiming the archive was twenty entries long. Production has 35.

Added `allArticles()` beside it: walks the cursor at the API's own maximum page
size (100), bounded at 50 pages because an unbounded loop against a paginating
endpoint is one bad cursor away from spinning forever, and degrades to a partial
read rather than an error screen. It takes the pager as a parameter with a
default, which is the seam `apps/web/test/public-data.test.ts` uses — the repo
has no module mocking anywhere and this keeps it that way.

Repointed at it: `lib/analytics.ts` (the Directory A–Z and Patterns),
`lib/graph.ts`, `app/wanted/page.tsx`, `app/index.md/route.ts` — the last of
which was printing `Total Entries: 20`. **Left on `latestArticles()`
deliberately:** `app/page.tsx` and `app/articles/[slug]/page.tsx`, where "the
latest twenty" is the correct claim.

### 11.2 HUD rework

- The `ACTIVE AGENTS n/6` card in the top left is **gone**. Its count now rides
  in the roster card's own title (`ACTIVE AGENTS ● 3 / 6`).
- The roster moved from top-right to **bottom-right**, out from under the speech
  bubbles the writers raise over the middle of the floor.
- `By NuvolaProject` moved out of the loose bottom-right corner (which the
  roster now wants) into the title card, under `WIKI WORLD`, white and small,
  with a gap below it so it does not read as the first half of the version line.
  On a phone it goes back to the floor: there is no room for it in the bar.
- Version string is now `apps/web/lib/version.ts` → `APP_VERSION`, **1.0.0**.
  Not read from any package.json: every manifest in the workspace is `0.0.0`,
  a placeholder for packages that are never published. **The user asked that
  this be bumped on every significant change from here on.** It was left at
  1.0.0 through this whole session on the grounds that 1.0.0 has not deployed
  yet and all of §11 is one release; the next change after 1.0.0 goes live must
  bump it.

### 11.3 Colour: green is live, yellow is a recording

Was: red bead for live, dim green bead for replay, green REPLAY sign. Now:

- live bead **green `#46e884`**, replay bead **yellow `#ffd23f`** — both lit, because
  they are two states, not a state and its absence
- the REPLAY sign lights **yellow** when on, the same yellow as the bead
- the occupancy dot follows the floor: green if any live agent, yellow if the
  floor is all replay, dark if empty (`occupancyTone` in `app/world/page.tsx`).
  It was green-on-any-avatar, which under the new scheme would have been the
  exact lie the beads were changed to stop telling.

**Known collision, not fixed and not asked about:** `STATUS_COLOR.Reading` is
still `#5fdc7a`, a green. A replay row now shows a yellow bead beside the green
word `Reading`.

### 11.4 A ficus was standing on a walk leg, and nothing could see it

The user moved `plant-ficus#7` in ARCHIVE from `(14.6, 0, 7.6)` to
`(17, 0, 7.75)` — in the editor, not in the file; the working tree still had the
old value and this session applied it.

Measured, footprint 1.2² (the planter's lip; the crown is at y=2.6, over an
avatar's head), room-local coordinates on `ROOM_SHIFT.archive = {-0.75, 0.5}`:

| | world | closest leg | distance |
|---|---|---|---|
| old `(14.6, 7.6)` | x 13.25–14.45, z 7.5–8.7 | `archive glass` | **0.000** |
| new `(17, 7.75)` | x 15.65–16.85, z 7.65–8.85 | `archive glass` | **1.920** |

The glass spot is at `(13.25, 7.5)` — exactly the old footprint's corner. The
leg from the archive waypoint out to the glass **touched the planter**. The
user's move fixes a real zero, of the class this file has now recorded three
times.

**Why nothing caught it:** none of the eight ficus were in `PLAN_SCENERY`, so
`validate.ts` never measured them. The editor's own "tightest clearance on this
floor" readout said `0.87 — archive seat 2 · prop:archive-crates-e`, which is
the crates in another corner and is **identical before and after the move**. The
readout gave no feedback at all about the prop being moved.

So **all eight are now registered** in `PLAN_SCENERY` (ids `ficus-read-ne`,
`ficus-read-nw`, `ficus-edit-ne`, `ficus-edit-sw`, `ficus-links-sw`,
`ficus-links-se`, `ficus-archive-sw`, `ficus-archive-ne`), footprint 1.2². All
pass; the tightest of the other seven is `#1` in READ at 2.300. Verified the
guard bites by putting `#7` back at `(14.6, 7.6)`:

```
× has no leg that touches the scenery
+   "archive glass / scenery:ficus-archive-sw"
```

**Still open:** every other `environment.ts` prop — shelves, desks, frames,
crates that are not in `PLAN_OBSTACLES` — is invisible to the validator the same
way. Closing that needs a footprint per prop and is a job of its own.

### 11.5 Where the visitors go, and the scraping pose

The user asked what `curl` and `ki-radar/0.1` were reading. **They cannot be
answered retroactively.** `broadcastSkyEvent` (`lib/telemetry/broadcaster.ts`)
publishes to the in-process bus and to ntfy and **never writes
`archive_events`** — confirmed against production, 101 rows, zero of either.

Worse, `BEHAVIOUR` keyed only on event type, so `/`, `/skill`, `/skill/SKILL.md`,
`/llms.txt`, `/index.md` and `/wanted` all became one `agent_session_started` →
hub, idle, "connected to the archive". Six pages collapsed into one shrug. The
page **was in the payload** as `safeMetadata.title` and was thrown away in
`captionFor`.

Fixed by adding `page: "<path>"` to each of those six beacons and a `PAGE` map
in `choreography.ts`, path → room + action + caption + icon:

| page | room | bubble |
|---|---|---|
| `/` | hub | ✨ arrived at the archive |
| `/skill` | hub | 📋 reading the protocol |
| `/skill/SKILL.md` | hub | 📋 studying the protocol |
| `/llms.txt` | hub | 📜 reading the guidance |
| `/wanted` | hub | 🔎 looking for the gaps |
| `/index.md` | **archive** | 🔦 scanning the whole archive |

Keyed on the path, not on the human title beside it: the path is an identifier,
the title is prose that will be rewritten. **The words and the icons are the
model's, not the user's — they were offered for review and not yet ruled on.**

**Why the visitors stay in the hub rather than going to READ:** the user's own
constraint. READ has three chairs and the floor can hold six agents. A bubble
over a head in the hub costs no seat.

**The scan action.** `/index.md` is the markdown dump of the entire corpus:
that is not reading an entry, it is taking the shelf. So it goes to ARCHIVE and
**stands at the stacks**, which needed new geometry:

- `Room.shelf` in `layout.ts`, ARCHIVE only: three points at `(18.2, -3.1)`,
  `(20, -3.1)`, `(21.8, -3.1)` in the plan frame — a pace off the shelf unit at
  `(19.6, -4.3)`, a pace clear of the desk row at `z = -2`. `stationFacing: 0`
  already turns an avatar towards −Z, which is the shelf, so no `facingOverride`.
- Claimed like a station (`archive:f0..2` in `occupiedStations`) so two scanners
  never stand inside each other, but **outside the seat/standby queue**: a
  visitor copying the corpus is not waiting for a desk, and putting it in that
  queue would sit it in a chair — the one picture of wholesale copying that is
  wrong. With all three taken it falls back to `claimStation` rather than
  stranding the avatar. `promoteWaiting` cannot pull a scanner into a seat
  because a scanner is never `waiting`.
- The three legs are in `routeLegs` and therefore validated. Tightest **1.400**
  against `prop:archive-crates-e`, against `AVATAR_CLEARANCE` 0.55.
- New `"scan"` pose in `avatar.ts`: standing, one arm tracing the spines, head
  sweeping the row. Wider and slower than `browse`, which is somebody at a
  screen. Roster status `Scanning`, `#c9a0f5`.

**The injection surface, and why it is closed.** `safeMetadata` is text that
arrives with a request. `pageOf` accepts a path **only if it is a key of `PAGE`**
and **only on `agent_session_started`** — an unknown path falls back to the
generic greeting, and `/index.md` on an article event does not move a reader into
ARCHIVE. Three tests in `world-choreography.test.ts` pin exactly that. Do not
relax this into printing `safeMetadata` directly; a floor that prints it is a
floor that prints whatever a request can name.

### 11.6 Findings handed back, not acted on

- **`/robots.txt` returns 404.** No crawl directives for anybody. The
  `<meta name="robots" content="noindex">` speaks to search indexers, not to a
  poller.
- **`classifyClientAgent` truncates the user agent to 18 characters**
  (`broadcaster.ts:113`) before anything else sees it. A polite bot puts its
  contact URL in the UA; we cut it off, and since these beacons are never
  persisted the full string is gone from our side permanently. The Vercel log
  has it, with the path.
- **The passive-read cooldown is 2.5s**, keyed `ip:eventType:articleId`
  (`broadcaster.ts:70`). Anything polling faster gets a fresh avatar every time,
  so one poller reads as a crowd. This is the likely explanation for
  `ki-radar/0.1` appearing constantly — one talkative client, not many.
- **No beacon at all** on `/directory`, `/patterns`, `/search`, `/graph`,
  `/about`, and **none on API reads**: a scraper pulling the corpus through
  `GET /api/v1/articles` is completely invisible on the floor. The scan pose
  therefore only ever fires on `/index.md`.
- The avatar info card was raised as "not meaningful — I can't see the origin".
  Four options were drawn up with mockups and widths; the user redirected to the
  bubble work instead, so **the card is unchanged**. Note for whoever picks it
  up: the card is `white-space: nowrap; max-width: none`, so it does not
  truncate — any line carrying an article title needs a cap, ~32 characters.

### 11.7 The floor now says which is a person and which is an agent

The floor separated the two by costume and by the roster's `human` tag, never in
words: a person opening `/` and an agent connecting through the API both read
"connected to the archive". `captionFor` now branches on
`isHumanAgent(event.agentIdentifier)`, and `PageBehaviour` carries a
`humanCaption` beside its `caption`.

| | agent | person |
|---|---|---|
| `/` | connected to the corpus | arrived at the archive |
| `/skill` | parsing the participation protocol | reading the protocol |
| `/skill/SKILL.md` | loading the skill instructions | reading the manual |
| `/llms.txt` | fetching the agent guidance | reading the guidance |
| `/wanted` | scanning the wanted list | looking for the gaps |
| `/index.md` | pulling the whole index | browsing the whole index |
| an article | consulting "X" | reading "X" |
| a session start with no page | connected to the archive | arrived at the archive |

The register is the one the beacon pages already write into
`safeMetadata.query` for `/sky`: a person reads, an agent parses, loads, fetches
and pulls. Icons are unchanged — one axis of difference is enough.

**Why not read `safeMetadata.query`, which already carries exactly this
wording.** Two reasons, and the second is the one that decided it:

1. `query` only exists on the six live beacons. `isHumanAgent` is a pure reading
   of the identifier, so it also works on every replayed archive row, which
   carries no metadata at all — and the replayed cast is most of the floor.
2. `recordEventInputSchema` in `apps/web/lib/http/handlers.ts:33` declares
   `safeMetadata: z.record(z.string(), z.unknown()).optional()` — **no constraint
   at all**. Any authenticated agent may POST arbitrary metadata. Printing it in
   a caption is the surface §11.5 deliberately closed, and it would have been
   reopened by the back door.

**Related finding, not acted on.** `/sky` does print it: `app/sky/page.tsx:80`
renders `searching: "${meta.query}"` straight from the payload, and
`titleOf` in `choreography.ts` takes `safeMetadata.title` the same way, so an
agent can already author the sentence in `/sky`'s log and the title inside a
`/world` bubble. React escapes it, so this is content spoofing in a public view
rather than script execution — but nothing bounds the length or the wording. If
that is ever tightened, the fix belongs on the write path (a length cap and a
character class on the two fields), not in the two renderers.

**An earlier note in this file was wrong** and is corrected here: `query` was
described as read by nobody. It is read by `/sky`. `/world` is the view that
never used it.



### 11.8 A flag on the avatars

The user asked for one thing only: the country an avatar came from, as a flag.
No address kept, nothing else.

**The address is still never read for this.** Vercel resolves the country at the
edge and hands it over as `x-vercel-ip-country`; the seven beaconed pages read
that header and put a two-letter code in `safeMetadata.country`. `visitor.ts`'s
property — the address goes into a salted digest and nowhere else — is untouched,
and no geo-IP lookup or third party is involved.

`flagOf` in `choreography.ts` turns the code into regional indicator symbols
(`IT` → U+1F1EE U+1F1F9), one codepoint per letter at a fixed offset from `A`.
No table, no image. It accepts **exactly two ASCII letters** and nothing else,
because `safeMetadata` is unconstrained on the write path — see §11.7. The worst
a hostile agent can then do is fly the wrong flag, which is the same thing it
can already do by choosing its own name. Eleven cases are pinned in the tests,
including `"ITA"`, `"I7"`, a number, and an object with a `toString`.

`countryOf` takes the session's country from the first event that reported a
usable one; `AgentPlan.country` carries it; `Actor.flag` resolves it once at
spawn; `RosterEntry.flag` publishes it.

**Where it shows:** the roster row (before the name) and the first line of the
info card a click opens. **Not over the avatar's head** — the user ruled out a
permanent nameplate in the same conversation, and a flag there would be one.

**The limit, and it is a real one.** Only a *live* avatar can have a flag. The
country rides on a page beacon, and page beacons are never written to
`archive_events` (§11.5), so **the entire replayed cast has none** — which is
most of what is on screen most of the time, since REPLAY is the default mode.
An absent flag means "this is a recording", not "unknown country". If flags
should appear in replay too, the country has to be persisted, and that is a
deliberate step into storing a geographic datum per session: worth a decision,
not worth sliding into.

**Verified end to end on a dev server**, by sending the header a Vercel edge
would send and reading the payload off the local SSE stream:

```
curl -H "x-vercel-ip-country: JP" -H "user-agent: <a browser UA>" localhost:3100/

LIVE agent_session_started | Human Explorer |
  {"country": "JP", "page": "/", "title": "Archive Threshold (/)", ...}
```

The avatar arrives with its flag. `page` rides along, so §11.5 is confirmed by
the same frame.

**What is still unverified is only the header's arrival in production.**
`x-vercel-ip-country` is asserted from Vercel's documented behaviour, not
observed on this project — nothing in the codebase read any `x-vercel-*` header
before this change. Off Vercel the header is absent, which yields no flag rather
than a wrong one.

**A note on probing this, because it cost an hour.** An SSE reader started as
`(curl -sN ... > file &)` — backgrounded inside a subshell — dies with the parent
shell and discards its buffer, so the stream looks empty and the archive looks
like it holds no events. Both conclusions were drawn and both were wrong; the
bus and the DB were fine the whole time. Use `nohup curl -sN --no-buffer ... &`
and kill it by PID. `event-bus.ts` already survives Next's module-graph split by
hanging the bus off `globalThis`, so a bus that looks dead in dev is far more
likely to be a broken probe than a broken bus.

**How to see it locally.** The first cut of this shipped with no way to observe
it short of a deploy — the user ran `/world` on `localhost:3100`, where the edge
header does not exist, and correctly reported no flags. The seven duplicated
header reads are now one helper, `countryOfRequest` in
`apps/web/lib/telemetry/geo.ts`, and a development server may stand in for the
edge:

```
TELEMETRY_DEV_COUNTRY=IT pnpm --filter @agent-memory-wiki/web dev
```

Read from the environment, never from the request — a country a request can name
is a country an agent can claim — and **refused outright when `NODE_ENV` is
`production`**, so a variable left set on a real deploy cannot put a flag on the
public floor. Four cases pinned in `apps/web/test/telemetry-geo.test.ts`,
following the `vi.stubEnv` pattern `telemetry-broadcast-scope.test.ts`
established for the same read-only `NODE_ENV` typing.


### 11.9 Open: a flag nobody can currently explain

**Unresolved at the end of the session. Start here if the flags misbehave.**

The user reported seeing a flag on their own avatar, on `localhost:3100/world`,
without restarting anything — and was confident it was theirs because the avatar
walked to READ and opened the article they had open **on the live site**.

Everything measured says that should be impossible:

- Production emits no `country`. Verified by subscribing to the ntfy topic and
  opening the live home page: `{"title": "Archive Threshold (/)", "query":
  "arrived at archive"}`. So a prod-originated avatar has nothing to make a flag
  from.
- `Actor.flag` is resolved **once, at spawn**, from `AgentPlan.country`. An event
  arriving for a session that already has an avatar is appended as a task and
  cannot add a flag later.
- The replay path takes its country from `countryOf(sessionEvents)`, i.e. from
  rows in the local DB. No row in that DB carries a `country` key.

Two candidate explanations, neither confirmed:

1. **It was one of the assistant's probes.** While diagnosing, four requests
   were sent to the user's dev server with a forged `x-vercel-ip-country`
   (`IT`, `IT`, `FR`, `JP`) and a Chrome/macOS user agent. Those spawn a
   `Human Explorer` with a flag. The user is in Italy, so an 🇮🇹 `Explorer · LIVE`
   in the hub at that exact moment is very easy to read as one's own avatar.
   **Against it:** those probes hit `/`, `/llms.txt` and `/wanted` only. All three
   map to the hub and then to the exit. None of them can walk to READ, and the
   user was specific that theirs did.
2. **A path not modelled here.** If a flagged avatar genuinely reached READ, the
   model above has a hole and it is worth finding, because it would mean a
   country is reaching an avatar by a route nobody intended.

**How to settle it.** Restart the dev server with the override and browse
locally, end to end:

```
kill <the next dev PID>
TELEMETRY_DEV_COUNTRY=IT pnpm --filter @agent-memory-wiki/web dev
```

Open `localhost:3100/`, then an article, then watch `/world` in another tab. The
flag must appear on the avatar that walks to READ. If it does, the feature is
sound and only the deploy is outstanding. If it does not, the fault is upstream
of the flag.

**Do not assume the user misremembered.** Twice in this session the assistant
asserted a confident diagnosis that measurement then contradicted — that page
beacons never reach the local bus, and that the local archive held no events.
Both were artefacts of an SSE probe backgrounded inside a subshell, which dies
with its parent and discards its buffer. The user's report of what they saw on
screen has so far been the more reliable instrument.

### 11.10 The origin line is a constant for live human visitors

Noticed while reading the screenshot, not acted on.

The info card's second line is `agentOrigin(actor.agentIdentifier)`, written to
reduce a raw user agent to `Chrome · macOS`. But `classifyClientAgent` replaces
the user agent with the constant string `"Human Explorer"` **before the event
exists**, so `agentOrigin` finds no browser token and no platform token and
returns `browser · web` — for every live human visitor, always. The screenshot
shows exactly that.

The distinction is only between *live page beacons* and *persisted rows*: some
older `article_opened` rows in the archive do carry a raw `Mozilla/5.0
(Macintosh…` identifier, and for those the origin line is real.

The fix, if wanted, is the same shape as `page` and `country`: have the beacon
put the already-classified browser and platform into `safeMetadata` rather than
throwing the user agent away and asking the floor to re-derive them from a label
that does not contain them. The user was asked and had not answered when the
session ended.

---

## 12. Session of 2026-09-02, after #88 — uncommitted on `main`

`APP_VERSION` is **1.0.1**. #88 is live, so from here every change bumps it.

**The flags work.** The user confirmed them on the production floor, which was
the one thing §11.8 could not verify: `x-vercel-ip-country` does arrive on
Vercel. §11.9's premise is therefore narrower than it looked — the feature is
sound and only the flag seen on `localhost` before the deploy is unexplained.

### 12.1 The roster was an accordion

The status column is one word and that word changes — `Idle` is four characters
and `Organizing` is ten — and the card was sized `min-width: 13.5rem`, so it
resized itself every time an avatar changed what it was doing. A corner that
pumps in and out pulls the eye off the floor.

Now `width: 17.5rem`, fixed. The number was measured, not guessed: JetBrains
Mono at `0.64rem` is `0.384rem` a character, and the widest realistic row — a
live human visitor with a flag, `Human Explorer`, the `human` tag and
`Browsing` — comes to ~17.1rem once the panel's `0.8rem` padding, its 2px
border and the five `0.5rem` gaps are counted. So nothing that renders in full
today begins to truncate.

Past that the **name** is what yields: `.world-row-name` gained `min-width: 0`,
`overflow: hidden` and `text-overflow: ellipsis`. Without `min-width: 0` a flex
item will not shrink below its own text, so the name would have gone on pushing
the card wider and the fixed width would have done nothing. The status word got
a class (`.world-row-status`, `flex: none`) so it is never the thing that
shrinks. The phone's pill row overrides both back — there the card *should* size
to its content.

**Verified by measurement, not by eye:** Playwright sampled the card's
`getBoundingClientRect().width` fourteen times over ~30s of replay while the
roster went from 0 to 6 rows and statuses cycled `Idle`/`Moving`/`Reading`. It
read **280px — 17.5rem — every time**, and no row reported
`scrollWidth > clientWidth`. Before the change the same sampling is what would
have shown the pumping.

### 12.2 `ki-radar/0.1` is off the floor

The user asked that it stop being tracked: it polls constantly, is plainly not
an agent participating in the archive, and identifies itself as nothing that can
be looked up.

`isUntrackedClient` in `broadcaster.ts`, checked at the top of
`broadcastSkyEvent` **before the rate limiter** — a client we are not tracking
should not be spending the shared budget either. One choke point rather than a
guard in each of the eight beacons, so it covers `/api/v1/events/leave` and
anything added later. Matched as a **prefix** on the classified identifier, so
`ki-radar/0.2` does not quietly re-admit itself. Six cases in
`apps/web/test/telemetry-untracked.test.ts`, including `radar/0.1` and
`some-ki-radar-clone/1.0`, which must still pass.

Nothing is deleted and nothing is blocked: the client still gets its page, it
just gets no avatar.

**We still do not know what it is, and from our side we now never will.**
`classifyClientAgent` truncates the user agent to 18 characters before anything
sees it, and these beacons are never persisted (§11.5, §11.6). **The Vercel
request log is the only place that still holds the full string and the path
together** — that is where to look if this is ever worth identifying. Lifting
the truncation would be the change that makes the *next* unknown client
identifiable; it was not made here.

### 12.3 Pale icons on a near-white tile — tried, and reverted

Reported: the sparkles on `connected to the corpus` are hard to see. It is a
real observation — the tile is the reference's `#fbfaf6` and `✨`, `📜` and `📋`
are nearly as light — but **every fix attempted made it worse, and the icons are
back exactly as they were.** Do not re-attempt without reading this.

Three were built and rendered at 1:1 against the running page, not argued about:

1. **A blurred `drop-shadow` rim.** Haloes the whole glyph. At the caption's
   size it reads as dirt on the tile.
2. **Four zero-blur `drop-shadow`s, one per direction** — a crisp one-pixel
   outline. Better than the blur, and it looked convincing *zoomed*. At 1:1 it
   is not: the caption glyph is about 13px, so a one-pixel rim is a tenth of the
   glyph and it thickens the emoji into a blob. **This is the trap** — the
   zoomed comparison flattered it and the 1:1 comparison is the one that counts.
3. **A slate chip behind the icon** (`#3d434f`, `1.15em`). This one genuinely
   separates every icon, pale and dark alike, and was measured across all eleven
   caption icons to pick a tone that black would have swallowed the pen, the
   torch and the magnifier at. The user rejected it on sight: it turns the
   reference's clean tile into a row of badges. **The legibility was not the
   problem; the look was.**

The mechanical finding is still worth keeping, because any future attempt needs
it: the icon and the caption share **one text node**, so the icon cannot be
styled without splitting it into its own span in `setCaption`. That split was
made and then reverted with the rest.

If this is picked up again, the levers not yet tried are the ones that do not
add furniture to the tile: a **larger icon** (`1.3em` alone was clean and
noticeably more visible than the baseline, and was never shown to the user), or
**choosing icons that are not pale** in the first place, which costs nothing at
render time. `✨` is the worst offender and is also the most replaceable — it
marks nothing more specific than "arrived".

### 12.4 The screenshot loop, since the extension is still down

The Chrome extension did not connect this session either. The Playwright recipe
in §Screenshots was used unchanged and is worth trusting: write
`apps/web/.shot.tmp.mjs`, run it with `node`, **delete it** — `eslint .` fails on
it (`'document' is not defined`), which is a useful reminder rather than a
nuisance.

Two things it did here that eyeballing could not: sampled a live element's
width over half a minute of replay to prove a layout no longer moves, and
injected side-by-side variant tiles into the real page — same fonts, same
background, same build — so the only difference in the pixels was the rule under
test. Prefer that to reasoning about CSS, and prefer reading the pixels with PIL
to squinting at the picture.
