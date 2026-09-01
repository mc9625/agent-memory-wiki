import { describe, expect, it } from "vitest";
import { parseVox, parseVoxModel } from "../components/world/vox";
import { buildVoxelGeometry } from "../components/world/voxel";

const int32 = (...values: number[]): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt32(index * 4, value, true));
  return bytes;
};

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const chunk = (
  id: string,
  content: Uint8Array,
  children: Uint8Array = new Uint8Array(0),
): Uint8Array<ArrayBuffer> => {
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  for (let i = 0; i < 4; i += 1) header[i] = id.charCodeAt(i);
  view.setInt32(4, content.length, true);
  view.setInt32(8, children.length, true);
  return concat(header, content, children);
};

const size = (x: number, y: number, z: number): Uint8Array<ArrayBuffer> =>
  chunk("SIZE", int32(x, y, z));

/** The layer character the parser encodes a given palette index as. */
const solidFor = (paletteIndex: number): string => String.fromCharCode(0x41 + paletteIndex);

const xyzi = (
  voxels: readonly (readonly [number, number, number, number])[],
): Uint8Array<ArrayBuffer> =>
  chunk("XYZI", concat(int32(voxels.length), Uint8Array.from(voxels.flat())));

/** An RGBA chunk where colour index `i` is a colour derived from `i`. */
const rgba = (colors: ReadonlyMap<number, number> = new Map()): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(256 * 4);
  for (const [index, color] of colors) {
    const base = (index - 1) * 4;
    bytes[base] = (color >> 16) & 0xff;
    bytes[base + 1] = (color >> 8) & 0xff;
    bytes[base + 2] = color & 0xff;
    bytes[base + 3] = 0xff;
  }
  return chunk("RGBA", bytes);
};

const voxFile = (...children: Uint8Array<ArrayBuffer>[]): ArrayBuffer => {
  const header = new Uint8Array(8);
  const view = new DataView(header.buffer);
  for (let i = 0; i < 4; i += 1) header[i] = "VOX ".charCodeAt(i);
  view.setInt32(4, 150, true);
  const file = concat(header, chunk("MAIN", new Uint8Array(0), concat(...children)));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};

