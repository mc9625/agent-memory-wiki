/**
 * Static floor plan for Wiki World.
 *
 * The four rooms sit at the four cardinal offsets from the hub — READ at -X,
 * EDIT at -Z, LINKS at +Z, ARCHIVE at +X — so that under the 45° isometric
 * camera they land in the four corners of the frame with the hub between them.
 * A diagonal arrangement would stack them along the screen axes instead, which
 * is the single thing that most changes how the shot reads.
 *
 * Because the plan never changes at runtime, navigation is a breadth-first
 * search over a dozen hand-declared waypoints rather than a grid pathfinder.
 *
 * Two rules keep avatars out of the scenery, and both are enforced here rather
 * than by collision detection:
 *   1. Every room declares which of its four sides carry a doorway, and every
 *      route into it crosses one of those sides. `segmentCrossesWall` is what
 *      proves it, and the test suite is what runs the proof.
 *   2. Rooms expose several seats plus a row of standby spots, so two agents
 *      working in the same room never resolve to the same point: latecomers
 *      queue on standby until a seat frees.
 *
 * Coordinates are world units on the XZ plane; Y is up and always 0 for
 * waypoints. The camera looks down the (1, 1, 1) diagonal, so -X renders to the
 * upper left of the screen and +Z to the lower left.
 */

export type RoomId = "hub" | "read" | "edit" | "links" | "archive" | "entrance";

/** The four faces of a room's footprint, named by the axis they face. */
export type Side = "+x" | "-x" | "+z" | "-z";

export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface Room {
  readonly id: RoomId;
  /** Room floor centre. */
  readonly center: Point;
  readonly width: number;
  readonly depth: number;
  /**
   * Places an avatar can occupy, claimed one per agent. The first is also the
   * fallback when every seat is taken.
   */
  readonly seats: readonly Point[];
  /**
   * Where an avatar waits when every seat is taken, claimed one per agent the
   * same way. A queue rather than an overlap: the room holds more agents than
   * it has workstations, and the wait is visible instead of two avatars
   * standing inside each other.
   */
  readonly standby: readonly Point[];
  /** Facing angle (radians) an avatar adopts once seated. 0 looks towards -Z. */
  readonly stationFacing: number;
  /**
   * Where the window cleaner stands, and which way it turns to face the pane.
   *
   * Only the four walled rooms have glass: the plaza and the entrance are open,
   * so a cleaner sent to either of those works the floor instead. The spot is
   * just inside the glazed facade — the same side the doorway is on — rather
   * than at a station, because a rag being wiped in the middle of the room is
   * cleaning nothing.
   */
  readonly glass?: { readonly at: Point; readonly facing: number };
  /**
   * Standing room at the stacks, for an avatar reading the shelf rather than a
   * desk. Only ARCHIVE has any.
   *
   * Not seats, and deliberately not part of the seat/standby queue: a visitor
   * pulling the whole corpus down is not waiting for a desk to free up, and
   * putting it in that queue would have it sit in a chair — which is the one
   * picture of wholesale copying that is wrong. Claimed the same way, so two
   * of them never stand inside each other.
   */
  readonly shelf?: readonly Point[];
  /** True when the room has no walls and the corridor may cross it. */
  readonly open: boolean;
  /** Sides that carry a doorway. Ignored when `open` is true. */
  readonly doorways: readonly Side[];
  readonly label: string;
  /** Sign colour, and the tint the HUD uses for the room. */
  readonly color: number;
}

const ROOM_SIZE = 14;

/**
 * How far each room is pulled in towards the hub, in world units.
 *
 * The plan below is authored at the original spacing, which put 26 units of
 * bare tile between the READ and ARCHIVE facades — nearly two room widths, and
 * roughly twice what the reference art shows. Rather than restate a hundred
 * coordinates at a tighter spacing, every room keeps its authored numbers and
 * this one value slides it along its own axis: READ east, ARCHIVE west, EDIT
 * south, LINKS north. Everything that belongs to a room — its seats, its
 * standby queue, its glass spot, its doorway waypoint, its planters, and the
 * props `environment.ts` dresses it with — moves by the same vector, so the
 * relative geometry inside a room is untouched and only the plaza shrinks.
 *
 * The one room that does not take the full inset is ARCHIVE — see
 * `ARCHIVE_RELIEF`.
 */
export const ROOM_INSET = 5;

/**
 * How much of the inset ARCHIVE gives back.
 *
 * The way out to the entrance runs through the notch between LINKS' east face
 * and ARCHIVE's west one. LINKS used to slide in z alone, which left ARCHIVE's
 * inset setting that corridor's width by itself; LINKS now takes a nudge in x
 * as well, so both reliefs bear on it and the notch is 4.75 rather than 5. At
 * the full inset on both sides it was
 * three units — half of it spoken for by an actor's ±1.2 lane offset. Two units
 * back puts it at five, which is a corridor rather than a gap, at the price of
 * ARCHIVE standing that much further from the hub than the other three. That
 * asymmetry is invisible: the reference does not stand its rooms at equal
 * distances either.
 */
