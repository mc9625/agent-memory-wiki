/**
 * Box kit — the scene's second geometry path.
 *
 * `voxel.ts` compiles character-layer models, which suits organic shapes like an
 * armchair but is unreadable for a desk or a staircase. Those are built here
 * instead: a builder collects axis-aligned coloured boxes and emits one merged
 * `BufferGeometry` per material channel, so a whole prop costs a single draw
 * call and the same lighting rules as everything else.
 *
 * Three channels exist because the reference art needs three behaviours:
 * `box` for lit surfaces, `glow` for screens and signage that must stay bright
 * in shadow, and `glass` for the office partitions. Only `box` is face-shaded.
 *
 * ## Face shading
 *
 * Every face of a `box` is tinted by its normal before it reaches the GPU —
 * tops full strength, sides progressively darker, undersides darkest. This
 * bakes the directional read into the vertex colours for nothing; the
 * screen-space AO in `world-canvas.tsx` adds the contact shading on top.
 * `glow` and `glass` opt out: neither a screen nor a pane has a lit side.
 *
 * ## UVs
 *
 * Faces carry UVs measured in *blocks*, not in the 0..1 a `BoxGeometry` would
 * give: one unit of UV is `BLOCK_SIZE` world units on every face of every prop,
 * so the shared grain texture keeps a constant texel density whether it lands
 * on a keyboard or a reception counter. UVs are taken from the prop-local
 * position, which anchors the grain to the model rather than sliding with it.
 */

import * as THREE from "three";
import { UNIT_CUBE_FACES } from "./voxel";
import { VISUAL_CONFIG, effectiveFaceShade } from "./visual";

/**
 * Default world size of one texture block. The grain texture draws a bevel at
 * its border, so this is also the size of the visible block lip.
 *
 * A prop built out of boxes smaller than this gets the lip landing somewhere
 * across its faces rather than around them, and reads as smooth. Such a prop
 * passes its own block size to `buildProp` — the foliage does — so that one
 * tile, and therefore one bevelled square, covers one of its cubes.
 */
const BLOCK_SIZE = 0.5;

interface Accumulator {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

const newAccumulator = (): Accumulator => ({
  positions: [],
  normals: [],
  colors: [],
  uvs: [],
  indices: [],
});

const scratch = new THREE.Color();

const pushBox = (
  into: Accumulator,
  centerX: number,
  centerY: number,
  centerZ: number,
  width: number,
  height: number,
  depth: number,
  color: number,
  shaded: boolean,
  blockSize: number,
): void => {
  const minX = centerX - width / 2;
  const minY = centerY - height / 2;
  const minZ = centerZ - depth / 2;
  // Read per box rather than at module load, so the tuning panel's remount
  // picks the current strength up.
  const faceShade = effectiveFaceShade(VISUAL_CONFIG);

  for (const [faceIndex, face] of UNIT_CUBE_FACES.entries()) {
    const [nx, ny, nz] = face.normal;
    const shade = shaded ? (faceShade[faceIndex] ?? 1) : 1;
    scratch.setHex(color).convertSRGBToLinear().multiplyScalar(shade);

    const base = into.positions.length / 3;
    for (const [cx, cy, cz] of face.corners) {
      const px = minX + cx * width;
      const py = minY + cy * height;
      const pz = minZ + cz * depth;
      into.positions.push(px, py, pz);
      into.normals.push(nx, ny, nz);
      into.colors.push(scratch.r, scratch.g, scratch.b);
      // Project onto the two axes the normal does not use, so the grain never
      // smears along the face it is lying on.
      const [u, v] = nz !== 0 ? [px, py] : nx !== 0 ? [pz, py] : [px, pz];
      into.uvs.push(u / blockSize, v / blockSize);
    }
    into.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
};

const toGeometry = (accumulator: Accumulator): THREE.BufferGeometry | null => {
  if (accumulator.positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(accumulator.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(accumulator.normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(accumulator.colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(accumulator.uvs, 2));
  geometry.setIndex(accumulator.indices);
  geometry.computeBoundingSphere();
  return geometry;
};

export interface BuiltProp {
  /** Lit surfaces. Always present for a prop that emitted at least one box. */
  readonly solid: THREE.BufferGeometry | null;
  /** Screens and signage, rendered unlit so they stay bright in shadow. */
  readonly glow: THREE.BufferGeometry | null;
  /** Office partitions, rendered transparent. */
  readonly glass: THREE.BufferGeometry | null;
  readonly boxCount: number;
}

export interface BoxKit {
  /** A lit box, centred on the given point. */
  box(x: number, y: number, z: number, width: number, height: number, depth: number, color: number): void;
  /** An unlit box: screens, glowing signage, the hub crystal's core. */
  glow(x: number, y: number, z: number, width: number, height: number, depth: number, color: number): void;
  /** A transparent box: glass partitions and windows. */
  glass(x: number, y: number, z: number, width: number, height: number, depth: number, color: number): void;
  build(): BuiltProp;
}

export const createBoxKit = (blockSize: number = BLOCK_SIZE): BoxKit => {
  const solid = newAccumulator();
  const glow = newAccumulator();
  const glass = newAccumulator();
  let boxCount = 0;

  return {
    box(x, y, z, width, height, depth, color) {
      pushBox(solid, x, y, z, width, height, depth, color, true, blockSize);
      boxCount += 1;
    },
    glow(x, y, z, width, height, depth, color) {
      // Unlit surfaces skip face shading: a screen has no lit side.
      pushBox(glow, x, y, z, width, height, depth, color, false, blockSize);
      boxCount += 1;
    },
    glass(x, y, z, width, height, depth, color) {
      // Face shading is skipped here for the same reason as `glow`: a pane has
      // no lit side. Baked in, it put the four orientations 0.58 to 0.85 apart
      // before a single light was applied, so the partitions on one side of a
      // room read as glazed and those on another read as empty frames. What
      // varies between them now is only what the lights actually do.
      pushBox(glass, x, y, z, width, height, depth, color, false, blockSize);
      boxCount += 1;
    },
    build() {
      return {
        solid: toGeometry(solid),
        glow: toGeometry(glow),
        glass: toGeometry(glass),
        boxCount,
      };
    },
  };
};

/**
 * Builds a prop with a fresh kit — the shape every entry in `furniture.ts` has.
 * `blockSize` is the world size one tile of the grain texture covers; pass it
 * only for a prop whose boxes are smaller than the default.
 */
export const buildProp = (draw: (kit: BoxKit) => void, blockSize?: number): BuiltProp => {
  const kit = createBoxKit(blockSize);
  draw(kit);
  return kit.build();
};
