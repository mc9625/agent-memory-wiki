/**
 * Authored voxel props.
 *
 * Each model is written as bottom-up layers: `layers[y][z]` is a row indexed by
 * x, and `.` is empty. Original work, so the whole scene stays CC0-compatible
 * with the archive's own content licence.
 *
 * World scale: an avatar stands 2.85 units tall, which reads as ~1.8 m, so one
 * metre is roughly 1.58 units. The seated pose in `avatar.ts` puts its hip pivot
 * at 0.58 and the thigh is 0.34 thick, so a cushion the thigh rests on tops out
 * at 0.435 rather than at the hip.
 */

import type { VoxelModel } from "./voxel";

const FABRIC = 0x8bb073;
const FABRIC_DARK = 0x769c5e;
const FABRIC_SHADOW = 0x668a52;
const WOOD = 0xd4a469;
const WOOD_DARK = 0xb58150;

/**
 * Reading armchair.
 *
 * Shallow on purpose. An armchair at this scale is deeper than the avatar's
 * thigh is long — 0.45 from hip to knee — so a full-depth cushion swallowed the
 * knees and the shins came out of the front of it. Four rows of cushion put the
 * front edge at 0.29 from the hips, which is exactly where the shins hang, and
 * two rows of backrest put the back of it against the torso.
 *
 * Heights follow from the same fit. The cushion tops out at 0.435, half a
 * thigh's thickness below the 0.58 the seated pose puts its hip pivot at, so
 * the thigh rests ON the cushion instead of halfway through it.
 */
export const ARMCHAIR: VoxelModel = {
  voxelSize: 0.145,
  palette: { f: FABRIC, d: FABRIC_DARK, s: FABRIC_SHADOW, w: WOOD_DARK },
  layers: [
    // y0 — four stubby legs, front pair and back pair.
    [
      "ww.......ww",
      "ww.......ww",
      "...........",
      "...........",
      "ww.......ww",
      "ww.......ww",
    ],
    // y1-y2 — seat cushion, topping out at 0.435.
    [
      "sssssssssss",
      "sssssssssss",
      "sssssssssss",
      "sssssssssss",
      "sssssssssss",
      "sssssssssss",
    ],
    [
      "fffffffffff",
      "fffffffffff",
      "fffffffffff",
      "fffffffffff",
      "fffffffffff",
      "fffffffffff",
    ],
    // y3-y4 — armrests down the sides, backrest across the +Z edge.
    [
      "ff.......ff",
      "ff.......ff",
      "ff.......ff",
      "ff.......ff",
      "ddddddddddd",
      "ddddddddddd",
    ],
    [
      "ff.......ff",
      "ff.......ff",
      "ff.......ff",
      "ff.......ff",
      "ddddddddddd",
      "ddddddddddd",
    ],
    // y5-y7 — backrest only.
    [
      "...........",
      "...........",
      "...........",
      "...........",
      "ddddddddddd",
      "ddddddddddd",
    ],
    [
      "...........",
      "...........",
      "...........",
      "...........",
      "ddddddddddd",
      "ddddddddddd",
    ],
    [
      "...........",
      "...........",
      "...........",
      "...........",
      "dddddddddds",
      "sssssssssss",
    ],
  ],
};

const BOOK_A = 0xb5443c;
const BOOK_B = 0x3f7fa8;
const BOOK_C = 0xd8a442;
const BOOK_D = 0x6a5aa8;
const BOOK_E = 0x437c4e;
const BOOK_CREAM = 0xe6dcc2;
const BOOK_RUST = 0xc9743a;
/** The unlit board behind the books, which is what gives the case its depth. */
const SHELF_BACK = 0x6d4b31;

/** Bookshelf: four bays of spines behind a wooden frame. */
export const BOOKSHELF: VoxelModel = {
  voxelSize: 0.22,
  palette: {
    w: WOOD,
    W: WOOD_DARK,
    k: SHELF_BACK,
    r: BOOK_A,
    b: BOOK_B,
    y: BOOK_C,
    p: BOOK_D,
    g: BOOK_E,
    c: BOOK_CREAM,
    n: BOOK_RUST,
  },
  layers: [
    ["WWWWWWWWWWWW", "WWWWWWWWWWWW", "WWWWWWWWWWWW"],
    ["wgbcrnpgbcrw", "wgbcrnpgbcrw", "wkkkkkkkkkkw"],
    ["wgbcrnpgbcrw", "wgbcrnpgbcrw", "wkkkkkkkkkkw"],
    // The top row of each bay is gapped, so the spines run at mixed heights the
    // way a real shelf does — a flush block of colour reads as a painted panel.
    ["wgb.rn.gb.rw", "wgb.rn.gb.rw", "wkkkkkkkkkkw"],
    ["wwwwwwwwwwww", "wwwwwwwwwwww", "wkkkkkkkkkkw"],
    ["wncgbrgcnbpw", "wncgbrgcnbpw", "wkkkkkkkkkkw"],
    ["wncgbrgcnbpw", "wncgbrgcnbpw", "wkkkkkkkkkkw"],
    ["wn.gbr.cn.pw", "wn.gbr.cn.pw", "wkkkkkkkkkkw"],
    ["wwwwwwwwwwww", "wwwwwwwwwwww", "wkkkkkkkkkkw"],
    ["wbrgcpngbrcw", "wbrgcpngbrcw", "wkkkkkkkkkkw"],
    ["wbrgcpngbrcw", "wbrgcpngbrcw", "wkkkkkkkkkkw"],
    ["wb.gc.ngb.cw", "wb.gc.ngb.cw", "wkkkkkkkkkkw"],
    ["WWWWWWWWWWWW", "WWWWWWWWWWWW", "WWWWWWWWWWWW"],
  ],
};
