/**
 * The prop library.
 *
 * Every model is assembled from boxes by `build.ts`, which is what keeps a desk
 * or a staircase readable as code — the character-layer format in `props.ts`
 * only pays off for shapes with an outline, like the armchair.
 *
 * Conventions shared by every builder:
 *   - the prop is centred on X and Z and rests on Y = 0, so a caller positions
 *     it by its footprint and never has to know its height;
 *   - the prop faces -Z, the same forward axis the avatar uses, so one rotation
 *     value orients an avatar and the thing it is using;
 *   - wall-mounted props are built flat against Z = 0 and face -Z.
 *
 * World scale: one unit is roughly 0.63 m, because an avatar stands 2.85 units
 * tall and reads as about 1.8 m.
 */

import { buildProp, type BoxKit, type BuiltProp } from "./build";

export const PALETTE = {
  wall: 0xeee9dd,
  wallShade: 0xdcd7c9,
  trim: 0xc9c3b4,
  trimDark: 0xb3ada0,
  floorTile: 0xcdc7b8,
  floorGrout: 0xb6b0a2,
  wood: 0xd4a469,
  woodDark: 0xb58150,
  woodLight: 0xe9c692,
  metal: 0x9aa0a8,
  metalDark: 0x5d6167,
  fabric: 0x4e8f5c,
  // Tinted enough to read as glazing under a warm key light; a paler blue
  // made the partitions disappear against the plaster behind them. Saturated
  // rather than lightened: the tint has to survive being cut to a third by the
  // material's opacity, and lifting the opacity instead turns the panes milky.
  // Warmed towards aqua, so it sits with the woods instead of against them.
  glass: 0x6cbdd1,
  screen: 0x2ec8ff,
  screenDim: 0x14506b,
  // Warmed a step towards yellow: at the earlier greens the foliage read cold
  // against the plaster and the woods.
  leaf: 0xaad65a,
  leafDark: 0x8fbc46,
  leafLight: 0xc0e06b,
  soil: 0x4a3524,
  pot: 0xe3ddce,
  // The archive runs a whole stop lighter than the rest of the joinery: in the
  // reference its case and its boxes are pale tan, not the mid oak the desks
  // and shelves use, and at PALETTE.wood the whole room came back mahogany.
  archiveWood: 0xfbecd4,
  archiveWoodShade: 0xd8b78d,
  card: 0xf3ddbb,
  cardDark: 0xd9b98c,
  paper: 0xf6f2e4,
  ink: 0x2b3038,
} as const;

/* ------------------------------------------------------------------ seating */

/** A five-star office chair. The base spokes are what make it read as one. */
export const officeChair = (): BuiltProp =>
  buildProp((kit) => {
    for (let spoke = 0; spoke < 5; spoke += 1) {
      const angle = (spoke / 5) * Math.PI * 2;
      kit.box(Math.sin(angle) * 0.34, 0.09, Math.cos(angle) * 0.34, 0.5, 0.14, 0.5, PALETTE.metalDark);
    }
    kit.box(0, 0.36, 0, 0.2, 0.6, 0.2, PALETTE.metalDark);
    kit.box(0, 0.72, 0, 1.1, 0.22, 1.1, PALETTE.metalDark);
    kit.box(0, 1.32, 0.52, 1.05, 1.0, 0.18, PALETTE.metalDark);
    kit.box(0, 0.86, 0, 1.0, 0.1, 1.0, PALETTE.metal);
  });

/** A two-seat sofa for the offices that only ever appear at the frame edge. */
export const sofa = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.36, 0, 3.2, 0.72, 1.5, 0x6f7a8c);
    kit.box(0, 0.82, 0, 3.0, 0.24, 1.3, 0x8a95a8);
    kit.box(0, 1.06, 0.66, 3.2, 1.4, 0.3, 0x7a8598);
    for (const side of [-1, 1]) kit.box(side * 1.5, 0.95, 0, 0.28, 1.2, 1.5, 0x7a8598);
  });

/* ------------------------------------------------------------- work surfaces */

