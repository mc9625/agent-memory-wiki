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
 * The way out to the entrance runs through the notch between LINKS' east face,
 * which never moves off x 5 because LINKS slides in z, and ARCHIVE's west face.
 * So ARCHIVE's inset alone sets that corridor's width, and at the full 5 it was
 * three units — half of it spoken for by an actor's ±1.2 lane offset. Two units
 * back puts it at five, which is a corridor rather than a gap, at the price of
 * ARCHIVE standing two units further from the hub than the other three. That
 * asymmetry is invisible: the reference does not stand its rooms at equal
 * distances either.
 */
const ARCHIVE_RELIEF = 2;

/**
 * How much of the inset LINKS gives back, for a reason of the frame rather than
 * of the floor: LINKS' plaque stands on its west wall, six units up, and at the
 * full inset it covered READ's third armchair. Two units back drops it clear.
 * It went 2 → 3 → 4 by eye. At 2 the plaque cleared the chair but the wall
 * itself, six units up, still hid it. The unit of -X that came with the first
 * two steps has since been given back: +Z alone moves a thing down *and* left in
 * equal parts, so -X buys left and the last step was asked for as straight down.
 */
const LINKS_RELIEF = 4;

/** Which way each room slides. The hub is the thing they slide towards. */
export const ROOM_SHIFT: Readonly<Record<RoomId, Point>> = {
  read: { x: ROOM_INSET, z: 0 },
  edit: { x: 0, z: ROOM_INSET },
  links: { x: 0, z: -(ROOM_INSET - LINKS_RELIEF) },
  archive: { x: -(ROOM_INSET - ARCHIVE_RELIEF), z: 0 },
  /*
   * The fountain is not a room, but it moves the same way: down the screen and
   * a little to its left, to sit under the shifted LINKS rather than square in
   * the middle of a plaza that is no longer square. Its waypoint is tagged to
   * move with it — the plinth's south face and the hub node are only three
   * units apart and every corridor leg crosses that gap, so a fountain that
   * moved south on its own would push the READ leg into its own corner.
   */
  hub: { x: 0.6, z: 1.6 },
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
    standby: [
      { x: -5.5, z: 5 },
      { x: -5.5, z: -3 },
      { x: 5.5, z: -4 },
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
  // Three and a half units clear of the plinth's south face, not three: every
  // corridor leg starts here and passes the plinth's corner, and the fountain's
  // own shift ate half the margin those legs had.
  hub: { x: 0, z: 3.6 },
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

const ADJACENCY: Readonly<Record<string, readonly string[]>> = {
  hub: ["d_read", "d_links", "d_archive", "c_ne", "c_e"],
  c_ne: ["hub", "d_edit"],
  c_e: ["hub", "c_s"],
  c_s: ["c_e", "entrance"],
  entrance: ["c_s"],
  d_read: ["hub", "read"],
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
export type ObstacleKind = "planter" | "crates" | "table";

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

const PLAN_OBSTACLES: readonly Obstacle[] = [
  // The plaza itself carries no planters. Two used to flank the plinth, and
  // between them and the four corridor pairs the middle of the shot was more
  // hedge than floor. (Only two ever fit anyway: five routes fan out of the hub
  // waypoint, and an earlier third at (4.6, -3) sat squarely on the EDIT route.)

  // Doorway planters: one pair per room facade, laid parallel to the wall and
  // tucked under the glazed panel on either side of the opening, clear of the
  // route that runs through it. Loose in the middle of the plaza they read as
  // dropped at random, because nothing in the plan lines them up.
  { id: "read-planter-n", room: "read", x: -12.2, z: -7, width: 0.95, depth: 3.6, kind: "planter" },
  { id: "read-planter-s", room: "read", x: -12.2, z: 3, width: 0.95, depth: 3.6, kind: "planter" },
  { id: "edit-planter-w", room: "edit", x: -3, z: -12.2, width: 3.6, depth: 0.95, kind: "planter" },
  { id: "edit-planter-e", room: "edit", x: 7, z: -12.2, width: 3.6, depth: 0.95, kind: "planter" },

  // READ's low table, moved off the line the doorway takes to the armchairs.
  { id: "read-table", room: "read", x: -18.6, z: 2.6, width: 1.8, depth: 1.1, kind: "table" },

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
 * The fountain is the one solid thing on the floor that is deliberately *not*
 * an obstacle: two of the hub's standby spots stand behind it, so listing it
 * would make `findPath` unable to reach them and would fail the route tests
 * rather than fix anything. The fix is to re-author those two spots beside it,
 * and nothing has asked for it. But every corridor leg passes its corner, so a
 * floor plan that cannot say where it is cannot be measured: `validate.ts`
 * reads it from here.
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

  const waypoints: Readonly<Record<string, Point>> = {
    ...Object.fromEntries(
      Object.entries(PLAN_WAYPOINTS).map(([id, point]) => {
        const owner = WAYPOINT_ROOM[id];
        return [id, owner ? shifted(point, shift[owner]) : point];
      }),
    ),

    // EDIT is the one room the hub cannot reach in a straight line: the plinth
    // sits between them, so the route steps out to the east first.
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
