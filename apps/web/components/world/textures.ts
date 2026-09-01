/**
 * Canvas-drawn textures.
 *
 * Signage and floor tiling are the two things the box kit cannot express: one
 * needs glyphs, the other needs a grid too fine to spend geometry on. Both are
 * painted into a canvas once and uploaded as a texture with nearest-neighbour
 * filtering, which is what keeps the lettering hard-edged instead of blurring
 * into the isometric view.
 *
 * Browser only — every caller lives under `"use client"`.
 */

import * as THREE from "three";

const PIXEL_FONT = '700 %spx "JetBrains Mono", "Courier New", monospace';

const finish = (canvas: HTMLCanvasElement): THREE.CanvasTexture => {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

export interface TextTextureOptions {
  /** Extra space between glyphs, as a fraction of the font size. */
  readonly tracking?: number;
  readonly color?: string;
  readonly background?: string;
  /** Height of the canvas in pixels; width follows from the widest line. */
  readonly fontSize?: number;
  /**
   * Margin around the block, as a fraction of the font size. The default suits
   * signage, where the plane is sized to the sign; lettering sized to fill a
   * face wants it tighter, since the margin comes straight off the glyphs.
   */
  readonly padding?: number;
}

/**
 * Draws one or more lines of tracked-out uppercase text on a transparent (or
 * filled) canvas. Glyphs are laid out one at a time because the tracking the
 * signage needs is wider than any font provides.
 */
export const createTextTexture = (
  lines: readonly string[],
  options: TextTextureOptions = {},
): { texture: THREE.CanvasTexture; aspect: number } => {
  const fontSize = options.fontSize ?? 64;
  const tracking = (options.tracking ?? 0.18) * fontSize;
  const padding = fontSize * (options.padding ?? 0.5);

  const measurer = document.createElement("canvas").getContext("2d");
  if (!measurer) throw new Error("world: 2d canvas is unavailable");
  measurer.font = PIXEL_FONT.replace("%s", String(fontSize));

  const widthOf = (line: string): number =>
    [...line].reduce((sum, character) => sum + measurer.measureText(character).width + tracking, 0) -
    (line.length > 0 ? tracking : 0);

  const textWidth = Math.max(1, ...lines.map(widthOf));
  const lineHeight = fontSize * 1.32;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(textWidth + padding * 2);
  canvas.height = Math.ceil(lineHeight * lines.length + padding * 2);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("world: 2d canvas is unavailable");
  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.font = PIXEL_FONT.replace("%s", String(fontSize));
  context.fillStyle = options.color ?? "#ffffff";
  context.textBaseline = "middle";

  for (const [index, line] of lines.entries()) {
    let cursor = (canvas.width - widthOf(line)) / 2;
    const y = padding + lineHeight * (index + 0.5);
    for (const character of line) {
      context.fillText(character, cursor, y);
      cursor += context.measureText(character).width + tracking;
    }
  }

  return { texture: finish(canvas), aspect: canvas.width / canvas.height };
};

/**
 * The corridor floor: a light tile with a darker grout line, repeated by the
 * material rather than by geometry.
 */
export const createTileTexture = (
  tint: string,
  grout: string,
  repeat: number,
): THREE.CanvasTexture => {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("world: 2d canvas is unavailable");

  context.fillStyle = tint;
  context.fillRect(0, 0, size, size);
  context.fillStyle = grout;
  context.fillRect(0, 0, size, 4);
  context.fillRect(0, 0, 4, size);
  // A faint highlight along the opposite edges reads as a bevelled tile.
  context.fillStyle = "rgba(255, 255, 255, 0.35)";
  context.fillRect(4, size - 3, size - 4, 3);
  context.fillRect(size - 3, 4, 3, size - 4);

  const texture = finish(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  return texture;
};

/** Short-pile carpet: flat colour with a subtle noise so it is not a flat slab. */
export const createCarpetTexture = (color: number): THREE.CanvasTexture => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("world: 2d canvas is unavailable");

  context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i += 1) {
    context.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
    context.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }

  const texture = finish(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  return texture;
};

/**
 * ARCHIVE's floor: staggered boards rather than weave. Kept to a narrow band of
 * tan with a hairline joint — a wider tonal spread turns into a chequerboard at
 * this camera distance, which is the thing a parquet is not.
 */
export const createParquetTexture = (): THREE.CanvasTexture => {
  const size = 128;
  const rows = 4;
  const boardHeight = size / rows;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("world: 2d canvas is unavailable");

  const boards = ["#d9ba90", "#d2b085", "#dcc099", "#cea87c"];
  context.fillStyle = "#b0906a";
  context.fillRect(0, 0, size, size);

  for (let row = 0; row < rows; row += 1) {
    // Every other course starts half a board along, which is the stagger.
    const offset = row % 2 === 0 ? 0 : size / 4;
    for (let board = 0; board < 2; board += 1) {
      const x = (offset + board * (size / 2)) % size;
      context.fillStyle = boards[(row + board) % boards.length] ?? boards[0]!;
      context.fillRect(x + 1, row * boardHeight + 1, size / 2 - 2, boardHeight - 2);
      if (x + size / 2 > size) {
        context.fillRect(0, row * boardHeight + 1, x + size / 2 - size - 1, boardHeight - 2);
      }
    }
  }

  const texture = finish(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  return texture;
};

/**
 * The grain every lit prop carries.
 *
 * The box kit and the voxel compiler both emit UVs measured in blocks, so this
 * one texture is the block itself: a faint bevel — dark along the -U/-V edges,
 * light along the others — plus a speckle. Multiplied against the vertex colour
 * it gives each block the shaded lip the reference art draws by hand, which is
 * the difference between a chunky voxel surface and a flat painted slab.
 *
 * The base is 0.93 rather than white so the bevel has room to brighten as well
 * as darken; the light channel loses that headroom otherwise.
 */
export const createSurfaceTexture = (): THREE.CanvasTexture => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("world: 2d canvas is unavailable");

  context.fillStyle = "#ededed";
  context.fillRect(0, 0, size, size);

  // Speckle. Dots stay one pixel inside the border so the tile keeps wrapping.
  for (let i = 0; i < 520; i += 1) {
    context.fillStyle = i % 3 === 0 ? "rgba(0,0,0,0.045)" : "rgba(255,255,255,0.05)";
    context.fillRect(1 + Math.random() * (size - 3), 1 + Math.random() * (size - 3), 1, 1);
  }

  // Three pixels of a 64-pixel tile, not one: a block is only ~20 screen pixels
  // wide at this camera distance, so a hairline lip disappears entirely.
  context.fillStyle = "rgba(0,0,0,0.16)";
  context.fillRect(0, 0, size, 3);
  context.fillRect(0, 0, 3, size);
  context.fillStyle = "rgba(255,255,255,0.62)";
  context.fillRect(3, size - 3, size - 3, 3);
  context.fillRect(size - 3, 3, 3, size - 3);

  const texture = finish(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

/**
 * Painted plaster for the room walls. They are plain `BoxGeometry`, whose UVs
 * run 0..1 per face regardless of size, so the repeat is set here rather than
 * being derived from the wall's dimensions — a stretched grain is invisible at
 * this camera distance, an untextured wall is not.
 */
export const createPlasterTexture = (repeatX: number, repeatY: number): THREE.CanvasTexture => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("world: 2d canvas is unavailable");

  context.fillStyle = "#f5f1e5";
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < 420; i += 1) {
    context.fillStyle = i % 2 === 0 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.05)";
    context.fillRect(1 + Math.random() * (size - 3), 1 + Math.random() * (size - 3), 1, 1);
  }

  const texture = finish(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
};
