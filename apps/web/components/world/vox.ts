/**
 * MagicaVoxel `.vox` parser.
 *
 * Produces the same {@link VoxelModel} shape that `props.ts` authors by hand,
 * so an imported model goes through `buildVoxelGeometry` — face culling,
 * per-vertex colours, centring — with nothing else changed. Only the parser is
 * new; the compiler, the material and the instancing already work.
 *
 * ## Format
 *
 * A file is `"VOX "`, a version int32, then a tree of chunks. Every chunk is a
 * four-character id, an int32 content size, an int32 children size, then those
 * bytes in that order. All integers are little-endian. The chunks that matter
 * here are `SIZE` (bounds), `XYZI` (voxels) and `RGBA` (palette); scene graph,
 * material and camera chunks are walked over and ignored.
 *
 * ## Axis convention
 *
 * MagicaVoxel is Z-up and its Y runs away from the viewer. Our models are Y-up
 * with Z running towards the camera, matching three.js. The conversion is
 * `x → x`, `z → y`, `y → -z`, and because layer indices cannot be negative the
 * depth axis is flipped into range: `layers[voxZ][sizeY - 1 - voxY][voxX]`.
 * Negating one axis rather than swapping two keeps the handedness, so an
 * imported model is not mirrored.
 *
 * ## Limitations (deliberate)
 *
 * Scene transforms (`nTRN`/`nGRP`/`nSHP`) are ignored, so a multi-model file
 * comes back as independent models all sitting at their own origin rather than
 * arranged as they were in the editor. Props are single-model files, which is
 * the case this exists for.
 */

import type { VoxelModel } from "./voxel";

const EMPTY = ".";

/** Palette index `i` is encoded as this character inside a layer row. */
const characterFor = (paletteIndex: number): string => String.fromCharCode(0x41 + paletteIndex);

const RAMP = [0xff, 0xcc, 0x99, 0x66, 0x33, 0x00] as const;
const SHADES = [0xee, 0xdd, 0xbb, 0xaa, 0x88, 0x77, 0x55, 0x44, 0x22, 0x11] as const;

/**
 * The palette a file falls back to when it carries no `RGBA` chunk: a 6×6×6
 * colour cube with black omitted, then blue, green, red and grey ramps. 255
 * entries, where element 0 is palette index 1. MagicaVoxel always writes a
 * palette, so this only covers hand-made or older files.
 */
const buildDefaultPalette = (): readonly number[] => {
  const colors: number[] = [];
  for (const r of RAMP) {
    for (const g of RAMP) {
      for (const b of RAMP) {
        if (r === 0 && g === 0 && b === 0) continue;
        colors.push((r << 16) | (g << 8) | b);
      }
    }
  }
  for (const v of SHADES) colors.push(v);
  for (const v of SHADES) colors.push(v << 8);
  for (const v of SHADES) colors.push(v << 16);
  for (const v of SHADES) colors.push((v << 16) | (v << 8) | v);
  return colors;
};

const DEFAULT_PALETTE = buildDefaultPalette();

interface Size {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Voxel {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly colorIndex: number;
}

interface VoxContents {
  readonly sizes: Size[];
  readonly voxelSets: Voxel[][];
  palette: readonly number[] | null;
}

const readId = (view: DataView, offset: number): string =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );

const readSize = (view: DataView, offset: number, contentSize: number): Size => {
  if (contentSize < 12) throw new Error("vox: SIZE chunk is too short");
  return {
    x: view.getInt32(offset, true),
    y: view.getInt32(offset + 4, true),
    z: view.getInt32(offset + 8, true),
  };
};

const readVoxels = (view: DataView, offset: number, contentSize: number): Voxel[] => {
  if (contentSize < 4) throw new Error("vox: XYZI chunk is too short");
  const count = view.getInt32(offset, true);
  if (count < 0 || contentSize < 4 + count * 4) {
    throw new Error(`vox: XYZI chunk declares ${count} voxels but is ${contentSize} bytes`);
  }
  const voxels: Voxel[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = offset + 4 + i * 4;
    voxels.push({
      x: view.getUint8(base),
      y: view.getUint8(base + 1),
      z: view.getUint8(base + 2),
      colorIndex: view.getUint8(base + 3),
    });
  }
  return voxels;
};

/**
 * The `RGBA` chunk stores 256 colours, but voxels index it from 1: colour index
 * `i` reads entry `i - 1`, and the last entry is unused. The array returned here
 * is already shifted, so `palette[i - 1]` is the colour for index `i`.
 */