/** Desk with a drawer pedestal on the right and a wooden top. */
export const desk = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 1.16, 0, 3.4, 0.16, 1.7, PALETTE.wood);
    kit.box(0, 1.06, -0.75, 3.4, 0.06, 0.2, PALETTE.woodDark);
    kit.box(1.2, 0.54, 0, 0.9, 1.08, 1.5, PALETTE.wallShade);
    for (let drawer = 0; drawer < 3; drawer += 1) {
      kit.box(1.2, 0.28 + drawer * 0.34, -0.77, 0.78, 0.28, 0.06, PALETTE.trim);
      kit.box(1.2, 0.28 + drawer * 0.34, -0.82, 0.3, 0.06, 0.04, PALETTE.metalDark);
    }
    for (const side of [-1, 1]) kit.box(-1.5, 0.54, side * 0.6, 0.14, 1.08, 0.14, PALETTE.metalDark);
  });

/** A low table: the reading room's, with a book left open on it. */
export const coffeeTable = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.62, 0, 1.8, 0.14, 1.1, PALETTE.wood);
    for (const x of [-0.7, 0.7]) {
      for (const z of [-0.4, 0.4]) kit.box(x, 0.28, z, 0.16, 0.56, 0.16, PALETTE.woodDark);
    }
    kit.box(-0.22, 0.73, 0, 0.5, 0.08, 0.62, PALETTE.paper);
    kit.box(0.22, 0.73, 0, 0.5, 0.08, 0.62, PALETTE.paper);
    kit.box(0, 0.74, 0, 0.06, 0.09, 0.62, PALETTE.trim);
  });

/**
 * The LINKS lounge chair: the reference's slate-blue tub chair, lower and
 * squarer than the reading room's armchair and half the sofa's width.
 */
export const loungeChair = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.34, 0, 1.5, 0.68, 1.4, 0x53708f);
    kit.box(0, 0.76, 0, 1.36, 0.2, 1.26, 0x6d8aa8);
    kit.box(0, 1.0, 0.6, 1.5, 1.0, 0.3, 0x5f7c9c);
    for (const side of [-1, 1]) kit.box(side * 0.68, 0.82, -0.05, 0.22, 0.62, 1.4, 0x5f7c9c);
  });

/** The LINKS side table: a mug, a stack of paper and a small pot. */
export const loungeTable = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.62, 0, 1.9, 0.14, 1.2, PALETTE.wood);
    kit.box(0, 0.52, 0, 1.6, 0.08, 0.95, PALETTE.woodDark);
    for (const x of [-0.75, 0.75]) {
      for (const z of [-0.45, 0.45]) kit.box(x, 0.28, z, 0.16, 0.56, 0.16, PALETTE.woodDark);
    }
    kit.box(-0.5, 0.72, -0.1, 0.6, 0.06, 0.5, PALETTE.paper);
    kit.box(0.25, 0.79, 0.12, 0.28, 0.3, 0.28, PALETTE.paper);
    kit.box(0.25, 0.93, 0.12, 0.24, 0.04, 0.24, 0x53708f);
    kit.box(0.8, 0.76, -0.3, 0.3, 0.24, 0.3, PALETTE.pot);
    kit.box(0.8, 0.94, -0.3, 0.34, 0.22, 0.34, PALETTE.leaf);
  });

/** Storage boxes, the pair that sits on the LINKS cabinet in the reference. */
export const shelfBoxes = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(-0.3, 0.22, 0, 0.5, 0.44, 0.6, 0x4f7ea8);
    kit.box(-0.3, 0.3, -0.31, 0.3, 0.14, 0.04, PALETTE.paper);
    kit.box(0.3, 0.17, 0.05, 0.5, 0.34, 0.55, PALETTE.paper);
    kit.box(0.3, 0.35, 0.05, 0.52, 0.05, 0.57, 0x4f7ea8);
  });

/**
 * The reading room's side cabinet: a lit lamp on top and a row of books stood
 * on the shelf under it, which is what the reference puts beside the armchair.
 */
