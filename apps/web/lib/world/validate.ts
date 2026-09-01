/**
 * How close the walk graph passes to the scenery.
 *
 * `layout.ts` answers "does this leg cross a wall or clip a prop" with a
 * boolean, which is what the route tests need. This module answers "by how
 * much", which is what a human moving a room needs — and the difference is not
 * academic. Twice now the floor has shipped a leg that grazed a corner at a
 * measured 0.00 and a leg that ran through the hub plinth, and neither was
 * visible in a screenshot of an empty floor: a boolean test that only knows
 * about `OBSTACLES` sees neither, because the plinth is not one and a corner is
 * not a crossing.
 *
 * So the measurement lives here as a module rather than as the throwaway script
 * it has twice been, and the test beside it pins the numbers. Nothing here runs
 * in the page.
 */

import { DEFAULT_FLOOR, findPath, type Floor, type Point } from "./layout";

/** An axis-aligned footprint on the XZ plane. */
export interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Something an avatar is not meant to walk into.
 *
 * `enterable` marks a footprint a route is *allowed* to end inside — a room is
 * entered through its doorway, so a leg with an endpoint in it is a leg doing
 * its job. A prop is never enterable, so a leg that reaches one measures zero
 * and is reported.
 */
export interface Hazard {
  readonly id: string;
  readonly rect: Rect;
  readonly enterable: boolean;
}

/** One straight walk between two points, named by where it came from. */
export interface Leg {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
}

export interface Clearance {
  readonly leg: string;
  readonly hazard: string;
  /** Distance from the leg's centre line to the footprint, in world units. */
  readonly distance: number;
}

/**
 * The widest lane offset in `world-canvas.tsx`.
 *
 * Actors do not walk the centre line: each takes a lateral offset so a crowd
 * heading the same way travels side by side instead of fighting over one
 * waypoint. Everything below is measured on the centre line, so this is the
 * budget to read a figure against — but not a number to subtract from it. The
 * offset is perpendicular to the leg, so it eats into a clearance only where
 * the scenery lies to the leg's side; a doorway node standing a unit off its
 * own facade is not brought any closer to it by a lane running past it.
 */
export const MAX_LANE = 1.2;

/* ---------------------------------------------------------------- geometry */

const pointInRect = (point: Point, rect: Rect): boolean =>
  point.x >= rect.minX && point.x <= rect.maxX && point.z >= rect.minZ && point.z <= rect.maxZ;

/** Distance from a point to a segment, clamped at both ends. */
const pointToSegment = (point: Point, from: Point, to: Point): number => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - from.x, point.z - from.z);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared),
  );
  return Math.hypot(point.x - (from.x + dx * t), point.z - (from.z + dz * t));
};

const cross = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/**
 * Distance between two segments.
 *
 * Only a *proper* crossing is tested for: when the two merely touch or lie
 * along each other, one of the four point-to-segment terms below is already
 * zero, so the minimum reports it without a special case.
 */
const segmentToSegment = (a: Point, b: Point, c: Point, d: Point): number => {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) return 0;
  return Math.min(
    pointToSegment(a, c, d),
    pointToSegment(b, c, d),
    pointToSegment(c, a, b),
    pointToSegment(d, a, b),
  );
};

/** Distance from a segment to a footprint. Zero when it touches or enters it. */
export const segmentToRect = (from: Point, to: Point, rect: Rect): number => {
  if (pointInRect(from, rect) || pointInRect(to, rect)) return 0;
  const corners: readonly Point[] = [
    { x: rect.minX, z: rect.minZ },
    { x: rect.maxX, z: rect.minZ },
    { x: rect.maxX, z: rect.maxZ },
    { x: rect.minX, z: rect.maxZ },
  ];
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index];
    const end = corners[(index + 1) % corners.length];
    if (!start || !end) continue;
    closest = Math.min(closest, segmentToSegment(from, to, start, end));
  }
  return closest;
};

/* ----------------------------------------------------------------- the floor */