const readPalette = (view: DataView, offset: number, contentSize: number): readonly number[] => {
  if (contentSize < 256 * 4) throw new Error("vox: RGBA chunk is too short");
  const colors: number[] = [];
  for (let i = 0; i < 255; i += 1) {
    const base = offset + i * 4;
    colors.push((view.getUint8(base) << 16) | (view.getUint8(base + 1) << 8) | view.getUint8(base + 2));
  }
  return colors;
};

/** Walks a chunk list, descending into children, collecting what we care about. */
const walkChunks = (view: DataView, start: number, end: number, into: VoxContents): void => {
  let offset = start;
  while (offset + 12 <= end) {
    const id = readId(view, offset);
    const contentSize = view.getInt32(offset + 4, true);
    const childrenSize = view.getInt32(offset + 8, true);
    const contentStart = offset + 12;
    const childrenStart = contentStart + contentSize;
    const chunkEnd = childrenStart + childrenSize;
    if (contentSize < 0 || childrenSize < 0 || chunkEnd > end) {
      throw new Error(`vox: chunk "${id}" declares sizes that run past the end of the file`);
    }

    if (id === "SIZE") into.sizes.push(readSize(view, contentStart, contentSize));
    else if (id === "XYZI") into.voxelSets.push(readVoxels(view, contentStart, contentSize));
    else if (id === "RGBA") into.palette = readPalette(view, contentStart, contentSize);

    if (childrenSize > 0) walkChunks(view, childrenStart, chunkEnd, into);
    offset = chunkEnd;
  }
};

const toModel = (
  size: Size,
  voxels: readonly Voxel[],
  palette: readonly number[],
  voxelSize: number,
): VoxelModel => {
  // layers[y][z][x] with y up: MagicaVoxel's Z becomes our height, its Y our depth.
  const rows: string[][][] = Array.from({ length: size.z }, () =>
    Array.from({ length: size.y }, () => new Array<string>(size.x).fill(EMPTY)),
  );
  const used = new Map<string, number>();

  for (const voxel of voxels) {
    if (voxel.colorIndex === 0) continue;
    if (voxel.x >= size.x || voxel.y >= size.y || voxel.z >= size.z) {
      throw new Error(
        `vox: voxel (${voxel.x}, ${voxel.y}, ${voxel.z}) falls outside the declared size ` +
          `(${size.x}, ${size.y}, ${size.z})`,
      );
    }
    const color = palette[voxel.colorIndex - 1];
    if (color === undefined) {
      throw new Error(`vox: voxel uses colour index ${voxel.colorIndex}, which the palette lacks`);
    }
    const character = characterFor(voxel.colorIndex);
    used.set(character, color);
    // Flip depth so that negating MagicaVoxel's Y stays inside the array bounds.
    const layer = rows[voxel.z]?.[size.y - 1 - voxel.y];
    if (layer) layer[voxel.x] = character;
  }

  return {
    voxelSize,
    palette: Object.fromEntries(used),
    layers: rows.map((layer) => layer.map((row) => row.join(""))),
  };
};

/**
 * Parses every model in a `.vox` file. `voxelSize` is the world size of one
 * voxel — the format does not record a scale, so the caller supplies it the same
 * way an authored model declares one.
 */
export const parseVox = (buffer: ArrayBuffer, voxelSize = 1): VoxelModel[] => {
  const view = new DataView(buffer);
  if (view.byteLength < 8 || readId(view, 0) !== "VOX ") {
    throw new Error("vox: file does not start with the VOX magic");
  }

  const contents: VoxContents = { sizes: [], voxelSets: [], palette: null };
  walkChunks(view, 8, view.byteLength, contents);

  if (contents.sizes.length === 0) throw new Error("vox: file contains no SIZE chunk");
  if (contents.sizes.length !== contents.voxelSets.length) {
    throw new Error(
      `vox: file has ${contents.sizes.length} SIZE chunks but ${contents.voxelSets.length} XYZI chunks`,
    );
  }

  const palette = contents.palette ?? DEFAULT_PALETTE;
  return contents.sizes.map((size, index) =>
    toModel(size, contents.voxelSets[index] ?? [], palette, voxelSize),
  );
};

/** Parses a single-model `.vox` file, which is what the props are. */
export const parseVoxModel = (buffer: ArrayBuffer, voxelSize = 1): VoxelModel => {
  const models = parseVox(buffer, voxelSize);
  const first = models[0];
  if (!first) throw new Error("vox: file contains no models");
  return first;
};

/** Fetches and parses a `.vox` file served from `public/`. */
export const loadVoxModel = async (url: string, voxelSize = 1): Promise<VoxelModel> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`vox: ${url} responded ${response.status}`);
  return parseVoxModel(await response.arrayBuffer(), voxelSize);
};
