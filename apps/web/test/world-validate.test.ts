import { describe, expect, it } from "vitest";
import { AVATAR_CLEARANCE } from "../lib/world/layout";
import {
  MAX_LANE,
  routeLegs,
  segmentToRect,
  walkClearances,
  type Rect,
} from "../lib/world/validate";

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

  it("has no leg that touches the scenery", () => {
    /*
     * This used to pin two known zeroes: the hub's last two standby spots stood
     * behind the plinth, so the walk out to them crossed it. They have since
     * been re-authored beside the fountain rather than behind it, and the floor
     * now has none at all.
     *
     * If a zero ever appears here, something moved and took a route with it.
     * Every zero this file has caught was invisible on screen.
     */
    const touching = walkClearances().filter((clearance) => clearance.distance === 0);
    expect(touching.map((clearance) => `${clearance.leg} / ${clearance.hazard}`)).toEqual([]);
  });

  it("keeps every leg a lane and a body clear of the fountain", () => {
    /*
     * The one clearance with a target rather than a floor, because it is the
     * one that was reported from the running page: agents were walking through
     * the water. An actor does not walk the centre line — it takes a lane
     * offset of up to `MAX_LANE` — and `AVATAR_CLEARANCE` of body reaches past
     * that, so anything under the sum is an avatar in the fountain.
     *
     * It is met by routing round the plinth rather than by squeezing past it:
     * `c_w` to the west and `c_e` to the east mean neither READ nor EDIT is
     * reached from the hub in a straight line. Restore either direct edge and
     * this fails.
     */
    const fountain = walkClearances().filter((clearance) => clearance.hazard === "prop:plinth");
    expect(fountain.length).toBeGreaterThan(0);
    expect(fountain[0]!.distance).toBeGreaterThanOrEqual(MAX_LANE + AVATAR_CLEARANCE);
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
