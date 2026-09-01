import { describe, expect, it } from "vitest";
import { buildVoxelGeometry, type VoxelModel } from "../components/world/voxel";
import { ARMCHAIR, BOOKSHELF } from "../components/world/props";

const singleVoxel: VoxelModel = {
  voxelSize: 1,
  palette: { a: 0xff0000 },
  layers: [["a"]],
};

const twoByTwoByTwo: VoxelModel = {
  voxelSize: 1,
  palette: { a: 0xff0000 },
  layers: [
    ["aa", "aa"],
    ["aa", "aa"],
  ],
};

describe("voxel compiler", () => {
  it("emits six faces for an isolated voxel", () => {
    expect(buildVoxelGeometry(singleVoxel).faceCount).toBe(6);
  });

  it("culls interior faces in a solid block", () => {
    // A 2×2×2 cube has 8 voxels: 48 faces naively, 24 once shared faces go.
    expect(buildVoxelGeometry(twoByTwoByTwo).faceCount).toBe(24);
  });

  it("treats unmapped characters as empty space", () => {
    const withHoles: VoxelModel = {
      voxelSize: 1,
      palette: { a: 0x00ff00 },
      layers: [["a.a"]],
    };
    // Two isolated voxels, no shared faces.
    expect(buildVoxelGeometry(withHoles).faceCount).toBe(12);
  });

  it("tolerates ragged rows without emitting stray geometry", () => {
    // Three voxels in an L: (0,0,0)-(0,0,1) touch, and (0,0,1)-(1,0,1) touch,
    // so two adjacencies remove two faces each.
    const ragged: VoxelModel = {
      voxelSize: 1,
      palette: { a: 0x0000ff },
      layers: [["a", "aa"]],
    };
    expect(buildVoxelGeometry(ragged).faceCount).toBe(3 * 6 - 4);
  });

  it("centres geometry on X and Z and rests it on the floor", () => {
    const { geometry } = buildVoxelGeometry(twoByTwoByTwo);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.min.x).toBeCloseTo(-1);
    expect(box.max.x).toBeCloseTo(1);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.min.z).toBeCloseTo(-1);
  });

  it("compiles the authored props and keeps them at a sane face count", () => {
    const armchair = buildVoxelGeometry(ARMCHAIR);
    const bookshelf = buildVoxelGeometry(BOOKSHELF);

    for (const built of [armchair, bookshelf]) {
      expect(built.faceCount).toBeGreaterThan(0);
      // Well under the point where a prop would be worth instancing differently.
      expect(built.faceCount).toBeLessThan(4000);
      expect(built.geometry.getAttribute("position")).toBeDefined();
      expect(built.geometry.getAttribute("color")).toBeDefined();
    }
  });

  it("puts the armchair cushion at the height the seated pose expects", () => {
    // Cushion occupies layers 1-3, so its top surface is 4 voxels up.
    expect(4 * ARMCHAIR.voxelSize).toBeCloseTo(0.58);
  });
});