const ARCHIVE_RELIEF = 4.25;

/**
 * How much of the inset LINKS gives back, for a reason of the frame rather than
 * of the floor: LINKS' plaque stands on its west wall, six units up, and at the
 * full inset it covered READ's third armchair. Two units back drops it clear.
 * It went 2 → 3 → 4 by eye, then back to 2.5 in the set editor, where the
 * relief is no longer carrying the plaque on its own: LINKS now takes a nudge
 * of +1.5 in x as well, and +X alone moves a thing up *and* right in equal
 * parts, so the plaque clears the chair to the right rather than by standing
 * further out. Recheck against READ's third armchair if either number moves.
 */
const LINKS_RELIEF = 2.5;

/** Which way each room slides. The hub is the thing they slide towards. */
export const ROOM_SHIFT: Readonly<Record<RoomId, Point>> = {
  read: { x: ROOM_INSET, z: 0 },
  edit: { x: 0, z: ROOM_INSET },
  // These two also carry a nudge across their own axis, set by eye in the set
  // editor. The relief still says how much of the inset the room gives back, so
  // `ROOM_INSET` remains the one knob for the spacing; the cross-axis term is a
  // framing adjustment on top of it and does not scale with the knob.
  links: { x: 1.5, z: -(ROOM_INSET - LINKS_RELIEF) },
  archive: { x: -(ROOM_INSET - ARCHIVE_RELIEF), z: 0.5 },
  /*
   * The fountain is not a room, but it moves the same way: down the screen and
   * a little to its left, to sit under the shifted LINKS rather than square in
   * the middle of a plaza that is no longer square. Its waypoint is tagged to
   * move with it — the plinth's south face and the hub node are only three
   * units apart and every corridor leg crosses that gap, so a fountain that
   * moved south on its own would push the READ leg into its own corner.
   */
  hub: { x: 1, z: 2.75 },
  // The entrance is on the diagonal, so it takes the inset on both axes — but
  // three quarters of it, because it also has to stay south of ARCHIVE's front
  // corner, which does not move in z at all.
  // The reception is the one thing that reads better *out* of the plaza: it sits
  // at the bottom of the frame, where the reference has the building running off
  // the edge. It takes a unit and a half rather than the full inset, which is
  // what keeps the desk's base and its step inside the frame at 16:9.
  entrance: { x: -1.5, z: -1.5 },
};

const shifted = (point: Point, by: Point): Point => ({ x: point.x + by.x, z: point.z + by.z });

/**
 * The floor plan as authored, at the original spacing. `ROOMS` is this plan
 * with `ROOM_SHIFT` applied; `environment.ts` places its props in this frame
 * and lets a parent group carry the shift, so both files stay readable against
 * the same numbers.
 */
