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
 *   2. Rooms expose several seats, so two agents working in the same room never
 *      resolve to the same point.
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
  /** Facing angle (radians) an avatar adopts once seated. 0 looks towards -Z. */
  readonly stationFacing: number;
  /** True when the room has no walls and the corridor may cross it. */
  readonly open: boolean;
  /** Sides that carry a doorway. Ignored when `open` is true. */
  readonly doorways: readonly Side[];
  readonly label: string;
  /** Sign colour, and the tint the HUD uses for the room. */
  readonly color: number;
}

const ROOM_SIZE = 14;

export const ROOMS: readonly Room[] = [
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
    stationFacing: -Math.PI / 2,
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
    stationFacing: 0,
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
    stationFacing: Math.PI / 2,
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
    stationFacing: 0,
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
    stationFacing: Math.PI,
    open: true,
    doorways: [],
    label: "",
    color: 0x2f3540,
  },
];

const roomIndex = new Map<RoomId, Room>(ROOMS.map((room) => [room.id, room]));

export const getRoom = (id: RoomId): Room => {
  const room = roomIndex.get(id);
  if (!room) throw new Error(`Unknown room: ${id}`);
  return room;
};

/**
 * Waypoint graph. Room nodes share the room's id so a path can end on one
 * directly; the `d_*` nodes are the doorways just outside each room, and the
 * `c_*` nodes are the two corridor junctions that exist only to route around
 * the hub plinth and out to the entrance.
 */
export const WAYPOINTS: Readonly<Record<string, Point>> = {
  read: { x: -21, z: 0 },
  edit: { x: 2, z: -21 },
  links: { x: -5, z: 20 },
  archive: { x: 20, z: 0 },
  hub: { x: 0, z: 3 },
  entrance: { x: 14, z: 14 },

  d_read: { x: -12, z: -2 },
  d_edit: { x: 2, z: -12 },
  d_links: { x: -2, z: 12 },
  d_archive: { x: 12, z: 2 },

  // EDIT is the one room the hub cannot reach in a straight line: the plinth
  // sits between them, so the route steps out to the east first.
  c_ne: { x: 5.5, z: 0 },
  c_se: { x: 7, z: 7 },
};

const ADJACENCY: Readonly<Record<string, readonly string[]>> = {
  hub: ["d_read", "d_links", "d_archive", "c_ne", "c_se"],
  c_ne: ["hub", "d_edit"],
  c_se: ["hub", "entrance"],
  entrance: ["c_se"],
  d_read: ["hub", "read"],
  d_edit: ["c_ne", "edit"],
  d_links: ["hub", "links"],
  d_archive: ["hub", "archive"],
  read: ["d_read"],
  edit: ["d_edit"],
  links: ["d_links"],
  archive: ["d_archive"],
};

interface WallBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly doorways: readonly Side[];
}

const wallBoxes: readonly WallBox[] = ROOMS.filter((room) => !room.open).map((room) => ({
  minX: room.center.x - room.width / 2,
  maxX: room.center.x + room.width / 2,
  minZ: room.center.z - room.depth / 2,
  maxZ: room.center.z + room.depth / 2,
  doorways: room.doorways,
}));

const EPSILON = 1e-6;

/**
 * True when the straight segment between two points would enter or leave a
 * room through a side that carries no doorway.
 *
 * Used by the layout tests rather than at runtime: the graph is authored so
 * this never happens, and the test is what keeps it that way when the plan
 * changes.
 */
export const segmentCrossesWall = (from: Point, to: Point): boolean => {
  const inside = (point: Point, box: WallBox): boolean =>
    point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ;

  for (const box of wallBoxes) {
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

export const OBSTACLES: readonly Obstacle[] = [
  // The plaza itself carries no planters. Two used to flank the plinth, and
  // between them and the four corridor pairs the middle of the shot was more
  // hedge than floor. (Only two ever fit anyway: five routes fan out of the hub
  // waypoint, and an earlier third at (4.6, -3) sat squarely on the EDIT route.)

  // Doorway planters: one pair per room facade, laid parallel to the wall and
  // tucked under the glazed panel on either side of the opening, clear of the
  // route that runs through it. Loose in the middle of the plaza they read as
  // dropped at random, because nothing in the plan lines them up.
  { id: "read-planter-n", x: -12.2, z: -7, width: 0.95, depth: 3.6, kind: "planter" },
  { id: "read-planter-s", x: -12.2, z: 3, width: 0.95, depth: 3.6, kind: "planter" },
  { id: "edit-planter-w", x: -3, z: -12.2, width: 3.6, depth: 0.95, kind: "planter" },
  { id: "edit-planter-e", x: 7, z: -12.2, width: 3.6, depth: 0.95, kind: "planter" },

  // READ's low table, moved off the line the doorway takes to the armchairs.
  { id: "read-table", x: -18.6, z: 2.6, width: 1.8, depth: 1.1, kind: "table" },

  // ARCHIVE's cardboard. The first stack used to stand in the doorway.
  { id: "archive-crates-w", x: 15.2, z: -3.6, width: 2.4, depth: 1.1, kind: "crates" },
  { id: "archive-crates-e", x: 24.4, z: -3.4, width: 2.4, depth: 1.1, kind: "crates" },
];

/**
 * True when the straight segment between two points passes within `clearance`
 * of an obstacle. Slab test against the inflated footprint.
 */
export const segmentHitsObstacle = (
  from: Point,
  to: Point,
  clearance: number = AVATAR_CLEARANCE,
): boolean => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;

  for (const obstacle of OBSTACLES) {
    const bounds: readonly (readonly [number, number, number, number])[] = [
      [from.x, dx, obstacle.x - obstacle.width / 2 - clearance, obstacle.x + obstacle.width / 2 + clearance],
      [from.z, dz, obstacle.z - obstacle.depth / 2 - clearance, obstacle.z + obstacle.depth / 2 + clearance],
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
export const findPath = (from: string, to: string): readonly Point[] => {
  if (!(from in ADJACENCY) || !(to in ADJACENCY)) return [];
  if (from === to) {
    const only = WAYPOINTS[to];
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
    const point = WAYPOINTS[node];
    if (point) points.push(point);
  }
  return points;
};