export const lampTable = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.86, 0, 1.3, 0.14, 1.1, PALETTE.wood);
    // Sides, back and base only: a solid carcass would bury the books inside it.
    for (const side of [-1, 1]) kit.box(side * 0.54, 0.44, 0, 0.14, 0.72, 0.95, PALETTE.woodDark);
    kit.box(0, 0.44, 0.42, 1.15, 0.72, 0.1, PALETTE.woodDark);
    kit.box(0, 0.06, 0, 1.2, 0.12, 1.0, PALETTE.woodDark);
    // Spines in the open bay, at mixed heights. The prop faces -Z, so the
    // caller turns it by Math.PI to put the bay towards the camera.
    for (const [index, colour] of [0x437c4e, 0xb5443c, 0xe6dcc2, 0x3f7fa8, 0xc9743a].entries()) {
      const height = index % 2 === 0 ? 0.5 : 0.42;
      kit.box(-0.36 + index * 0.18, 0.16 + height / 2, -0.06, 0.13, height, 0.6, colour);
    }
    kit.box(0, 1.09, 0, 0.16, 0.32, 0.16, PALETTE.metalDark);
    kit.glow(0, 1.37, 0, 0.62, 0.42, 0.62, 0xffd98a);
  });

/** Monitor on a stand, sized to sit on a desk top at y = 1.24. */
export const monitor = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.05, 0, 0.9, 0.1, 0.5, PALETTE.metalDark);
    kit.box(0, 0.32, 0, 0.2, 0.44, 0.16, PALETTE.metalDark);
    kit.box(0, 1.06, 0.06, 2.1, 1.36, 0.12, PALETTE.ink);
    // A light page, not a dark terminal: the reference's editor is dark type on
    // white, and the panel is bright enough to catch a little bloom.
    kit.glow(0, 1.06, -0.02, 1.9, 1.16, 0.04, 0xf2fbff);
    kit.glow(0, 1.58, -0.05, 1.9, 0.12, 0.02, 0x6aa8d8);
    // Text lines, so the screen reads as an editor rather than a blank page.
    for (let line = 0; line < 5; line += 1) {
      const width = 1.5 - (line % 3) * 0.35;
      kit.glow(-0.9 + width / 2, 1.42 - line * 0.2, -0.05, width, 0.07, 0.02, 0x41627a);
    }
  });

export const keyboard = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.05, 0, 1.15, 0.1, 0.42, PALETTE.trim);
    kit.box(0, 0.11, 0, 1.0, 0.02, 0.3, PALETTE.metalDark);
  });

export const laptop = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.05, 0, 1.2, 0.1, 0.85, PALETTE.trim);
    kit.box(0, 0.52, 0.44, 1.2, 0.85, 0.09, PALETTE.metal);
    kit.glow(0, 0.52, 0.38, 1.05, 0.7, 0.03, PALETTE.screenDim);
  });

/* --------------------------------------------------------------- storage */

export const filingCabinet = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.8, 0, 1.3, 1.6, 1.0, PALETTE.wallShade);
    for (let drawer = 0; drawer < 3; drawer += 1) {
      kit.box(0, 0.36 + drawer * 0.5, -0.52, 1.15, 0.42, 0.06, PALETTE.trim);
      kit.box(0, 0.36 + drawer * 0.5, -0.57, 0.4, 0.08, 0.05, PALETTE.metalDark);
    }
  });

/** A cardboard box, taped shut. */
export const crate = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.45, 0, 1.2, 0.9, 1.1, PALETTE.card);
    kit.box(0, 0.91, 0, 1.22, 0.06, 0.24, PALETTE.cardDark);
    kit.box(0, 0.46, -0.56, 0.55, 0.3, 0.03, PALETTE.paper);
  });

/**
 * The archive wall: a wooden case of pigeonholes, each holding a labelled box.
 * Columns and rows are parameters because it also dresses the corridor edges.
 */