export const PLAN_ROOMS: readonly Room[] = [
  {
    // Armchairs face +X, towards the hub and the camera, with the bookshelves
    // on the -Z wall behind them.
    id: "read",
    center: { x: -20, z: -2 },
    width: ROOM_SIZE,
    depth: ROOM_SIZE,
    seats: [
      { x: -22, z: -4 },
      { x: -22, z: 0 },
      { x: -22, z: 4 },
    ],
    standby: [
      { x: -17.5, z: -7 },
      { x: -17.5, z: -3 },
      { x: -17.5, z: 1 },
    ],
    stationFacing: -Math.PI / 2,
    // The pane south of the doorway. The one north of it stands behind the
    // ficus, and a cleaner working that one wipes the plant.
    glass: { at: { x: -14, z: 2.2 }, facing: -Math.PI / 2 },
    open: false,
    doorways: ["+x"],
    label: "READ",
    color: 0x3f9455,
  },
  {
    // Desks line the -Z wall; the writer faces into them, away from the hub.
    id: "edit",
    center: { x: 2, z: -20 },
    width: ROOM_SIZE,
    depth: ROOM_SIZE,
    seats: [
      { x: -1, z: -22 },
      { x: 2, z: -22 },
      { x: 5, z: -22 },
    ],
    standby: [
      { x: -1, z: -17 },
      { x: 2, z: -17 },
      { x: 5, z: -17 },
    ],
    stationFacing: 0,
    // The facade is glazed either side of the opening at x 2; the spot has to
    // be under a pane rather than in the gap, which is a doorway, not glass.
    glass: { at: { x: 7, z: -14 }, facing: Math.PI },
    open: false,
    doorways: ["+z"],
    label: "EDIT",
    color: 0x7d52b8,
  },
  {
    // The wall screen is on the -X wall, so the linker stands facing -X.
    id: "links",
    center: { x: -2, z: 20 },
    width: ROOM_SIZE,
    depth: ROOM_SIZE,
    seats: [
      { x: -6, z: 17 },
      { x: -6, z: 20 },
      { x: -6, z: 23 },
    ],
    standby: [
      { x: -1, z: 17 },
      { x: -1, z: 20 },
      { x: -1, z: 23 },
    ],
    stationFacing: Math.PI / 2,
    glass: { at: { x: 3, z: 14 }, facing: 0 },
    open: false,
    doorways: ["-z"],
    label: "LINKS",
    color: 0x2a9ab2,
  },
  {
    // Nearest the camera, so its shelving stands on the -Z wall: the only side
    // whose inner face the camera can see.
    id: "archive",
    center: { x: 20, z: 2 },
    width: ROOM_SIZE,
    depth: ROOM_SIZE,
    seats: [
      { x: 17, z: -2 },
      { x: 20, z: -2 },
      { x: 23, z: -2 },
    ],
    standby: [
      { x: 17, z: 2 },
      { x: 20, z: 2 },
      { x: 23, z: 2 },
    ],
    stationFacing: 0,
    // The south pane: the north one has the crate stacks in front of it.
    glass: { at: { x: 14, z: 7 }, facing: Math.PI / 2 },
    // A pace off the shelf unit at (19.6, -4.3), which spans x 17.6..21.6, and
    // a pace clear of the desk row at z = -2. `stationFacing` already turns an
    // avatar towards -Z, which is the shelf.
    shelf: [
      { x: 18.2, z: -3.1 },
      { x: 20.0, z: -3.1 },
      { x: 21.8, z: -3.1 },
    ],
    open: false,
    doorways: ["-x"],
    label: "ARCHIVE",
    color: 0xc08a3a,
  },
  {
    // An open plaza: every corridor crosses it. The crystal plinth occupies
    // x ∈ [-2.7, 2.7], z ∈ [-5.7, -0.3], which the waypoints route around.
    id: "hub",
    center: { x: 0, z: 0 },
    width: 12,
    depth: 12,
    seats: [
      { x: -3, z: 3 },
      { x: 0, z: 4 },
      { x: 3, z: 3 },
    ],
    /*
     * Flanking the plinth, not standing behind it. The second and third spots
     * used to sit at z -3 and -4, on the far side of the fountain from the hub
     * waypoint, so the walk out to them ran straight through it — a measured
     * 0.00 that no test could see, because the plinth is deliberately not an
     * obstacle. Both are now south of its south face and well outside its x
     * span, which puts those legs at 1.5 and leaves the queue reading as a
     * queue: three spots down the plaza rather than two hidden behind a
     * fountain.
     */
    standby: [
      { x: -5.5, z: 5 },
      { x: -5.5, z: 0.6 },
      { x: 5.5, z: 0.6 },
    ],
    stationFacing: Math.PI,
    open: true,
    doorways: [],
    label: "HUB",
    color: 0x2a3550,
  },
  {
    id: "entrance",
    center: { x: 14, z: 14 },
    width: 10,
    depth: 8,
    seats: [
      { x: 12, z: 14 },
      { x: 14, z: 14 },
      { x: 16, z: 14 },
    ],
    standby: [
      { x: 12, z: 17 },
      { x: 14, z: 17 },
      { x: 16, z: 17 },
    ],
    stationFacing: Math.PI,
    open: true,
    doorways: [],
    label: "",
    color: 0x2f3540,
  },
];

/**
 * Waypoint graph. Room nodes share the room's id so a path can end on one
 * directly; the `d_*` nodes are the doorways just outside each room, and the
 * `c_*` nodes are the two corridor junctions that exist only to route around
 * the hub plinth and out to the entrance.
 */
const PLAN_WAYPOINTS: Readonly<Record<string, Point>> = {
  read: { x: -21, z: 0 },
  edit: { x: 2, z: -21 },
  links: { x: -5, z: 20 },
  archive: { x: 20, z: 0 },
  /*
   * Four and a half units clear of the plinth's south face, having gone
   * 3 → 3.6 → 4.6. It stops there: the hub room is only fourteen deep and a
   * node much further south is a hub waypoint standing outside the hub.
   *
   * Chasing this number is what `c_w` below exists to stop. The leg that kept
   * grazing the fountain was `d_read`→here, and the target it has to clear rose
   * at the same time: it used to be "more than an avatar's width" (0.55), and
   * it is now `MAX_LANE + AVATAR_CLEARANCE`, **1.75**, because an actor does not
   * walk the centre line — it walks up to 1.2 to one side of it and 0.55 of body
   * reaches past that. Sliding this node could reach 1.67 at best, and only by
   * putting it outside the room. A junction west of the fountain reaches 2.0
   * and leaves the node where it belongs.
   */
  hub: { x: 0, z: 4.6 },
  entrance: { x: 14, z: 14 },

  // Both doorway nodes on the plinth's side of the plaza sit off the middle of
  // their opening: pulling the rooms in shortened these legs without moving the
  // plinth, and a leg that used to pass 1.5 units off its corner passed 0.8.
  // Both openings are six units wide, so there is room to lean away.
  d_read: { x: -12, z: -0.5 },
  d_edit: { x: 3.5, z: -12 },
  d_links: { x: -2, z: 12 },
  d_archive: { x: 12, z: 2 },
};

