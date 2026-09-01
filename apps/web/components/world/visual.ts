/**
 * Every knob that decides how the set is *lit*, in one place.
 *
 * The values were previously spread across `world-canvas.tsx`, `environment.ts`
 * and `build.ts` with a paragraph of prose next to each. They are gathered here
 * so `?tune=1` can drive them from sliders: finding this balance by eye takes
 * minutes, and finding it by editing three files and reloading takes hours.
 *
 * Nothing about layout, geometry, camera or animation lives here. This module
 * only ever changes how the same scene is shaded.
 *
 * Two kinds of value live side by side:
 *
 * - **Runtime.** Read every time `applyVisuals()` runs, so a slider moves them
 *   on the next frame.
 * - **Build-time** (`faceShade`, `faceShadeStrength`). Baked into vertex colours
 *   when the geometry is compiled, so changing them needs the scene rebuilt.
 *   The tuning panel remounts the canvas for those two.
 */

/** Multiplier per face normal, indexed the way `UNIT_CUBE_FACES` is. */
export type FaceShade = readonly [number, number, number, number, number, number];

export interface VisualConfig {
  /* ------------------------------------------------------------ tone map */
  exposure: number;
  /** Post-tone-map saturation. 1 leaves the frame untouched. */
  saturation: number;

  /* --------------------------------------------------------------- key */
  keyIntensity: number;
  /**
   * Degrees, measured from +Z towards +X — the same convention the camera's
   * azimuth uses, so the two can be compared directly.
   *
   * This is the single most consequential value in the file. The camera sits at
   * azimuth 45°, and the key used to sit at 57°: twelve degrees apart is a
   * frontal light, which gives the two visible side faces of every box nearly
   * the same N·L and throws each shadow directly behind the thing casting it,
   * where the camera cannot see it. Swinging the key out to 79° opens the +X /
   * +Z faces apart and lays the shadows across the frame instead.
   */
  keyAzimuthDeg: number;
  keyElevationDeg: number;
  /** VSM blur width, in shadow-map texels. */
  shadowRadius: number;

  /**
   * A shadowless spot sharing the key's axis, so the set can be lit as a pool
   * rather than a flat wash — brighter over the hub, falling off towards the
   * frame edges.
   *
   * It is a second light rather than a change to the key because a
   * `DirectionalLight` has no falloff to give: its rays are parallel and
   * infinite, which is exactly what makes its shadows read as dimetric. Turning
   * the key itself into a spot would fan every shadow out radially from one
   * point and lose that. The spot carries the gradient, the key keeps the
   * shadows, and both push light at the same faces because they share an axis.
   *
   * Its decay is 0 on purpose: with distance falloff on, a set 120 units across
   * lit from 78 away goes dark at the far corners by distance rather than by
   * angle, which is a different effect from the one wanted. All of the gradient
   * comes from the cone.
   */
  keySpotIntensity: number;
  /**
   * Cone half-angle, degrees. At the key's distance of 78 units, 45° covers the
   * whole set and 16° draws a pool about 22 units across — roughly the hub and
   * the corridor mouths, with the rooms falling into the penumbra.
   */
  keySpotAngleDeg: number;
  /** 0 is a hard-edged circle of light, 1 fades the whole cone from the centre out. */
  keySpotPenumbra: number;

  /* -------------------------------------------------------------- fills */
  fillIntensity: number;
  hemiIntensity: number;
  ambientIntensity: number;
  /**
   * Scales the four shadowless room lights together.
   *
   * They were the second flattener: at intensity 16–34 with decay 2, the hub
   * crystal alone delivers more light at three units than the sun does, and
   * being omnidirectional and shadowless it lifts every face of every prop by
   * the same amount — filling in exactly the corners the AO pass is there to
   * darken.
   */
  roomLightScale: number;

  /* ----------------------------------------------------------------- AO */
  aoIntensity: number;
  /** World units. Roughly one desk depth reaches into a corner without eating a wall. */
  aoRadius: number;

  /* -------------------------------------------------------------- bloom */
  bloomStrength: number;
  bloomRadius: number;
  /** Held high on purpose: only the crystal and the screens should ever bloom. */
  bloomThreshold: number;

  /* --------------------------------------------------------- build-time */
  faceShade: FaceShade;
  /** Lerps `faceShade` towards flat. 0 hands all the shaping to the lights. */
  faceShadeStrength: number;
}

/**
 * The authored balance. `VISUAL_CONFIG` starts as a copy of this and is mutated
 * in place by the tuning panel, so this stays available as the value each
 * slider's reset returns to.
 */
export const VISUAL_DEFAULTS: Readonly<VisualConfig> = {
  exposure: 1.05,
  saturation: 0.9,

  keyIntensity: 1.0,
  keyAzimuthDeg: 79,
  keyElevationDeg: 50,
  shadowRadius: 5.75,

  keySpotIntensity: 1.6,
  keySpotAngleDeg: 10,
  keySpotPenumbra: 1,

  fillIntensity: 0.32,
  hemiIntensity: 0.4,
  ambientIntensity: 0.1,
  roomLightScale: 1.5,

  aoIntensity: 1.12,
  aoRadius: 4,

  bloomStrength: 0.32,
  bloomRadius: 0.85,
  bloomThreshold: 0.9,

  faceShade: [
    0.82, // +Z, towards the camera
    0.72, // -Z
    0.9, // +X
    0.78, // -X
    1.0, // +Y, the lit top
    0.55, // -Y
  ],
  faceShadeStrength: 1.5,
};

export const VISUAL_CONFIG: VisualConfig = {
  ...VISUAL_DEFAULTS,
  faceShade: [...VISUAL_DEFAULTS.faceShade] as unknown as FaceShade,
};

/** Distance the key light is placed at. Only its direction matters. */
const KEY_DISTANCE = 78;

/** Key light position for the configured azimuth and elevation. */
export const keyLightPosition = (config: VisualConfig): [number, number, number] => {
  const azimuth = (config.keyAzimuthDeg * Math.PI) / 180;
  const elevation = (config.keyElevationDeg * Math.PI) / 180;
  const horizontal = Math.cos(elevation) * KEY_DISTANCE;
  return [
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation) * KEY_DISTANCE,
    Math.cos(azimuth) * horizontal,
  ];
};

/** `faceShade` after `faceShadeStrength` has pulled it towards flat. */
export const effectiveFaceShade = (config: VisualConfig): FaceShade =>
  config.faceShade.map((shade) => 1 + (shade - 1) * config.faceShadeStrength) as unknown as FaceShade;