export const archiveShelf = (columns: number, rows: number): BuiltProp =>
  buildProp((kit) => {
    const cell = 1.5;
    const width = columns * cell + 0.3;
    const height = rows * cell + 0.3;
    // A carcass with real depth. At 0.5 deep it stood barely 0.1 proud of the
    // wall and read as a relief carved into the plaster rather than a cabinet:
    // neither its sides nor its top caught any light of their own.
    const depth = 1.2;
    kit.box(0, height / 2, 0.15, width, height, depth, PALETTE.archiveWood);
    // A cornice and a plinth, both oversailing, which is what states the depth
    // from this camera — the top face is the brightest surface on the prop.
    kit.box(0, height + 0.12, 0.05, width + 0.3, 0.24, depth + 0.3, PALETTE.archiveWood);
    kit.box(0, 0.1, 0.05, width + 0.3, 0.2, depth + 0.3, PALETTE.archiveWoodShade);
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const x = -width / 2 + 0.15 + cell / 2 + column * cell;
        const y = 0.15 + cell / 2 + row * cell;
        // The pigeonhole is cut right through the front face.
        kit.box(x, y, -0.1, cell - 0.18, cell - 0.18, depth - 0.3, PALETTE.archiveWoodShade);
        // A pale carton in every hole, standing a little proud of the opening,
        // with a white label and, on one in three, a coloured tab.
        kit.box(x, y, -0.34, cell - 0.34, cell - 0.34, 0.5, PALETTE.card);
        kit.box(x, y - 0.18, -0.6, cell - 0.62, 0.34, 0.04, PALETTE.paper);
        const tab = (column + row) % 3;
        if (tab !== 0) {
          kit.box(
            x + (cell - 0.34) / 2 - 0.22,
            y + 0.36,
            -0.6,
            0.22,
            0.26,
            0.04,
            tab === 1 ? 0xc85f4e : 0x4f89ad,
          );
        }
      }
    }
  });

/* ------------------------------------------------------------------- plants */

/** Desk-sized plant: one pot, two leaf blocks. */
export const plantSmall = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.22, 0, 0.55, 0.44, 0.55, PALETTE.pot);
    kit.box(0, 0.46, 0, 0.5, 0.06, 0.5, PALETTE.soil);
    kit.box(0, 0.72, 0, 0.62, 0.5, 0.62, PALETTE.leaf);
    kit.box(0, 1.02, 0, 0.4, 0.3, 0.4, PALETTE.leafDark);
  });

/** Floor tree: staggered foliage blocks, the shape the reference repeats. */
export const plantTall = (): BuiltProp =>
  buildProp((kit) => {
    // Stone planter, per the reference — the cream pot stays on plantSmall.
    kit.box(0, 0.45, 0, 1.15, 0.9, 1.15, PALETTE.wall);
    kit.box(0, 0.09, 0, 1.23, 0.18, 1.23, PALETTE.trim);
    kit.box(0, 0.92, 0, 1.05, 0.08, 1.05, PALETTE.soil);
    kit.box(0, 1.15, 0, 0.26, 0.7, 0.26, PALETTE.woodDark);
    kit.box(0, 1.95, 0, 1.7, 1.0, 1.7, PALETTE.leaf);
    kit.box(0.14, 2.7, -0.12, 1.25, 0.75, 1.25, PALETTE.leafDark);
    kit.box(-0.12, 3.25, 0.1, 0.8, 0.5, 0.8, PALETTE.leaf);
  });

/**
 * The room plant: a stone cube planter under a canopy assembled from individual
 * leaf blocks, rather than the three stacked slabs `plantTall` uses.
 *
 * Blocks sit on a lattice and are kept when a seeded hash puts them inside a
 * soft ellipsoid, so the silhouette frays at the edge the way a real crown does
 * while staying identical on every build — the prop is cached by key, and a
 * `Math.random` here would hand different rooms different trees.
 */
export const plantFicus = (): BuiltProp =>
  buildProp((kit) => {
    // Straight-sided planter with a lighter lip, per the reference.
    kit.box(0, 0.55, 0, 1.1, 1.1, 1.1, PALETTE.wall);
    kit.box(0, 1.14, 0, 1.2, 0.1, 1.2, PALETTE.wallShade);
    kit.box(0, 1.22, 0, 1.0, 0.08, 1.0, PALETTE.soil);
    // Trunk. The upper length is kicked off the lower one's axis, which is what
    // stops the crown reading as a ball balanced on a pole.
    kit.box(0, 1.46, 0, 0.24, 0.52, 0.24, PALETTE.woodDark);
    kit.box(0.07, 1.95, 0.03, 0.21, 0.5, 0.21, PALETTE.wood);

    const BLOCK = 0.28;
    const SPAN = 3;
    const CENTER_Y = 2.6;
    const RADIUS_XZ = 1.05;
    const RADIUS_Y = 1.05;
    const shades = [PALETTE.leaf, PALETTE.leafDark, PALETTE.leafLight] as const;
    let seed = 0x2f6e2b;
    for (let ix = -SPAN; ix <= SPAN; ix += 1) {
      for (let iy = -SPAN; iy <= SPAN; iy += 1) {
        for (let iz = -SPAN; iz <= SPAN; iz += 1) {
          // One draw per cell, taken whether the cell is kept or not, so the
          // sequence does not depend on the ellipsoid test.
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const x = ix * BLOCK;
          const y = iy * BLOCK;
          const z = iz * BLOCK;
          const distance = Math.hypot(x / RADIUS_XZ, y / RADIUS_Y, z / RADIUS_XZ);
          // Solid core, ragged shell: the noise only decides the boundary cells.
          if (distance + (seed / 0xffffffff) * 0.3 > 1) continue;
          // A shade over the lattice step, so neighbours interlock instead of
          // meeting on a shared plane and z-fighting.
          kit.box(x, CENTER_Y + y, z, BLOCK * 1.04, BLOCK * 1.04, BLOCK * 1.04, shades[seed % 3]!);
        }
      }
    }
  });