/** The room each waypoint travels with. The plaza junctions belong to nobody. */
const WAYPOINT_ROOM: Readonly<Record<string, RoomId>> = {
  hub: "hub",
  read: "read",
  d_read: "read",
  edit: "edit",
  d_edit: "edit",
  links: "links",
  d_links: "links",
  archive: "archive",
  d_archive: "archive",
  entrance: "entrance",
};

/*
 * The plaza graph, and the one thing to understand about it: **the fountain is
 * between the hub and two of the four rooms**, so neither READ nor EDIT is
 * reached from the hub in a straight line. Each goes round it — READ by `c_w`
 * to the west, EDIT by `c_e` and `c_ne` to the east.
 *
 * EDIT used to be reached from `hub` straight to `c_ne`, which cut the
 * fountain's south-east corner at 1.59, and READ straight to `d_read`, which
 * cut its north-west one at 1.04. Both are under the 1.75 an actor on the
 * widest lane needs, and the second was wide enough to be seen from the page:
 * agents walked through the water. The direct edges are **gone** rather than
 * kept alongside the new ones, because BFS counts hops and would take the
 * shorter, worse route every time.
 */
const ADJACENCY: Readonly<Record<string, readonly string[]>> = {
  hub: ["c_w", "d_links", "d_archive", "c_e"],
  c_w: ["hub", "d_read"],
  c_ne: ["c_e", "d_edit"],
  c_e: ["hub", "c_s", "c_ne"],
  c_s: ["c_e", "entrance"],
  entrance: ["c_s"],
  d_read: ["c_w", "read"],
  d_edit: ["c_ne", "edit"],
  d_links: ["hub", "links"],
  d_archive: ["hub", "archive"],
  read: ["d_read"],
  edit: ["d_edit"],
  links: ["d_links"],
  archive: ["d_archive"],
};

/**
 * Floor props that stand near a route, as footprints on the XZ plane.
 *
 * Declared here rather than in `environment.ts` because a prop the walk graph
 * does not know about is a prop avatars walk through — the corridor planters and
 * the archive crates both were. `environment.ts` places these, so the model and
 * the plan cannot drift apart, and the layout tests prove no route crosses one.
 *
 * Props an avatar is *meant* to reach — chairs, desks, shelves — are not listed:
 * walking into them is the point.
 */
export type ObstacleKind = "planter" | "crates" | "table" | "fountain";

export interface Obstacle {
  readonly id: string;
  /** The room this prop stands with, and therefore the shift it travels by. */
  readonly room: RoomId;
  /** Footprint centre. */
  readonly x: number;
  readonly z: number;
  /** Footprint extents along X and Z, in world units. */
  readonly width: number;
  readonly depth: number;
  readonly kind: ObstacleKind;
}

/**
 * Half the width an avatar needs to pass a prop without clipping it. The rig is
 * 0.86 across the shoulders, so this is that plus a little air.
 */
export const AVATAR_CLEARANCE = 0.55;

/**
 * The obstacle list as authored, in each prop's own room frame. `environment.ts`
 * places these inside that frame, and `Floor.obstacles` is the same list with
 * the shift applied.
 */
export const PLAN_OBSTACLES: readonly Obstacle[] = [
  // The plaza itself carries no planters. Two used to flank the plinth, and
  // between them and the four corridor pairs the middle of the shot was more
  // hedge than floor. (Only two ever fit anyway: five routes fan out of the hub
  // waypoint, and an earlier third at (4.6, -3) sat squarely on the EDIT route.)

  // Doorway planters: one pair per room facade, laid parallel to the wall and
  // tucked under the glazed panel on either side of the opening, clear of the
  // route that runs through it. Loose in the middle of the plaza they read as
  // dropped at random, because nothing in the plan lines them up.
  { id: "read-planter-n", room: "read", x: -12.2, z: -7, width: 0.95, depth: 3.6, kind: "planter" },
  // Half a unit south of its mirror: the walk in from `c_w` passes this one on
  // the way to READ's doorway and clipped it at 0.80 where it stood. It now
  // overhangs the glazed panel it is tucked under by 0.3, which is the price.
  {
    id: "read-planter-s",
    room: "read",
    x: -12.2,
    z: 3.5,
    width: 0.95,
    depth: 3.6,
    kind: "planter",
  },
  { id: "edit-planter-w", room: "edit", x: -3, z: -12.2, width: 3.6, depth: 0.95, kind: "planter" },
  { id: "edit-planter-e", room: "edit", x: 7, z: -12.2, width: 3.6, depth: 0.95, kind: "planter" },

  // Cloned from `read-planter-s` in the set editor and walked across the plaza
  // to stand behind LINKS' north wall, then turned a quarter turn so it runs
  // along X. It keeps READ's frame, which is the frame the prop it was copied
  // from lives in — so it travels with READ despite standing nowhere near it.
  { id: "links-hedge-n", room: "read", x: -5, z: 25.75, width: 3.6, depth: 0.95, kind: "planter" },

  // READ's low table, moved off the line the doorway takes to the armchairs.
  // Turned a quarter turn in the set editor, so the 1.8 now runs along Z. Its z
  // came back from 0.75 to 3.5: at 0.75 it stood in the middle of the fan of
  // legs out of READ's own waypoint and measured 0.00 against four of them,
  // including the walk in through the doorway. This is the third time this
  // table has had to be moved off that line.
  { id: "read-table", room: "read", x: -18.75, z: 3.5, width: 1.1, depth: 1.8, kind: "table" },

  // ARCHIVE's cardboard. The first stack used to stand in the doorway.
  {
    id: "archive-crates-w",
    room: "archive",
    x: 15.2,
    z: -3.6,
    width: 2.4,
    depth: 1.1,
    kind: "crates",
  },
  {
    id: "archive-crates-e",
    room: "archive",
    x: 24.4,
    z: -3.4,
    width: 2.4,
    depth: 1.1,
    kind: "crates",
  },
];