/** Every footprint on the given floor a leg is measured against. */
export const hazards = (floor: Floor = DEFAULT_FLOOR): readonly Hazard[] => {
  const walls: Hazard[] = floor.rooms
    .filter((room) => !room.open)
    .map((room) => ({
      id: `wall:${room.id}`,
      rect: {
        minX: room.center.x - room.width / 2,
        maxX: room.center.x + room.width / 2,
        minZ: room.center.z - room.depth / 2,
        maxZ: room.center.z + room.depth / 2,
      },
      enterable: true,
    }));

  const props: Hazard[] = floor.obstacles.map((obstacle) => ({
    id: `prop:${obstacle.id}`,
    rect: {
      minX: obstacle.x - obstacle.width / 2,
      maxX: obstacle.x + obstacle.width / 2,
      minZ: obstacle.z - obstacle.depth / 2,
      maxZ: obstacle.z + obstacle.depth / 2,
    },
    enterable: false,
  }));

  return [
    ...walls,
    ...props,
    {
      id: "plinth",
      rect: {
        minX: floor.plinth.x - floor.plinth.width / 2,
        maxX: floor.plinth.x + floor.plinth.width / 2,
        minZ: floor.plinth.z - floor.plinth.depth / 2,
        maxZ: floor.plinth.z + floor.plinth.depth / 2,
      },
      enterable: false,
    },
  ];
};

const key = (from: Point, to: Point): string =>
  `${from.x.toFixed(3)},${from.z.toFixed(3)}>${to.x.toFixed(3)},${to.z.toFixed(3)}`;

/**
 * Every straight walk the scheduler can produce: the corridor legs of every
 * room-to-room path, plus the last leg out to each seat, standby spot and glass
 * pane, which is the one `findPath` never returns.
 *
 * Deduplicated, because the shared corridor legs otherwise appear once per room
 * pair and bury everything else.
 */
export const routeLegs = (floor: Floor = DEFAULT_FLOOR): readonly Leg[] => {
  const legs = new Map<string, Leg>();
  const add = (id: string, from: Point, to: Point): void => {
    const seen = key(from, to);
    if (legs.has(seen)) return;
    legs.set(seen, { id, from, to });
  };

  for (const from of floor.rooms) {
    for (const to of floor.rooms) {
      if (from.id === to.id) continue;
      const path = findPath(from.id, to.id, floor);
      for (let index = 1; index < path.length; index += 1) {
        const previous = path[index - 1];
        const current = path[index];
        if (!previous || !current) continue;
        add(`${from.id}→${to.id} leg ${index}`, previous, current);
      }
    }
  }

  for (const room of floor.rooms) {
    const arrival = floor.waypoints[room.id];
    if (!arrival) continue;
    room.seats.forEach((seat, index) => add(`${room.id} seat ${index}`, arrival, seat));
    room.standby.forEach((spot, index) => add(`${room.id} standby ${index}`, arrival, spot));
    if (room.glass) add(`${room.id} glass`, arrival, room.glass.at);
  }

  return [...legs.values()];
};

/**
 * Closest approach of every leg to every hazard, tightest first.
 *
 * A leg with an endpoint inside an enterable footprint is not measured against
 * it: walking into a room through its doorway is the point, and reporting it as
 * a zero would drown the two that matter.
 */
export const walkClearances = (floor: Floor = DEFAULT_FLOOR): readonly Clearance[] => {
  const found: Clearance[] = [];
  const all = hazards(floor);

  for (const leg of routeLegs(floor)) {
    for (const hazard of all) {
      const entering = pointInRect(leg.from, hazard.rect) || pointInRect(leg.to, hazard.rect);
      if (hazard.enterable && entering) continue;
      found.push({
        leg: leg.id,
        hazard: hazard.id,
        distance: segmentToRect(leg.from, leg.to, hazard.rect),
      });
    }
  }

  return found.sort((a, b) => a.distance - b.distance);
};