/**
 * Corridor planter: a wooden trough with a proud rim, run to any length, under
 * a hedge built the way `plantFicus` builds its crown — a lattice of leaf
 * blocks clipped to a rounded loaf, with a seeded noise fraying the boundary
 * cells. The two flat slabs it replaces read as a painted wedge from the
 * camera's angle.
 */
export const hedgePlanter = (length: number): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.24, 0, length, 0.48, 0.95, PALETTE.wood);
    kit.box(0, 0.52, 0, length + 0.06, 0.1, 1.01, PALETTE.woodDark);
    kit.box(0, 0.58, 0, length - 0.16, 0.06, 0.8, PALETTE.soil);

    const BLOCK = 0.2;
    const CENTER_Y = 0.86;
    const RADIUS_Y = 0.3;
    const RADIUS_Z = 0.38;
    // The loaf is flat-sided along its length and rounds off over this much at
    // each end, so one hedge shape serves every length the corridors ask for.
    const END_RADIUS = 0.32;
    const flat = Math.max(0, (length - 0.3) / 2 - END_RADIUS);
    const spanX = Math.ceil((flat + END_RADIUS) / BLOCK);
    const shades = [PALETTE.leaf, PALETTE.leafDark, PALETTE.leafLight] as const;
    let seed = 0x51a7c3;
    for (let ix = -spanX; ix <= spanX; ix += 1) {
      for (let iy = -1; iy <= 1; iy += 1) {
        // Half-stepped, so four columns of blocks sit inside the trough's width
        // rather than three straddling its centre line.
        for (let iz = -2; iz <= 1; iz += 1) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const x = ix * BLOCK;
          const y = iy * BLOCK;
          const z = (iz + 0.5) * BLOCK;
          const overhang = Math.max(0, Math.abs(x) - flat);
          const distance = Math.hypot(overhang / END_RADIUS, y / RADIUS_Y, z / RADIUS_Z);
          if (distance + (seed / 0xffffffff) * 0.3 > 1) continue;
          kit.box(x, CENTER_Y + y, z, BLOCK * 1.04, BLOCK * 1.04, BLOCK * 1.04, shades[seed % 3]!);
        }
      }
    }
  });

/* ------------------------------------------------------------ wall fittings */

/** A framed poster. Built flat against Z = 0, facing -Z. */
export const pictureFrame = (width: number, height: number, art: number): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0, 0.06, width, height, 0.12, PALETTE.woodDark);
    kit.box(0, 0, -0.02, width - 0.22, height - 0.22, 0.06, PALETTE.paper);
    kit.box(0, 0, -0.05, width - 0.5, height - 0.5, 0.02, art);
  });

/** Whiteboard with a four-item checklist, the one the EDIT room carries. */
export const whiteboard = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0, 0.07, 2.6, 1.9, 0.14, PALETTE.metal);
    kit.box(0, 0, -0.01, 2.42, 1.72, 0.05, PALETTE.paper);
    for (let line = 0; line < 4; line += 1) {
      const y = 0.58 - line * 0.38;
      kit.box(-0.95, y, -0.05, 0.16, 0.16, 0.02, PALETTE.leaf);
      kit.box(-0.1, y, -0.05, 1.3, 0.09, 0.02, PALETTE.ink);
    }
  });