/**
 * A footprint that is measured but not placed.
 *
 * `PLAN_OBSTACLES` above is a *placement* list: `environment.ts` draws a prop
 * for every entry in it, so a prop that file already authors by hand cannot be
 * added there without drawing it twice. Yet the hand-authored props are exactly
 * the ones that have been caught standing on a route. The concourse kiosk sat
 * on the leg out to `entrance standby 1` at a measured 0.00 for as long as the
 * concourse has been dressed, and LINKS' side table landed on that room's third
 * standby spot the moment the set editor moved it — neither was visible on
 * screen and neither was in any list, so nothing could report them.
 *
 * This is the other half of the pair: a footprint per hand-placed prop that
 * stands on open floor near a route. `validate.ts` measures these and nothing
 * places them.
 *
 * It deliberately does **not** change pathing. `findPath` still routes around
 * `PLAN_OBSTACLES` alone; a prop listed here is something the clearance test
 * reports, not something the graph swerves for. That is the same division the
 * set editor draws — measure everything, and let a human decide what to move.
 *
 * Two things to know before adding to it. The footprint is the prop's *widest*
 * part at the height an avatar occupies, which for the tall planters is the
 * canopy rather than the pot; and a prop placed at a rotation needs the bound of
 * the rotated box, not the authored width and depth. The cost of the list is a
 * second place to edit when one of these moves, which is the trade the waypoint
 * table already makes — the test is what catches the drift.
 *
 * It is not exhaustive: it covers the plaza and concourse dressing, and the
 * props inside a room that sit on the way to its seats. Furniture an avatar is
 * meant to walk up to is left out on purpose, as it is above.
 */
export interface Footprint {
  /** A readable name, which is what the clearance report prints. */
  readonly id: string;
  /**
   * The positional id `environment.ts` stamps on the object this measures —
   * `plant-tall#1` is the first prop of that key placed.
   *
   * This is what ties the footprint to the thing on screen, and it is what the
   * set editor looks a selection up by: without it a prop dragged in `?edit=1`
   * moves in the frame while its footprint stays behind, which is the exact
   * failure the list exists to catch. If a `place` call of the same key is ever
   * inserted *above* one of these, the numbering shifts and these have to shift
   * with it — the ids are positional because that is how the export names them.
   */
  readonly prop: string;
  /** The room this prop travels with, or null when it is placed at the root. */
  readonly room: RoomId | null;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
}

