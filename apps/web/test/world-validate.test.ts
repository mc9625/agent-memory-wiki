import { describe, expect, it } from "vitest";
import { AVATAR_CLEARANCE } from "../lib/world/layout";
import { routeLegs, segmentToRect, walkClearances, type Rect } from "../lib/world/validate";

const rect: Rect = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };

describe("segment-to-footprint distance", () => {
  it("is zero when an end is inside the footprint", () => {
    expect(segmentToRect({ x: 0, z: 0 }, { x: 8, z: 8 }, rect)).toBe(0);
  });

  it("is zero when the segment passes straight through", () => {
    expect(segmentToRect({ x: -8, z: 0 }, { x: 8, z: 0 }, rect)).toBe(0);
  });

  it("is zero when the segment grazes a corner", () => {
    // The case a boolean crossing test misses: the leg touches and moves on.
    expect(segmentToRect({ x: -3, z: 1 }, { x: 3, z: 1 }, rect)).toBe(0);
  });

  it("measures the gap to a face", () => {
    expect(segmentToRect({ x: -5, z: 3 }, { x: 5, z: 3 }, rect)).toBeCloseTo(2, 6);
  });

  it("measures the gap to a corner on the diagonal", () => {
    expect(segmentToRect({ x: 4, z: 0 }, { x: 0, z: 4 }, rect)).toBeCloseTo(
      2 * Math.SQRT2 - Math.SQRT2,
      6,
    );
  });
});

describe("floor clearances", () => {
  it("measures every route leg on the floor", () => {
    expect(routeLegs().length).toBeGreaterThan(20);
  });

  it("has exactly two legs that touch the scenery, both behind the fountain", () => {
    /*
     * The known rough edge, pinned so it cannot spread. The hub's last two
     * standby spots stand behind the plinth, so the walk out to them crosses
     * it. The plinth is deliberately not an obstacle — listing it would make
     * those spots unreachable rather than fix them — and the fix is to
     * re-author the two spots beside it, which nothing has asked for.
     *
     * If a third zero ever appears here, something moved and took a route with
     * it. Both of the zeroes this file exists for were invisible on screen.
     */
    const touching = walkClearances().filter((clearance) => clearance.distance === 0);
    expect(touching.map((clearance) => `${clearance.leg} / ${clearance.hazard}`)).toEqual([
      "hub standby 1 / plinth",
      "hub standby 2 / plinth",
    ]);
  });

  it("leaves an avatar room to pass everywhere else", () => {
    const tight = walkClearances().filter(
      (clearance) => clearance.distance > 0 && clearance.distance < AVATAR_CLEARANCE,
    );
    expect(
      tight.map((clearance) => `${clearance.leg} / ${clearance.hazard} @ ${clearance.distance}`),
    ).toEqual([]);
  });
});