/** Cork board with pinned notes. */
export const corkBoard = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0, 0.07, 2.2, 1.5, 0.14, PALETTE.woodDark);
    kit.box(0, 0, -0.01, 2.0, 1.3, 0.05, 0xb98a52);
    const notes = [0xf3e58a, 0xa8d8f0, 0xf0a8a8, 0xb8e8a8];
    for (const [index, color] of notes.entries()) {
      kit.box(-0.62 + (index % 2) * 0.62, 0.28 - Math.floor(index / 2) * 0.62, -0.05, 0.46, 0.46, 0.02, color);
    }
  });

/** The LINKS room's wall display: bezel, lit face, a chain glyph and text runs. */
export const wallScreen = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0, 0.12, 5.4, 3.0, 0.24, PALETTE.ink);
    // A lit cyan panel, not a dark one: in the reference the display is the
    // brightest surface in the room, and the glyphs read as white on cyan
    // rather than cyan on navy. It also has to clear the bloom threshold, so
    // the panel sits high and the glyphs on it sit higher still.
    kit.glow(0, 0, -0.01, 5.1, 2.7, 0.04, 0x4fc0e8);
    // The title tab. Local +X renders screen LEFT under this room's rotation,
    // which is where the reference puts the caption.
    kit.glow(1.6, 1.06, -0.03, 2.1, 0.62, 0.02, 0x1d7fae);
    // Two interlocking rings, drawn as square outlines.
    for (const offsetX of [-0.45, 0.45]) {
      for (const [dx, dy, w, h] of [
        [0, 0.42, 0.9, 0.16],
        [0, -0.42, 0.9, 0.16],
        [-0.37, 0, 0.16, 0.7],
        [0.37, 0, 0.16, 0.7],
      ] as const) {
        kit.glow(offsetX + dx, dy, -0.04, w, h, 0.02, 0xffffff);
      }
    }
    // Text runs down both margins, the way the reference fills the panel.
    for (let line = 0; line < 6; line += 1) {
      kit.glow(-1.75, 0.5 - line * 0.3, -0.04, 1.1 - (line % 3) * 0.28, 0.1, 0.02, 0xffffff);
      kit.glow(1.75, 0.5 - line * 0.3, -0.04, 1.1 - ((line + 1) % 3) * 0.28, 0.1, 0.02, 0xffffff);
    }
  });

/**
 * Room sign: the plaque only. Its text is a canvas texture added by the caller,
 * so shrinking the plaque leaves the lettering the size it was.
 */
export const roomSign = (width: number, color: number, height = 2.5): BuiltProp =>
  buildProp((kit) => {
    // The frame is unlit for the same reason the poster face is. Lit, the only
    // side of it the camera sees is the one the key never reaches, and between
    // the hemisphere falloff and the AO in the crease against the wall it came
    // back near black however light the colour was written.
    kit.glow(0, 0, 0.16, width + 0.5, height, 0.32, 0x878d95);
    // Unlit, so the sign holds the flat poster colour of the reference instead
    // of going grey on the faces the sun never reaches.
    kit.glow(0, 0, -0.1, width, height - 0.5, 0.2, color);
  });

/* ------------------------------------------------------------- architecture */

/**
 * A glazed office partition: two posts, a head rail, a kick rail and the glass
 * between them. Length runs along X.
 */
export const glassPartition = (length: number, height: number): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, height - 0.12, 0, length, 0.24, 0.3, PALETTE.wall);
    kit.box(0, 0.14, 0, length, 0.28, 0.3, PALETTE.trim);
    const posts = Math.max(2, Math.round(length / 3));
    for (let post = 0; post <= posts; post += 1) {
      kit.box(-length / 2 + (post / posts) * length, height / 2, 0, 0.16, height, 0.3, PALETTE.wall);
    }
    kit.glass(0, height / 2, 0, length - 0.1, height - 0.5, 0.1, PALETTE.glass);
  });

/** Solid wall with a run of windows — used where the set meets the frame edge. */
export const windowWall = (length: number, height: number): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, height / 2, 0, length, height, 0.36, PALETTE.wall);
    const bays = Math.max(1, Math.round(length / 3.2));
    for (let bay = 0; bay < bays; bay += 1) {
      const x = -length / 2 + (length / bays) * (bay + 0.5);
      kit.glass(x, height * 0.58, -0.14, length / bays - 0.7, height * 0.5, 0.12, PALETTE.glass);
      kit.box(x, height * 0.58, -0.2, length / bays - 0.7, 0.1, 0.06, PALETTE.trim);
    }
  });