export const PLAN_SCENERY: readonly Footprint[] = [
  // The plaza and concourse dressing, which belongs to no room but the two
  // props that hug a facade and therefore travel with it.
  { id: "kiosk", prop: "kiosk#1", room: null, x: 10.25, z: 22, width: 1.56, depth: 1.56 },
  {
    id: "info-pillar",
    prop: "info-pillar#1",
    room: "archive",
    x: 14.25,
    z: -1.25,
    width: 1.0,
    depth: 1.0,
  },
  {
    id: "plant-small-w",
    prop: "plant-small#4",
    room: null,
    x: -7.75,
    z: 6.0,
    width: 0.62,
    depth: 0.62,
  },
  {
    id: "plant-small-e",
    prop: "plant-small#5",
    room: null,
    x: -6.75,
    z: 9.75,
    width: 0.62,
    depth: 0.62,
  },
  {
    id: "plant-tall-nw",
    prop: "plant-tall#2",
    room: null,
    x: -17.75,
    z: 11.25,
    width: 1.7,
    depth: 1.7,
  },
  {
    id: "plant-tall-se",
    prop: "plant-tall#3",
    room: null,
    x: 11.25,
    z: -14.75,
    width: 1.7,
    depth: 1.7,
  },
  {
    id: "plant-tall-links",
    prop: "plant-tall#1",
    room: "links",
    x: -19.75,
    z: 9.75,
    width: 1.7,
    depth: 1.7,
  },

  /*
   * LINKS' lounge corner, which the set editor moved to the side of the room
   * the doorway legs run down.
   *
   * The table went back beside its chair, from (-7.25, 20) to (-6, 14.5). Where
   * the editor left it it stood 0.65 off the walk into LINKS' middle seat — the
   * tightest thing on the floor. Nothing was walking through it: the last leg
   * of a walk carries no lane offset (`legTarget` in `world-canvas.tsx` returns
   * the seat itself), so the bar for a seat leg is a body's width and 0.65
   * cleared it. But it was the next thing that would have gone wrong, and a
   * side table belongs beside the chair rather than four units from it. It now
   * measures 1.55, with 0.15 between the two footprints.
   */
  /*
   * The eight ficus, which used to stand outside this list and were therefore
   * measured by nothing. One of them — `plant-ficus#7`, in ARCHIVE — stood on
   * the spot the glass leg walks out to, at a measured 0.00, and neither the
   * clearance test nor the editor's own readout said a word: the readout names
   * the tightest leg on the floor, and the tightest leg on the floor was some
   * crates in another corner. Registered here, they are measured like the rest
   * of the dressing.
   *
   * The footprint is the planter's lip, 1.2 square, which is the widest part of
   * the prop an avatar can walk into. The crown is a metre and a half over its
   * head.
   */
  {
    id: "ficus-read-ne",
    prop: "plant-ficus#1",
    room: "read",
    x: -14.6,
    z: -7.4,
    width: 1.2,
    depth: 1.2,
  },
  {
    id: "ficus-read-nw",
    prop: "plant-ficus#2",
    room: "read",
    x: -25.6,
    z: -6.6,
    width: 1.2,
    depth: 1.2,
  },
  {
    id: "ficus-edit-ne",
    prop: "plant-ficus#3",
    room: "edit",
    x: 8.0,
    z: -25.8,
    width: 1.2,
    depth: 1.2,
  },
  {
    id: "ficus-edit-sw",
    prop: "plant-ficus#4",
    room: "edit",
    x: -3.6,
    z: -14.4,
    width: 1.2,
    depth: 1.2,
  },
  {
    id: "ficus-links-sw",
    prop: "plant-ficus#5",
    room: "links",
    x: -7.5,
    z: 25.75,
    width: 1.2,
    depth: 1.2,
  },
  {
    id: "ficus-links-se",
    prop: "plant-ficus#6",
    room: "links",
    x: 3.6,
    z: 26.0,
    width: 1.2,
    depth: 1.2,
  },
  {
    id: "ficus-archive-sw",
    prop: "plant-ficus#7",
    room: "archive",
    x: 17,
    z: 7.75,
    width: 1.2,
    depth: 1.2,
  },
  {
    id: "ficus-archive-ne",
    prop: "plant-ficus#8",
    room: "archive",
    x: 26.0,
    z: 1.25,
    width: 1.2,
    depth: 1.2,
  },
  {
    id: "lounge-chair",
    prop: "lounge-chair#1",
    room: "links",
    x: -7.5,
    z: 15,
    width: 1.4,
    depth: 1.5,
  },
  {
    id: "lounge-table",
    prop: "lounge-table#1",
    room: "links",
    x: -6,
    z: 14.5,
    width: 1.2,
    depth: 1.9,
  },
];

interface WallBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly doorways: readonly Side[];
}

/**
 * The plan position of the hub fountain, in the hub's own frame.
 *
 * It used to be the one solid thing on the floor that was deliberately *not* an
 * obstacle: two of the hub's standby spots stood behind it, so listing it would
 * have made `findPath` unable to reach them and failed the route tests rather
 * than fixed anything. Those two spots have since been re-authored beside the
 * fountain instead of behind it, which is what that note said the fix was — so
 * the exception has been retired and `deriveFloor` puts the fountain in
 * `Floor.obstacles` with everything else. It is still placed by the hub's own
 * dressing rather than from `PLAN_OBSTACLES`, which is a placement list.
 *
 * 6.2 across is the base slab in `furniture.ts`'s `hubPlinth`, which is its
 * widest part, and (0, -3) is where `environment.ts` places it.
 */
const PLAN_PLINTH = { x: 0, z: -3, width: 6.2, depth: 6.2 } as const;

/* ------------------------------------------------------------ the derivation */

/**
 * One arrangement of the floor: the authored plan with a set of room shifts
 * applied to everything that travels with a room.
 *
 * There is exactly one of these in the page — `DEFAULT_FLOOR`, built from
 * `ROOM_SHIFT`, and the exports below are its fields. It is a value rather than
 * a set of module constants so that a *candidate* arrangement can be derived
 * and measured without touching the one the scene is built from: moving a room
 * shortens corridors, and whether that leaves an avatar room to pass is a
 * question `validate.ts` answers by walking a floor, not by looking at one.
 */
export interface Floor {
  readonly shift: Readonly<Record<RoomId, Point>>;
  readonly rooms: readonly Room[];
  readonly waypoints: Readonly<Record<string, Point>>;
  readonly obstacles: readonly Obstacle[];
  /** Footprints that are measured but not placed. See `PLAN_SCENERY`. */
  readonly scenery: readonly Footprint[];
  /** The fountain's footprint, shifted with the hub. */
  readonly plinth: {
    readonly x: number;
    readonly z: number;
    readonly width: number;
    readonly depth: number;
  };
  readonly room: (id: RoomId) => Room;
  /** Room footprints with their doorways, which is what wall crossing tests. */
  readonly wallBoxes: readonly WallBox[];
}

