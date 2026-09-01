/**
 * Minimal voxel model compiler.
 *
 * A model is authored as horizontal layers of characters — readable in a text
 * editor, diffable, and license-clean because it is data in this repository
 * rather than an imported asset. The compiler emits a single indexed
 * BufferGeometry with per-vertex colours and only the faces that are actually
 * visible: an interior face between two solid voxels is never generated.
 *
 * The same output shape is what a MagicaVoxel `.vox` importer would produce, so
 * swapping authored models for imported ones later touches only the parser.
 *
 * UVs run one unit per voxel, so the shared grain texture draws its bevel
 * around every voxel rather than being stretched across the whole model.
 */

import * as THREE from "three";

export interface VoxelModel {
  /** Maps a layer character to an RGB colour. `.` is always empty space. */
  readonly palette: Readonly<Record<string, number>>;
  /**
   * `layers[y][z]` is a row of characters indexed by x. Layer 0 is the bottom.
   * Rows may be ragged; missing cells are treated as empty.
   */
  readonly layers: readonly (readonly string[])[];
  /** World size of one voxel. */
  readonly voxelSize: number;
}

interface Dimensions {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
}

const measure = (model: VoxelModel): Dimensions => {
  let sizeX = 0;
  let sizeZ = 0;
  for (const layer of model.layers) {
    sizeZ = Math.max(sizeZ, layer.length);
    for (const row of layer) sizeX = Math.max(sizeX, row.length);
  }
  return { sizeX, sizeY: model.layers.length, sizeZ };
};

const cellAt = (model: VoxelModel, x: number, y: number, z: number): string => {
  const layer = model.layers[y];
  if (!layer) return ".";
  const row = layer[z];
  if (!row) return ".";
  const character = row[x];
  return character ?? ".";
};

const isSolid = (model: VoxelModel, x: number, y: number, z: number): boolean => {
  const character = cellAt(model, x, y, z);
  return character !== "." && character !== " " && model.palette[character] !== undefined;
};

/** Unit-cube face definitions: normal, then the four corner offsets. */
export const UNIT_CUBE_FACES: readonly {
  normal: readonly [number, number, number];
  corners: readonly (readonly [number, number, number])[];
}[] = [
  {
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    normal: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  {
    normal: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    normal: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
];

export interface VoxelBuildResult {
  readonly geometry: THREE.BufferGeometry;
  /** Faces emitted, useful for asserting that culling actually happened. */
  readonly faceCount: number;
  readonly dimensions: Dimensions;
}

/**
 * Compiles a model into geometry centred on X and Z, resting on Y = 0.
 */
export const buildVoxelGeometry = (model: VoxelModel): VoxelBuildResult => {
  const dimensions = measure(model);
  const { voxelSize } = model;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const offsetX = (dimensions.sizeX * voxelSize) / 2;
  const offsetZ = (dimensions.sizeZ * voxelSize) / 2;
  const scratch = new THREE.Color();
  let faceCount = 0;

  for (let y = 0; y < dimensions.sizeY; y += 1) {
    for (let z = 0; z < dimensions.sizeZ; z += 1) {
      for (let x = 0; x < dimensions.sizeX; x += 1) {
        if (!isSolid(model, x, y, z)) continue;

        const paletteColor = model.palette[cellAt(model, x, y, z)];
        if (paletteColor === undefined) continue;
        scratch.setHex(paletteColor).convertSRGBToLinear();

        for (const face of UNIT_CUBE_FACES) {
          const [nx, ny, nz] = face.normal;
          // Skip any face whose neighbour is solid: it can never be seen.
          if (isSolid(model, x + nx, y + ny, z + nz)) continue;

          const base = positions.length / 3;
          for (const [cx, cy, cz] of face.corners) {
            positions.push(
              (x + cx) * voxelSize - offsetX,
              (y + cy) * voxelSize,
              (z + cz) * voxelSize - offsetZ,
            );
            normals.push(nx, ny, nz);
            colors.push(scratch.r, scratch.g, scratch.b);
            // The two axes the normal does not use, in whole voxels.
            const [u, v] =
              nz !== 0 ? [x + cx, y + cy] : nx !== 0 ? [z + cz, y + cy] : [x + cx, z + cz];
            uvs.push(u, v);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          faceCount += 1;
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return { geometry, faceCount, dimensions };
};