/** The reception counter, with a carved welcome board facing the entrance. */
export const receptionDesk = (): BuiltProp =>
  buildProp((kit) => {
    // The reference desk is wood carried on light grey masonry, not wood
    // throughout: a stone plinth with a front step, and piers capping the ends.
    kit.box(0, 0.16, -0.2, 8.8, 0.32, 2.4, PALETTE.trimDark);
    kit.box(0, 0.1, -1.55, 7.2, 0.2, 0.5, PALETTE.trim);
    kit.box(-4.0, 0.74, 0, 0.9, 1.48, 1.9, PALETTE.trim);
    kit.box(4.0, 0.74, 0, 0.9, 1.48, 1.9, PALETTE.trim);
    kit.box(0, 0.9, 0, 7.2, 1.2, 1.6, PALETTE.wood);
    kit.box(0, 1.56, 0, 8.6, 0.16, 2.0, PALETTE.woodLight);
    // Tall enough to carry lettering that is legible at this camera distance:
    // the earlier 2.0-high board only fitted a caption a few pixels tall. The
    // narrower cap strip steps the top corners the way the reference rounds them.
    kit.box(0, 2.95, 0.2, 5.8, 3.3, 0.3, PALETTE.woodLight);
    kit.box(0, 4.72, 0.2, 5.0, 0.24, 0.3, PALETTE.woodLight);
    kit.box(0, 3.0, 0.02, 5.3, 2.8, 0.1, PALETTE.wood);
    // Counter kit from the reference: a dark monitor, a card terminal and a
    // grey intercom, all facing the entrance.
    kit.box(-1.3, 1.68, -0.35, 0.55, 0.08, 0.4, PALETTE.ink);
    kit.box(-1.3, 1.82, -0.35, 0.12, 0.24, 0.1, PALETTE.ink);
    kit.box(-1.3, 2.2, -0.32, 0.9, 0.62, 0.12, PALETTE.ink);
    kit.glow(-1.3, 2.2, -0.39, 0.74, 0.46, 0.03, PALETTE.screenDim);
    kit.box(-3.0, 1.86, -0.3, 0.32, 0.44, 0.28, PALETTE.ink);
    kit.glow(-3.0, 1.94, -0.45, 0.2, 0.14, 0.02, PALETTE.screenDim);
    kit.box(1.5, 1.76, -0.4, 0.42, 0.24, 0.32, PALETTE.metal);
    kit.box(1.5, 1.78, -0.57, 0.16, 0.1, 0.04, PALETTE.metalDark);
  });

/** Freestanding info terminal — the dark kiosk that anchors the south corridor. */
export const kiosk = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.12, 0, 1.2, 0.24, 1.0, PALETTE.metalDark);
    kit.box(0, 1.3, 0, 1.0, 2.4, 0.7, PALETTE.ink);
    kit.glow(0, 1.75, -0.37, 0.72, 1.0, 0.04, PALETTE.screenDim);
    for (let line = 0; line < 3; line += 1) {
      kit.glow(-0.1, 2.05 - line * 0.24, -0.4, 0.4, 0.08, 0.02, PALETTE.screen);
    }
    kit.box(0, 1.0, -0.38, 0.6, 0.3, 0.06, PALETTE.metalDark);
  });

/** White pillar carrying a blue information panel. */
export const infoPillar = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 1.4, 0, 0.9, 2.8, 0.5, PALETTE.wall);
    kit.box(0, 2.0, -0.28, 0.7, 1.0, 0.1, 0x2f5fa8);
    kit.glow(0, 2.12, -0.34, 0.1, 0.42, 0.03, PALETTE.paper);
    kit.glow(0, 2.44, -0.34, 0.14, 0.14, 0.03, PALETTE.paper);
  });

/**
 * The hub basin: the reference's plinth is a low stone fountain wall around a
 * dark floor, with shrubs in the corners and a lit tile under the crystal —
 * not a stepped dais.
 */