export const deriveFloor = (shift: Readonly<Record<RoomId, Point>>): Floor => {
  const rooms: readonly Room[] = PLAN_ROOMS.map((room) => {
    const by = shift[room.id];
    return {
      ...room,
      center: shifted(room.center, by),
      seats: room.seats.map((seat) => shifted(seat, by)),
      standby: room.standby.map((spot) => shifted(spot, by)),
      ...(room.glass ? { glass: { ...room.glass, at: shifted(room.glass.at, by) } } : {}),
      ...(room.shelf ? { shelf: room.shelf.map((spot) => shifted(spot, by)) } : {}),
    };
  });

  const index = new Map<RoomId, Room>(rooms.map((room) => [room.id, room]));
  const room = (id: RoomId): Room => {
    const found = index.get(id);
    if (!found) throw new Error(`Unknown room: ${id}`);
    return found;
  };

  /*
   * ARCHIVE's west facade is the east edge of the plaza and the one thing the
   * two corridor junctions have to stay clear of; LINKS' east facade is the
   * other side of the channel out to the entrance; and the middle of that
   * channel is the tightest thing on the floor, which is what `ARCHIVE_RELIEF`
   * exists to widen. All three are read off the rooms rather than written down,
   * so they cannot drift from whatever the shifts are set to.
   */
  const archiveFaceX = room("archive").center.x - room("archive").width / 2;
  const linksFaceX = room("links").center.x + room("links").width / 2;
  const notchX = (linksFaceX + archiveFaceX) / 2;
  // The fountain, in world coordinates: `c_w` is measured off it.
  const plinthX = PLAN_PLINTH.x + shift.hub.x;
  const plinthZ = PLAN_PLINTH.z + shift.hub.z;

  const waypoints: Readonly<Record<string, Point>> = {
    ...Object.fromEntries(
      Object.entries(PLAN_WAYPOINTS).map(([id, point]) => {
        const owner = WAYPOINT_ROOM[id];
        return [id, owner ? shifted(point, shift[owner]) : point];
      }),
    ),

    /*
     * The two junctions that exist only to walk round the fountain.
     *
     * `c_w` is measured off the plinth itself rather than written down, so it
     * follows the fountain wherever the hub shift puts it: a unit and a half
     * west of its west face, and a little past its south one. From there the
     * leg in from READ's doorway never reaches the fountain's x range at all,
     * and the leg on to the hub clears its corner. The single leg those two
     * replace measured 1.04 — an actor on the widest lane walking through the
     * water, which is what was reported from the running page.
     *
     * The offsets are the pair that clears the fountain *and* READ's south
     * doorway planter, which the new route runs past on its way in. Further
     * west or further south each buys fountain clearance at the planter's
     * expense; this is the corner of that trade where both are clear.
     */
    c_w: { x: plinthX - PLAN_PLINTH.width / 2 - 1.5, z: plinthZ + PLAN_PLINTH.depth / 2 + 1.2 },
    // EDIT's corner, reached from `c_e` rather than from the hub: the leg
    // straight out to it cut the fountain's south-east corner, and `c_e`
    // already stands south of the fountain with a clear run to both.
    c_ne: { x: archiveFaceX - 2, z: 0 },
    // The way out to the entrance runs through the notch between LINKS' east
    // face and ARCHIVE's west one, and it takes two nodes rather than one: the
    // hub sits on the same 45° diagonal as LINKS' corner, so a single node in
    // the notch draws a leg straight over that corner. Down the middle of the
    // channel and then out, which is also what a corridor between two rooms
    // looks like.
    c_e: { x: notchX, z: 4 },
    c_s: { x: notchX, z: 11 },
  };

  return {
    shift,
    rooms,
    waypoints,
    room,
    obstacles: PLAN_OBSTACLES.map((obstacle) => {
      const by = shift[obstacle.room];
      return { ...obstacle, x: obstacle.x + by.x, z: obstacle.z + by.z };
    }).concat({
      id: "plinth",
      room: "hub" as const,
      x: PLAN_PLINTH.x + shift.hub.x,
      z: PLAN_PLINTH.z + shift.hub.z,
      width: PLAN_PLINTH.width,
      depth: PLAN_PLINTH.depth,
      kind: "fountain" as const,
    }),
    scenery: PLAN_SCENERY.map((prop) => {
      const by = prop.room === null ? { x: 0, z: 0 } : shift[prop.room];
      return { ...prop, x: prop.x + by.x, z: prop.z + by.z };
    }),
    plinth: {
      ...PLAN_PLINTH,
      x: PLAN_PLINTH.x + shift.hub.x,
      z: PLAN_PLINTH.z + shift.hub.z,
    },
    wallBoxes: rooms
      .filter((candidate) => !candidate.open)
      .map((candidate) => ({
        minX: candidate.center.x - candidate.width / 2,
        maxX: candidate.center.x + candidate.width / 2,
        minZ: candidate.center.z - candidate.depth / 2,
        maxZ: candidate.center.z + candidate.depth / 2,
        doorways: candidate.doorways,
      })),
  };
};