describe("vox parser", () => {
  it("rejects a file that does not start with the VOX magic", () => {
    expect(() => parseVox(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow(/VOX magic/);
  });

  it("parses a single voxel with its palette colour", () => {
    const file = voxFile(
      size(1, 1, 1),
      xyzi([[0, 0, 0, 1]]),
      rgba(new Map([[1, 0x336699]])),
    );
    const model = parseVoxModel(file, 0.2);

    expect(model.voxelSize).toBe(0.2);
    expect(model.layers).toEqual([[solidFor(1)]]);
    expect(Object.values(model.palette)).toEqual([0x336699]);
  });

  it("maps MagicaVoxel's Z-up axes onto our Y-up layers and flips depth", () => {
    // One voxel at vox (x=1, y=0, z=2) in a 3x4x5 model.
    const file = voxFile(size(3, 4, 5), xyzi([[1, 0, 2, 1]]), rgba(new Map([[1, 0xffffff]])));
    const model = parseVoxModel(file);

    // Five layers of four rows of three columns.
    expect(model.layers).toHaveLength(5);
    expect(model.layers[0]).toHaveLength(4);
    expect(model.layers[0]?.[0]).toHaveLength(3);

    const solid = solidFor(1);
    // Height 2, depth row 4 - 1 - 0 = 3, column 1.
    expect(model.layers[2]?.[3]?.[1]).toBe(solid);
    // Nothing anywhere else.
    const count = model.layers.flat().join("").split(solid).length - 1;
    expect(count).toBe(1);
  });

  it("treats colour index 0 as empty", () => {
    const file = voxFile(size(2, 1, 1), xyzi([[0, 0, 0, 0], [1, 0, 0, 1]]), rgba(new Map([[1, 0xff0000]])));
    const model = parseVoxModel(file);
    expect(model.layers[0]?.[0]).toBe(`.${solidFor(1)}`);
  });

  it("keeps distinct colour indices distinct", () => {
    const file = voxFile(
      size(2, 1, 1),
      xyzi([[0, 0, 0, 1], [1, 0, 0, 7]]),
      rgba(new Map([[1, 0x111111], [7, 0x777777]])),
    );
    const model = parseVoxModel(file);
    expect(model.palette).toEqual({
      [solidFor(1)]: 0x111111,
      [solidFor(7)]: 0x777777,
    });
  });

  it("walks past chunks it does not understand", () => {
    const file = voxFile(
      chunk("PACK", int32(1)),
      size(1, 1, 1),
      xyzi([[0, 0, 0, 1]]),
      rgba(new Map([[1, 0x00ff00]])),
      chunk("MATL", int32(1, 2, 3)),
      chunk("nTRN", int32(0, 0, 0, 0)),
    );
    expect(Object.values(parseVoxModel(file).palette)).toEqual([0x00ff00]);
  });

  it("returns every model in a multi-model file", () => {
    const file = voxFile(
      size(1, 1, 1),
      xyzi([[0, 0, 0, 1]]),
      size(2, 2, 2),
      xyzi([[0, 0, 0, 1], [1, 1, 1, 1]]),
      rgba(new Map([[1, 0x123456]])),
    );
    const models = parseVox(file);
    expect(models).toHaveLength(2);
    expect(models[0]?.layers).toHaveLength(1);
    expect(models[1]?.layers).toHaveLength(2);
  });

  it("falls back to the documented default palette when there is no RGBA chunk", () => {
    const file = voxFile(size(3, 1, 1), xyzi([[0, 0, 0, 1], [1, 0, 0, 216], [2, 0, 0, 255]]));
    const colors = Object.values(parseVoxModel(file).palette);
    // Index 1 opens the colour cube at white; 216 opens the blue ramp; 255 ends
    // the grey ramp at the darkest step.
    expect(colors).toEqual([0xffffff, 0x0000ee, 0x111111]);
  });

  it("refuses a file whose chunk sizes run past the end", () => {
    const truncated = concat(
      Uint8Array.from("VOX ".split("").map((c) => c.charCodeAt(0))),
      int32(150),
      chunk("SIZE", int32(1, 1, 1)),
    );
    const view = new DataView(truncated.buffer);
    view.setInt32(12, 999, true); // SIZE claims a content size it does not have
    expect(() => parseVox(truncated.buffer)).toThrow(/past the end/);
  });

  it("refuses a voxel outside the declared bounds", () => {
    const file = voxFile(size(1, 1, 1), xyzi([[5, 0, 0, 1]]), rgba(new Map([[1, 0xffffff]])));
    expect(() => parseVoxModel(file)).toThrow(/outside the declared size/);
  });

  it("refuses an XYZI chunk that declares more voxels than it carries", () => {
    const file = voxFile(size(1, 1, 1), chunk("XYZI", concat(int32(4), new Uint8Array(4))));
    expect(() => parseVox(file)).toThrow(/declares 4 voxels/);
  });

  it("feeds the existing compiler, culling shared faces as usual", () => {
    const single = voxFile(size(1, 1, 1), xyzi([[0, 0, 0, 1]]), rgba(new Map([[1, 0xffffff]])));
    expect(buildVoxelGeometry(parseVoxModel(single, 1)).faceCount).toBe(6);

    const cube = voxFile(
      size(2, 2, 2),
      xyzi(
        [0, 1].flatMap((x) =>
          [0, 1].flatMap((y) => [0, 1].map((z) => [x, y, z, 1] as [number, number, number, number])),
        ),
      ),
      rgba(new Map([[1, 0xffffff]])),
    );
    expect(buildVoxelGeometry(parseVoxModel(cube, 1)).faceCount).toBe(24);
  });
});