export const hubPlinth = (): BuiltProp =>
  buildProp((kit) => {
    kit.box(0, 0.125, 0, 6.2, 0.25, 6.2, PALETTE.trimDark);
    for (const side of [-1, 1] as const) {
      kit.box(0, 0.62, side * 2.55, 5.8, 0.75, 0.7, PALETTE.trim);
      kit.box(side * 2.55, 0.62, 0, 0.7, 0.75, 4.4, PALETTE.trim);
      kit.box(0, 1.08, side * 2.55, 6.0, 0.18, 0.9, PALETTE.wallShade);
      kit.box(side * 2.55, 1.08, 0, 0.9, 0.18, 4.6, PALETTE.wallShade);
    }
    kit.box(0, 0.32, 0, 4.4, 0.16, 4.4, PALETTE.trimDark);
    kit.glow(0, 0.44, 0, 1.7, 0.1, 1.7, 0x2fa8d8);
    // Tall enough to clear the rim cap, or only their tops peek over it.
    for (const [x, z] of [
      [-1.7, -1.7],
      [1.7, -1.7],
      [-1.7, 1.7],
      [1.7, 1.7],
    ] as const) {
      kit.box(x, 0.85, z, 0.75, 0.9, 0.75, PALETTE.leafDark);
      kit.box(x, 1.5, z, 0.5, 0.4, 0.5, PALETTE.leaf);
    }
  });

/** Monolith dimensions, shared by the shell and by the lettering that sits on it. */
export const HUB_MONOLITH = { width: 1.9, depth: 1.9, height: 3.2 } as const;

/**
 * The hub monolith's static half: a glass shell wired with glowing edges.
 *
 * The edges are what carry the reference's read — the tinted shell alone is a
 * soft blue block, and it is the hard bright line around it that makes it a
 * lit object. They are held near white so they clear the bloom threshold while
 * the shell, which must not smear, stays under it.
 *
 * Built with its base at y = 0; the lit core that pulses inside it is
 * `hubCrystal`, kept separate because that one rotates and this must not.
 */
export const hubMonolith = (): BuiltProp =>
  buildProp((kit) => {
    const { width: W, depth: D, height: H } = HUB_MONOLITH;
    const EDGE = 0.07;
    const EDGE_COLOR = 0xd6f7ff;

    // Saturated, not pale: at the earlier tint the shell came out near white
    // over the light floor and the white lettering had nothing to sit against.
    kit.glass(0, H / 2, 0, W, H, D, 0x4ec6e8);

    // Every bar stands this far proud of the shell. Flush with it, the glow
    // face and the glass face are coplanar and z-fight along the whole edge.
    const OVER = 0.015;
    const insetX = W / 2 + OVER - EDGE / 2;
    const insetZ = D / 2 + OVER - EDGE / 2;

    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        kit.glow(sx * insetX, H / 2, sz * insetZ, EDGE, H + OVER * 2, EDGE, EDGE_COLOR);
      }
    }
    // Top and bottom rims. Both run the full face, so the corners double up
    // with the verticals rather than leaving a notch at each junction.
    for (const y of [EDGE / 2 - OVER, H - EDGE / 2 + OVER]) {
      for (const sz of [-1, 1] as const) {
        kit.glow(0, y, sz * insetZ, W + OVER * 2, EDGE, EDGE, EDGE_COLOR);
      }
      for (const sx of [-1, 1] as const) {
        kit.glow(sx * insetX, y, 0, EDGE, EDGE, D + OVER * 2, EDGE_COLOR);
      }
    }
    // The cap the reference catches the light on, a step down in brightness so
    // the edge line still reads against it.
    kit.glow(0, H - 0.03, 0, W - 0.3, 0.1, D - 0.3, 0x6bcfe8);
  });

/** The lit core the animation breathes and spins inside `hubMonolith`. */
export const hubCrystal = (): BuiltProp =>
  buildProp((kit) => {
    // Narrow enough that its diagonal stays inside the shell: the animation
    // spins it, and at the shell's own width the corners swing out through the
    // glass every quarter turn.
    kit.glow(0, HUB_MONOLITH.height / 2, 0, 1.28, HUB_MONOLITH.height - 0.5, 1.28, 0x5fd8ff);
  });

export type { BoxKit, BuiltProp };