/** The floor the page is built from. */
export const DEFAULT_FLOOR = deriveFloor(ROOM_SHIFT);

export const ROOMS = DEFAULT_FLOOR.rooms;
export const WAYPOINTS = DEFAULT_FLOOR.waypoints;
export const OBSTACLES = DEFAULT_FLOOR.obstacles;
export const HUB_PLINTH = DEFAULT_FLOOR.plinth;
export const getRoom = DEFAULT_FLOOR.room;

const EPSILON = 1e-6;

/**
 * True when the straight segment between two points would enter or leave a
 * room through a side that carries no doorway.
 *
 * Used by the layout tests rather than at runtime: the graph is authored so
 * this never happens, and the test is what keeps it that way when the plan
 * changes. Takes a floor so a candidate arrangement can be tested before it
 * becomes the one the page is built from.
 */
export const segmentCrossesWall = (
  from: Point,
  to: Point,
  floor: Floor = DEFAULT_FLOOR,
): boolean => {
  const inside = (point: Point, box: WallBox): boolean =>
    point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ;

  for (const box of floor.wallBoxes) {
    const fromInside = inside(from, box);
    const toInside = inside(to, box);
    if (fromInside === toInside) continue;

    // Exactly one end is inside, so the segment crosses the boundary once.
    // Find which of the four faces it passes through.
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const candidates: readonly { side: Side; t: number }[] = [
      { side: "-x", t: Math.abs(dx) < EPSILON ? -1 : (box.minX - from.x) / dx },
      { side: "+x", t: Math.abs(dx) < EPSILON ? -1 : (box.maxX - from.x) / dx },
      { side: "-z", t: Math.abs(dz) < EPSILON ? -1 : (box.minZ - from.z) / dz },
      { side: "+z", t: Math.abs(dz) < EPSILON ? -1 : (box.maxZ - from.z) / dz },
    ];

    for (const candidate of candidates) {
      if (candidate.t < 0 || candidate.t > 1) continue;
      const x = from.x + dx * candidate.t;
      const z = from.z + dz * candidate.t;
      const onFace =
        x >= box.minX - EPSILON &&
        x <= box.maxX + EPSILON &&
        z >= box.minZ - EPSILON &&
        z <= box.maxZ + EPSILON;
      if (!onFace) continue;
      if (!box.doorways.includes(candidate.side)) return true;
    }
  }
  return false;
};

/**
 * True when the straight segment between two points passes within `clearance`
 * of an obstacle. Slab test against the inflated footprint.
 */
export const segmentHitsObstacle = (
  from: Point,
  to: Point,
  clearance: number = AVATAR_CLEARANCE,
  floor: Floor = DEFAULT_FLOOR,
): boolean => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;

  for (const obstacle of floor.obstacles) {
    const bounds: readonly (readonly [number, number, number, number])[] = [
      [
        from.x,
        dx,
        obstacle.x - obstacle.width / 2 - clearance,
        obstacle.x + obstacle.width / 2 + clearance,
      ],
      [
        from.z,
        dz,
        obstacle.z - obstacle.depth / 2 - clearance,
        obstacle.z + obstacle.depth / 2 + clearance,
      ],
    ];

    let enter = 0;
    let exit = 1;
    let missed = false;
    for (const [origin, delta, min, max] of bounds) {
      if (Math.abs(delta) < EPSILON) {
        if (origin < min || origin > max) missed = true;
        continue;
      }
      const first = (min - origin) / delta;
      const second = (max - origin) / delta;
      enter = Math.max(enter, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
      if (enter > exit) missed = true;
    }
    if (!missed) return true;
  }
  return false;
};

/**
 * Shortest waypoint path between two nodes, inclusive of both ends. Returns an
 * empty array when either node is unknown or unreachable.
 */
export const findPath = (
  from: string,
  to: string,
  floor: Floor = DEFAULT_FLOOR,
): readonly Point[] => {
  if (!(from in ADJACENCY) || !(to in ADJACENCY)) return [];
  if (from === to) {
    const only = floor.waypoints[to];
    return only ? [only] : [];
  }

  const previous = new Map<string, string>();
  const visited = new Set<string>([from]);
  const queue: string[] = [from];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (current === to) break;

    for (const next of ADJACENCY[current] ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      previous.set(next, current);
      queue.push(next);
    }
  }

  if (!visited.has(to)) return [];

  const nodes: string[] = [to];
  let cursor = to;
  while (cursor !== from) {
    const parent = previous.get(cursor);
    if (parent === undefined) return [];
    nodes.push(parent);
    cursor = parent;
  }
  nodes.reverse();

  const points: Point[] = [];
  for (const node of nodes) {
    const point = floor.waypoints[node];
    if (point) points.push(point);
  }
  return points;
};
