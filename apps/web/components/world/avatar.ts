/**
 * Blocky avatar rig and its procedural animation clips.
 *
 * Proportions are deliberately chibi rather than the eight-unit block figure of
 * the reference art: the head is a full third of the height and the limbs are
 * slim and short. A correctly proportioned figure reads as lanky at this camera
 * distance, where an avatar is barely a hundred pixels tall — the oversized
 * head is what keeps it legible and likeable. Total height stays 2.85, which
 * reads as about 1.8 m at the world's scale.
 *
 * Faces are drawn into a small canvas and mapped onto the head's -Z side alone,
 * which is the avatar's forward axis. A per-agent hue drives both the skin and
 * the face, so four agents on stage read as four different characters the way
 * they do in the reference.
 *
 * There are two casts. An agent is monochrome — head, shirt and trousers all one
 * hue. A human reading the wiki in a browser is dressed instead, from the
 * palettes below, which is what tells the two apart at a glance on a floor that
 * carries both.
 *
 * Limbs hang from empty pivot groups placed at the joint, which is what lets a
 * plain rotation read as a walk cycle.
 */

import * as THREE from "three";
import type { AgentAction } from "../../lib/world/choreography";

const HEAD = 1.0;
const TORSO_WIDTH = 0.86;
const TORSO_HEIGHT = 1.05;
const TORSO_DEPTH = 0.5;
const ARM = 0.28;
const ARM_LENGTH = 0.95;
const LEG = 0.34;
const LEG_LENGTH = 0.86;

/** Hip height when standing; also the pivot the seated pose lowers. */
export const HIP_HEIGHT = LEG_LENGTH;
/**
 * Hip height of the seated pose. Not the cushion: a thigh is 0.34 thick and
 * hangs under this pivot, so the armchair in props.ts tops its cushion out half
 * a thigh lower, at 0.435, and the leg rests on it.
 */
export const SEAT_HEIGHT = 0.58;

/** Torso and head centres, stacked so the head crown lands at 2.85. */
const TORSO_CENTER = 1.32;
const HEAD_CENTER = 2.85 - HEAD / 2;
/** Shoulders sit just under the torso's top edge, not on it. */
const SHOULDER_HEIGHT = 1.78;
const THIGH_LENGTH = 0.45;

export interface AvatarRig {
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly head: THREE.Mesh;
  readonly armLeft: THREE.Group;
  readonly armRight: THREE.Group;
  /** Open book, held only while the avatar is reading. */
  readonly book: THREE.Group;
  /** The cleaner's tool, built and shown only for the cleaning staff. */
  readonly tool: THREE.Group;
  /**
   * The window cleaner's bucket. Not in the tool group: it is carried in the
   * left hand between rooms and stood on the floor while the glass is wiped, so
   * it hangs off the body and its position is animated between the two.
   */
  readonly bucket: THREE.Group;
  /** Which tool it is, or null for everyone else. Drives the cleaning pose. */
  readonly janitorTool: JanitorTool | null;
  readonly legLeft: THREE.Group;
  readonly legRight: THREE.Group;
  /** Knee pivots, children of the matching thigh. */
  readonly shinLeft: THREE.Group;
  readonly shinRight: THREE.Group;
  readonly materials: readonly THREE.Material[];
  readonly geometries: readonly THREE.BufferGeometry[];
  readonly textures: readonly THREE.Texture[];
}

const limb = (
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  collect: (geometry: THREE.BufferGeometry) => void,
): THREE.Group => {
  const pivot = new THREE.Group();
  const geometry = new THREE.BoxGeometry(width, height, depth);
  collect(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  // Shift the mesh down so the pivot sits at the shoulder / hip.
  mesh.position.y = -height / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
};

/**
 * An eight-by-eight face: two eyes with a lit pupil and a mouth, painted at one
 * pixel per block so it stays hard-edged when the camera zooms.
 */
const createFaceTexture = (skin: THREE.Color, pupil: THREE.Color): THREE.CanvasTexture => {
  const cells = 8;
  const scale = 16;
  const canvas = document.createElement("canvas");
  canvas.width = cells * scale;
  canvas.height = cells * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("world: 2d canvas is unavailable");

  const fill = (x: number, y: number, width: number, height: number, style: string): void => {
    context.fillStyle = style;
    context.fillRect(x * scale, y * scale, width * scale, height * scale);
  };

  fill(0, 0, cells, cells, `#${skin.getHexString()}`);
  // A slightly darker jaw keeps the head from reading as a flat swatch.
  fill(0, 6, cells, 2, `#${skin.clone().offsetHSL(0, 0, -0.07).getHexString()}`);

  const socket = "#15181f";
  fill(1, 3, 2, 2, socket);
  fill(5, 3, 2, 2, socket);
  const iris = pupil.getHexString();
  fill(2, 3, 1, 1, `#${iris}`);
  fill(6, 3, 1, 1, `#${iris}`);
  // A smile: the corners sit a row ABOVE the middle of the mouth. With them a
  // row below — which is where they started — the avatar reads as miserable.
  fill(3, 6, 2, 1, socket);
  fill(2, 5, 1, 1, socket);
  fill(5, 5, 1, 1, socket);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

/**
 * The people, as opposed to the agents.
 *
 * An agent is one hue from head to foot, which is what makes a room full of
 * them read as a cast of machines. A human visitor is dressed instead: a flesh
 * head, a shirt and trousers that do not match. Each palette is indexed
 * independently by the visitor's session hash, so the combinations multiply and
 * a crowd of readers does not turn up as one repeated character — the four
 * skins, seven shirts and five trousers below give 140 of them.
 */
const HUMAN_SKINS: readonly number[] = [0xf2cba7, 0xdca87e, 0xb87f56, 0x8b5c3d];
/**
 * Shirts, deliberately kept out of the flesh band.
 *
 * Nothing here sits near hue 20–40 at a middling saturation, which is where the
 * skins live: a tan or ochre shirt under a tan head reads as one bare torso, and
 * the head stops being a head. Every entry is either far off that hue or deep
 * enough in value that it cannot be mistaken for skin.
 */
const HUMAN_SHIRTS: readonly number[] = [
  0xb3352c, 0x2f7fb5, 0x3d8f4e, 0x6b4fa8, 0xc4478f, 0x2aa198, 0x33404f,
];
const HUMAN_TROUSERS: readonly number[] = [0x3f4a63, 0x4a4640, 0x2f4a3c, 0x5a3f46, 0x38424a];
/** Eyes stay dark on a flesh face; a hue-tinted pupil reads as a costume lens. */
const HUMAN_PUPIL = 0x4a3a2c;

/**
 * What the cleaner on shift is working with.
 *
 * Two of them work the floor and one works the glass, which is what stops three
 * consecutive shifts from reading as the same person in different colours.
 */
export type JanitorTool = "vacuum" | "broom" | "cloth";

export interface AvatarStyle {
  /** A person reading the wiki in a browser, rather than an agent. */
  readonly human?: boolean;
  /**
   * One of the cleaners that work the floor while the archive is quiet, and
   * which tool it carries. Dressed apart from both other casts — blue apron,
   * headphones, a tool in hand — so nobody mistakes one for an agent doing
   * something. Only one is ever on stage, so the tool is what makes two
   * consecutive shifts read as two different people.
   */
  readonly janitor?: JanitorTool;
  /**
   * Stable per-actor value picking one outfit out of the human palettes. The
   * session identifier is what the caller passes: every browsing visitor now
   * has a stable one, and it is the only thing that tells two readers apart.
   */
  readonly variant?: number;
}

export interface AvatarPalette {
  readonly skin: THREE.Color;
  readonly shirt: THREE.Color;
  readonly trousers: THREE.Color;
}

/**
 * The three colours an avatar is built from.
 *
 * Exported because the roster in the HUD paints the same head, and a swatch
 * that disagrees with the avatar it stands for is worse than no swatch at all.
 */
/**
 * An agent's own colour, which has to stay out of the flesh band.
 *
 * An agent is built as one hue: a head, and a torso that is the same hue a
 * couple of stops darker. In the oranges that is precisely the relationship
 * between skin and a tan shirt, and Claude's mascot orange sits in the middle
 * of it — the tone map lifts an authored `hsl(18, 72%, 50%)` to a `#cca06f`
 * head over a `#986c49` torso, which is a person in a beige top, not a machine.
 * Saturating the band and dropping its value keeps the hue that was chosen on
 * purpose and loses the reading. Everything outside the band is untouched: a
 * blue or a violet agent was never in danger of being mistaken for a face.
 */
const FLESH_BAND_FROM = 8;
const FLESH_BAND_TO = 52;

const agentSkin = (hue: number): THREE.Color => {
  const inBand = hue >= FLESH_BAND_FROM && hue <= FLESH_BAND_TO;
  return new THREE.Color().setHSL(hue / 360, inBand ? 0.95 : 0.72, inBand ? 0.42 : 0.5);
};

/** The cleaners' uniform: a grey work shirt under the apron, and dark trousers. */
const JANITOR_SHIRT = 0x4a525f;
const JANITOR_TROUSERS = 0x333a45;
/**
 * The apron, and the ear cups that match it. One shade per tool: only one
 * cleaner is ever on the floor, so the shift that follows has to read as
 * somebody else, and the apron is the second thing that says so after the tool.
 */
const JANITOR_APRONS: Readonly<Record<JanitorTool, number>> = {
  vacuum: 0x4aa8dd,
  broom: 0x69c6ea,
  cloth: 0x3182b8,
};
/** The headphones every one of them wears, and the pole of every tool. */
const JANITOR_HARDWARE = 0x272c34;
/**
 * Where the tool hangs: in the hands, and out in front of the body.
 *
 * Tucked against the chest the vacuum read as a stick the avatar was holding
 * rather than a machine it was pushing, so the anchor sits forward far enough
 * that the whole of it is clear of the torso, and low enough that the cleaning
 * pose's arms reach it. Every tool's length is measured off this: at the
 * carrying tilt below, a part whose local bottom is -1.53 lands on the floor.
 */
const TOOL_ANCHOR_Y = 1.42;
const TOOL_ANCHOR_Z = -0.8;
/** Tilt the tool is carried and worked at, both walking and cleaning. */
const TOOL_TILT = 0.42;
/** Where the window cleaner's rag meets the glass: shoulder-high and in front. */
const GLASS_REACH_Y = 2.02;
const GLASS_REACH_Z = -0.88;

export const avatarPalette = (hue: number, style: AvatarStyle = {}): AvatarPalette => {
  const human = style.human === true || style.janitor !== undefined;
  const variant = style.variant ?? 0;
  const pick = (palette: readonly number[], step: number): number =>
    palette[Math.floor(variant / step) % palette.length] ?? palette[0]!;

  const skin = human ? new THREE.Color(pick(HUMAN_SKINS, 1)) : agentSkin(hue);
  if (style.janitor !== undefined) {
    return {
      skin,
      shirt: new THREE.Color(JANITOR_SHIRT),
      trousers: new THREE.Color(JANITOR_TROUSERS),
    };
  }
  return {
    skin,
    shirt: human
      ? new THREE.Color(pick(HUMAN_SHIRTS, 4))
      : skin.clone().offsetHSL(0, -0.08, -0.22),
    trousers: human
      ? new THREE.Color(pick(HUMAN_TROUSERS, 28))
      : new THREE.Color().setHSL(hue / 360, 0.3, 0.26),
  };
};

export const createAvatar = (hue: number, style: AvatarStyle = {}): AvatarRig => {
  const geometries: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];
  const collect = (geometry: THREE.BufferGeometry) => geometries.push(geometry);

  const janitor = style.janitor ?? null;
  const human = style.human === true || janitor !== null;
  const { skin, shirt, trousers } = avatarPalette(hue, style);

  const headMaterial = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.9, metalness: 0 });
  const faceTexture = createFaceTexture(
    skin,
    human ? new THREE.Color(HUMAN_PUPIL) : new THREE.Color().setHSL(hue / 360, 0.9, 0.72),
  );
  textures.push(faceTexture);
  const faceMaterial = new THREE.MeshStandardMaterial({ map: faceTexture, roughness: 0.9, metalness: 0 });
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.92, metalness: 0 });
  const trouserMaterial = new THREE.MeshStandardMaterial({ color: trousers, roughness: 0.92, metalness: 0 });
  const shoeMaterial = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.85, metalness: 0 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torsoGeometry = new THREE.BoxGeometry(TORSO_WIDTH, TORSO_HEIGHT, TORSO_DEPTH);
  collect(torsoGeometry);
  const torso = new THREE.Mesh(torsoGeometry, shirtMaterial);
  torso.position.y = TORSO_CENTER;
  torso.castShadow = true;
  body.add(torso);

  const headGeometry = new THREE.BoxGeometry(HEAD, HEAD, HEAD);
  collect(headGeometry);
  // Box face order is +X, -X, +Y, -Y, +Z, -Z; the avatar looks down -Z.
  const head = new THREE.Mesh(headGeometry, [
    headMaterial,
    headMaterial,
    headMaterial,
    headMaterial,
    headMaterial,
    faceMaterial,
  ]);
  head.position.y = HEAD_CENTER;
  head.castShadow = true;
  body.add(head);

  const shoulderX = (TORSO_WIDTH + ARM) / 2;
  const armLeft = limb(ARM, ARM_LENGTH, ARM, shirtMaterial, collect);
  armLeft.position.set(-shoulderX, SHOULDER_HEIGHT, 0);
  body.add(armLeft);

  const armRight = limb(ARM, ARM_LENGTH, ARM, shirtMaterial, collect);
  armRight.position.set(shoulderX, SHOULDER_HEIGHT, 0);
  body.add(armRight);

  /**
   * The book the reading pose holds.
   *
   * A child of the torso rather than of a hand: the read pose is static, so the
   * cheapest thing that lands the book between two raised arms is a fixed offset
   * measured off them — at `rotation.x` 1.15 an arm of 0.95 puts its end at
   * y 1.39, z -0.87. It is hidden for every other action.
   */
  const book = new THREE.Group();
  const coverGeometry = new THREE.BoxGeometry(1.0, 0.1, 0.78);
  const pageGeometry = new THREE.BoxGeometry(0.92, 0.09, 0.7);
  const spineGeometry = new THREE.BoxGeometry(0.1, 0.14, 0.78);
  collect(coverGeometry);
  collect(pageGeometry);
  collect(spineGeometry);
  const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x8c3f3f, roughness: 0.9, metalness: 0 });
  const pageMaterial = new THREE.MeshStandardMaterial({ color: 0xf3eede, roughness: 0.95, metalness: 0 });
  const cover = new THREE.Mesh(coverGeometry, coverMaterial);
  cover.castShadow = true;
  book.add(cover);
  const pages = new THREE.Mesh(pageGeometry, pageMaterial);
  pages.position.y = 0.07;
  book.add(pages);
  book.add(new THREE.Mesh(spineGeometry, coverMaterial));
  book.position.set(0, 1.5, -0.66);
  // Held nearly flat rather than upright. Same sign convention as the limbs — a
  // positive rotation.x lifts the far edge — but only a little: the camera looks
  // down at 30°, so a book tipped up towards its reader's face turns edge-on to
  // the shot and reads as a red stick.
  book.rotation.x = 0.35;
  book.visible = false;
  body.add(book);

  /**
   * The cleaning shift's kit: apron, headphones, and whatever it works with.
   *
   * Every tool hangs from the body at a fixed anchor rather than from a hand,
   * and the arms are posed to meet it. Parented to a hand it inherited the
   * arm's swing, and cancelling that back out left the broom floating at an
   * angle of its own: the anchor is the thing that is easy to reason about, and
   * an arm that lands within a few centimetres of it reads as holding it.
   *
   * The floor tools hang between the hands; the window cleaner's rag is up at
   * the glass, on the right.
   */
  const extraMaterials: THREE.Material[] = [];
  const tool = new THREE.Group();
  tool.visible = janitor !== null;
  if (janitor === "cloth") {
    tool.position.set(shoulderX, GLASS_REACH_Y, GLASS_REACH_Z);
    tool.rotation.x = Math.PI / 2;
  } else {
    tool.position.set(0, TOOL_ANCHOR_Y, TOOL_ANCHOR_Z);
  }
  body.add(tool);

  const bucket = new THREE.Group();
  bucket.visible = janitor === "cloth";
  body.add(bucket);

  if (janitor !== null) {
    const apronMaterial = new THREE.MeshStandardMaterial({
      color: JANITOR_APRONS[janitor],
      roughness: 0.95,
      metalness: 0,
    });
    const hardwareMaterial = new THREE.MeshStandardMaterial({
      color: JANITOR_HARDWARE,
      roughness: 0.7,
      metalness: 0.1,
    });
    extraMaterials.push(apronMaterial, hardwareMaterial);

    const part = (
      width: number,
      height: number,
      depth: number,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Object3D,
    ): THREE.Mesh => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      collect(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Apron: a panel down the front, held by a band round the waist.
    part(TORSO_WIDTH + 0.06, 0.9, 0.06, apronMaterial, 0, 1.22, -(TORSO_DEPTH / 2 + 0.04), body);
    part(TORSO_WIDTH + 0.12, 0.14, TORSO_DEPTH + 0.12, apronMaterial, 0, 0.97, 0, body);

    // Headphones, parented to the head so they turn with it. The struts are
    // what make them headphones: an arch and two floating cups read as earmuffs.
    const earX = (HEAD + 0.13) / 2;
    part(HEAD + 0.16, 0.13, 0.34, hardwareMaterial, 0, HEAD / 2 + 0.03, 0, head);
    for (const side of [-1, 1]) {
      part(0.13, 0.36, 0.36, apronMaterial, side * earX, 0.06, 0, head);
      // Band underside is at 0.465, cup top at 0.24: the strut spans the gap.
      part(0.1, 0.235, 0.18, hardwareMaterial, side * earX, 0.352, 0, head);
    }

    if (janitor === "vacuum") {
      // Built large on purpose: at this camera an upright the size of a real one
      // reads as a walking stick. The canister carries the machine's colour and
      // the floor head is what the eye follows across the boards.
      const canisterMaterial = new THREE.MeshStandardMaterial({
        color: 0xd05a3c,
        roughness: 0.75,
        metalness: 0.05,
      });
      extraMaterials.push(canisterMaterial);
      // The handlebar, which is what puts the machine IN the hands: a bar wide
      // enough to reach both of them, with a grip where each one closes.
      part(1.2, 0.1, 0.1, hardwareMaterial, 0, 0.02, 0, tool);
      for (const side of [-1, 1]) {
        part(0.17, 0.13, 0.22, apronMaterial, side * 0.5, 0.02, 0, tool);
      }
      part(0.11, 1.25, 0.11, hardwareMaterial, 0, -0.55, 0, tool);
      part(0.5, 0.6, 0.42, canisterMaterial, 0, -1.05, 0.02, tool);
      // The floor head sits in a group of its own, turned back by exactly the
      // tilt the machine is held at, so it lies FLAT on the boards: tilted with
      // the pole it dug one edge in and lifted the other clear.
      const nozzle = new THREE.Group();
      nozzle.position.set(0, -1.3, -0.06);
      nozzle.rotation.x = -TOOL_TILT;
      tool.add(nozzle);
      part(0.32, 0.2, 0.3, hardwareMaterial, 0, -0.02, -0.16, nozzle);
      part(0.9, 0.18, 0.62, hardwareMaterial, 0, -0.11, -0.34, nozzle);
    } else if (janitor === "broom") {
      // Long enough to reach the floor from the anchor at the tilt it is held
      // at, and no longer: the bristles have to clear the boards at the low end
      // of every stroke.
      const bristleMaterial = new THREE.MeshStandardMaterial({
        color: 0xc79a4e,
        roughness: 0.95,
        metalness: 0,
      });
      extraMaterials.push(bristleMaterial);
      part(0.08, 1.27, 0.08, hardwareMaterial, 0, -0.59, 0, tool);
      part(0.72, 0.1, 0.16, hardwareMaterial, 0, -1.27, -0.04, tool);
      part(0.68, 0.18, 0.22, bristleMaterial, 0, -1.37, -0.04, tool);
    } else {
      // A rag in the right hand and a bucket in the left. The rag is a flat pad
      // against the glass; the bucket is built here but hangs off the body, so
      // it can be put down without leaving the avatar's own space.
      const clothMaterial = new THREE.MeshStandardMaterial({
        color: 0xf0f3f5,
        roughness: 1,
        metalness: 0,
      });
      const waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x8fd0e8,
        roughness: 0.4,
        metalness: 0.05,
      });
      extraMaterials.push(clothMaterial, waterMaterial);
      // The rag is the tool group itself, already turned to lie flat against a
      // vertical pane, so the pad sits at its origin.
      part(0.34, 0.1, 0.3, clothMaterial, 0, 0, 0, tool);

      // Bucket: a tub, a lighter rim, the water inside it, and a wire handle.
      part(0.44, 0.4, 0.44, apronMaterial, 0, 0.2, 0, bucket);
      part(0.48, 0.06, 0.48, hardwareMaterial, 0, 0.42, 0, bucket);
      part(0.36, 0.04, 0.36, waterMaterial, 0, 0.38, 0, bucket);
      part(0.06, 0.3, 0.06, hardwareMaterial, -0.21, 0.55, 0, bucket);
      part(0.06, 0.3, 0.06, hardwareMaterial, 0.21, 0.55, 0, bucket);
      part(0.48, 0.06, 0.06, hardwareMaterial, 0, 0.7, 0, bucket);
    }
  }

  // Legs are two segments so a seated pose can drop the shins vertically
  // instead of leaving one rigid limb sticking out at cushion height.
  const buildLeg = (offsetX: number): { thigh: THREE.Group; shin: THREE.Group } => {
    const thigh = limb(LEG, THIGH_LENGTH, LEG, trouserMaterial, collect);
    thigh.position.set(offsetX, HIP_HEIGHT, 0);

    const shin = limb(LEG - 0.02, LEG_LENGTH - THIGH_LENGTH, LEG - 0.02, shoeMaterial, collect);
    shin.position.y = -THIGH_LENGTH;
    thigh.add(shin);

    body.add(thigh);
    return { thigh, shin };
  };

  const left = buildLeg(-LEG * 0.65);
  const right = buildLeg(LEG * 0.65);

  return {
    root,
    body,
    head,
    armLeft,
    armRight,
    book,
    tool,
    bucket,
    janitorTool: janitor,
    legLeft: left.thigh,
    legRight: right.thigh,
    shinLeft: left.shin,
    shinRight: right.shin,
    materials: [
      headMaterial,
      faceMaterial,
      shirtMaterial,
      trouserMaterial,
      shoeMaterial,
      coverMaterial,
      pageMaterial,
      ...extraMaterials,
    ],
    geometries,
    textures,
  };
};

const approach = (current: number, target: number, rate: number, delta: number): number =>
  current + (target - current) * Math.min(1, rate * delta);

/**
 * Drives the rig for one frame. `phase` accumulates only while walking so a
 * stopped avatar settles instead of freezing mid-stride.
 *
 * Rotation convention: the avatar faces -Z, and a limb hangs along -Y, so a
 * POSITIVE `rotation.x` swings it forward. Getting this sign wrong is what makes
 * a seated figure appear to fold backwards through its own chair.
 */
export const poseAvatar = (
  rig: AvatarRig,
  action: AgentAction,
  phase: number,
  elapsed: number,
  delta: number,
): void => {
  const settle = 9;
  const seatDrop = SEAT_HEIGHT - HIP_HEIGHT;
  const shoulderX = (TORSO_WIDTH + ARM) / 2;

  /**
   * Puts the window cleaner's bucket where it belongs this frame: hanging from
   * the left hand while it walks, standing on the floor beside it while it
   * works. Eased rather than switched, so setting it down and picking it up
   * again are both visible.
   */
  const placeBucket = (grounded: boolean): void => {
    const carriedY = SHOULDER_HEIGHT - Math.cos(rig.armLeft.rotation.x) * ARM_LENGTH - 0.7;
    const target = grounded
      ? { x: -shoulderX - 0.32, y: -rig.body.position.y, z: -0.2 }
      : { x: -shoulderX, y: carriedY, z: -Math.sin(rig.armLeft.rotation.x) * ARM_LENGTH };
    rig.bucket.position.x = approach(rig.bucket.position.x, target.x, 5, delta);
    rig.bucket.position.y = approach(rig.bucket.position.y, target.y, 5, delta);
    rig.bucket.position.z = approach(rig.bucket.position.z, target.z, 5, delta);
  };

  // Only the window cleaner's working arm ever leaves the sagittal plane.
  if (!(action === "clean" && rig.janitorTool === "cloth")) {
    rig.armRight.rotation.z = approach(rig.armRight.rotation.z, 0, settle, delta);
  }

  // The book exists only for the reading pose; it appears when the avatar sits
  // down in READ and goes again the moment it stands up.
  rig.book.visible = action === "read";

  /** Thighs forward and horizontal, shins folded back down to vertical. */
  const sit = (): void => {
    rig.body.position.y = approach(rig.body.position.y, seatDrop, settle, delta);
    rig.legLeft.rotation.x = approach(rig.legLeft.rotation.x, 1.5, settle, delta);
    rig.legRight.rotation.x = approach(rig.legRight.rotation.x, 1.5, settle, delta);
    rig.shinLeft.rotation.x = approach(rig.shinLeft.rotation.x, -1.5, settle, delta);
    rig.shinRight.rotation.x = approach(rig.shinRight.rotation.x, -1.5, settle, delta);
  };

  const stand = (): void => {
    rig.legLeft.rotation.x = approach(rig.legLeft.rotation.x, 0, settle, delta);
    rig.legRight.rotation.x = approach(rig.legRight.rotation.x, 0, settle, delta);
    rig.shinLeft.rotation.x = approach(rig.shinLeft.rotation.x, 0, settle, delta);
    rig.shinRight.rotation.x = approach(rig.shinRight.rotation.x, 0, settle, delta);
  };

  if (action === "walk") {
    const swing = Math.sin(phase) * 0.75;
    rig.legLeft.rotation.x = swing;
    rig.legRight.rotation.x = -swing;
    // Knees only bend backwards, so the trailing leg tucks and the leading one
    // stays straight.
    rig.shinLeft.rotation.x = -Math.max(0, -swing) * 0.9;
    rig.shinRight.rotation.x = -Math.max(0, swing) * 0.9;
    if (rig.janitorTool === "vacuum" || rig.janitorTool === "broom") {
      // Both hands stay on the tool, so only the legs carry the walk.
      rig.armLeft.rotation.x = 1.15 - swing * 0.1;
      rig.armRight.rotation.x = 1.15 + swing * 0.1;
    } else if (rig.janitorTool === "cloth") {
      // Rag in the right hand, bucket weighing down the left.
      rig.armRight.rotation.x = 0.45 + swing * 0.1;
      rig.armLeft.rotation.x = 0.12 - swing * 0.06;
    } else {
      rig.armLeft.rotation.x = -swing * 0.8;
      rig.armRight.rotation.x = swing * 0.8;
    }
    if (rig.janitorTool === "vacuum" || rig.janitorTool === "broom") {
      // Carried at the working tilt, so the head stays just off the floor as it
      // is wheeled from room to room rather than swinging clear of it.
      rig.tool.rotation.x = approach(rig.tool.rotation.x, TOOL_TILT, settle, delta);
      rig.tool.rotation.z = approach(rig.tool.rotation.z, 0, settle, delta);
      rig.tool.position.z = approach(rig.tool.position.z, TOOL_ANCHOR_Z, settle, delta);
    } else if (rig.janitorTool === "cloth") {
      // Rag down at the side, bucket in the other hand.
      const handY = SHOULDER_HEIGHT - Math.cos(rig.armRight.rotation.x) * ARM_LENGTH;
      rig.tool.position.x = approach(rig.tool.position.x, shoulderX, 6, delta);
      rig.tool.position.y = approach(rig.tool.position.y, handY - 0.06, 6, delta);
      rig.tool.position.z = approach(
        rig.tool.position.z,
        -Math.sin(rig.armRight.rotation.x) * ARM_LENGTH,
        6,
        delta,
      );
      rig.tool.rotation.x = approach(rig.tool.rotation.x, 0.25, settle, delta);
      placeBucket(false);
    }
    rig.body.position.y = Math.abs(Math.sin(phase)) * 0.07;
    rig.body.rotation.z = Math.sin(phase) * 0.03;
    rig.head.rotation.x = 0;
    return;
  }

  rig.body.rotation.z = approach(rig.body.rotation.z, 0, settle, delta);

  switch (action) {
    case "read": {
      // Seated, arms raised to hold a book, head dipping over it.
      sit();
      rig.armLeft.rotation.x = approach(rig.armLeft.rotation.x, 1.15, settle, delta);
      rig.armRight.rotation.x = approach(rig.armRight.rotation.x, 1.15, settle, delta);
      rig.head.rotation.x = approach(rig.head.rotation.x, 0.3 + Math.sin(elapsed * 0.9) * 0.05, settle, delta);
      break;
    }
    case "type": {
      // Seated at a desk, forearms oscillating out of phase.
      sit();
      rig.armLeft.rotation.x = 1.3 + Math.sin(elapsed * 13) * 0.12;
      rig.armRight.rotation.x = 1.3 + Math.sin(elapsed * 13 + 2.1) * 0.12;
      rig.head.rotation.x = approach(rig.head.rotation.x, 0.2, settle, delta);
      break;
    }
    case "browse": {
      // Standing at a screen, one arm raised and drifting.
      rig.body.position.y = approach(rig.body.position.y, 0, settle, delta);
      stand();
      rig.armRight.rotation.x = 1.5 + Math.sin(elapsed * 2.4) * 0.22;
      rig.armLeft.rotation.x = approach(rig.armLeft.rotation.x, 0.12, settle, delta);
      rig.head.rotation.x = approach(rig.head.rotation.x, 0.05, settle, delta);
      break;
    }
    case "scan": {
      // Working a shelf rather than a desk: standing, one arm up tracing the
      // spines, the head sweeping the row it is reading off. Wider and slower
      // than `browse`, which is somebody at a screen.
      rig.body.position.y = approach(rig.body.position.y, 0, settle, delta);
      stand();
      rig.armRight.rotation.x = 1.15 + Math.sin(elapsed * 1.15) * 0.42;
      rig.armLeft.rotation.x = approach(rig.armLeft.rotation.x, 0.1, settle, delta);
      rig.head.rotation.y = Math.sin(elapsed * 0.9) * 0.52;
      rig.head.rotation.x = approach(rig.head.rotation.x, -0.12, settle, delta);
      break;
    }
    case "sort": {
      // Lifting and lowering a crate, knees slightly bent.
      const lift = (Math.sin(elapsed * 2.2) + 1) * 0.5;
      rig.body.position.y = approach(rig.body.position.y, -0.1 - lift * 0.14, settle, delta);
      rig.legLeft.rotation.x = approach(rig.legLeft.rotation.x, 0.3, settle, delta);
      rig.legRight.rotation.x = approach(rig.legRight.rotation.x, 0.3, settle, delta);
      rig.shinLeft.rotation.x = approach(rig.shinLeft.rotation.x, -0.3, settle, delta);
      rig.shinRight.rotation.x = approach(rig.shinRight.rotation.x, -0.3, settle, delta);
      rig.armLeft.rotation.x = 1.05 + lift * 0.45;
      rig.armRight.rotation.x = 1.05 + lift * 0.45;
      rig.head.rotation.x = approach(rig.head.rotation.x, 0.26, settle, delta);
      break;
    }
    case "clean": {
      // Standing, both hands on the tool, working it back and forth. Which way
      // it travels is the tool's own: a vacuum is pushed away and pulled back,
      // a broom and a mop are swung across the floor.
      const stroke = Math.sin(elapsed * 2.4);
      rig.body.position.y = approach(rig.body.position.y, -0.04, settle, delta);
      stand();
      // Nodding along to whatever is in the headphones.
      rig.head.rotation.y = Math.sin(elapsed * 2.4) * 0.12;
      rig.body.rotation.z = Math.sin(elapsed * 2.4) * 0.02;

      if (rig.janitorTool === "cloth") {
        // Wiping the glass: the rag goes round in a circle against the pane and
        // the working arm follows it, while the bucket stands on the floor —
        // which is what the walk was carrying it for.
        const swirl = elapsed * 3;
        rig.tool.position.x = shoulderX + Math.sin(swirl) * 0.22;
        rig.tool.position.y = GLASS_REACH_Y + Math.cos(swirl) * 0.18;
        rig.tool.position.z = GLASS_REACH_Z;
        rig.tool.rotation.x = Math.PI / 2;
        rig.tool.rotation.z = 0;
        rig.armRight.rotation.x = 1.85 + Math.cos(swirl) * 0.12;
        rig.armRight.rotation.z = Math.sin(swirl) * 0.18;
        rig.armLeft.rotation.x = approach(rig.armLeft.rotation.x, 0.14, settle, delta);
        rig.head.rotation.x = approach(rig.head.rotation.x, -0.14, settle, delta);
        placeBucket(true);
      } else if (rig.janitorTool === "broom") {
        // Swept side to side: both hands stay on the pole and the head swings
        // out at the end of it.
        rig.armLeft.rotation.x = 1.23 + stroke * 0.1;
        rig.armRight.rotation.x = 1.23 + stroke * 0.1;
        rig.tool.rotation.x = TOOL_TILT;
        rig.tool.rotation.z = stroke * 0.45;
        rig.tool.position.z = TOOL_ANCHOR_Z;
        rig.head.rotation.x = approach(rig.head.rotation.x, 0.2, settle, delta);
      } else {
        // An upright vacuum is pushed away and pulled back flat on the floor, so
        // the whole machine slides rather than pivoting — tilting it would lift
        // the head off the boards at one end of every stroke.
        rig.armLeft.rotation.x = 1.23 + stroke * 0.1;
        rig.armRight.rotation.x = 1.23 + stroke * 0.1;
        rig.tool.rotation.x = TOOL_TILT;
        rig.tool.rotation.z = 0;
        rig.tool.position.z = TOOL_ANCHOR_Z - (stroke + 1) * 0.15;
        rig.head.rotation.x = approach(rig.head.rotation.x, 0.2, settle, delta);
      }
      break;
    }
    case "leave":
    case "idle":
    default: {
      // Breathing idle with an occasional look around.
      rig.body.position.y = approach(rig.body.position.y, Math.sin(elapsed * 1.6) * 0.035, settle, delta);
      stand();
      rig.armLeft.rotation.x = approach(rig.armLeft.rotation.x, Math.sin(elapsed * 1.6) * 0.06, settle, delta);
      rig.armRight.rotation.x = approach(rig.armRight.rotation.x, -Math.sin(elapsed * 1.6) * 0.06, settle, delta);
      rig.head.rotation.y = Math.sin(elapsed * 0.42) * 0.38;
      rig.head.rotation.x = approach(rig.head.rotation.x, 0, settle, delta);
      break;
    }
  }

  // Standing about between rooms, or on the way out: the bucket is in hand.
  if (rig.janitorTool === "cloth" && action !== "clean") placeBucket(false);
};

/**
 * Fades a whole avatar.
 *
 * Used to tell a replayed avatar from a live one when both are on the floor at
 * once: the recording is a ghost of something that already happened, and the
 * only honest way to show it beside a live agent is to make it read as less
 * present. Every material belongs to this rig alone — `createAvatar` builds a
 * fresh set per avatar — so this never touches anybody else.
 */
export const setAvatarOpacity = (rig: AvatarRig, opacity: number): void => {
  const solid = opacity >= 0.999;
  for (const material of rig.materials) {
    material.transparent = !solid;
    // Depth writing stays on: these are opaque solids seen through, not glass,
    // and turning it off lets an avatar's own far side show through its front.
    material.opacity = opacity;
    material.needsUpdate = true;
  }
};

export const disposeAvatar = (rig: AvatarRig): void => {
  for (const geometry of rig.geometries) geometry.dispose();
  for (const material of rig.materials) material.dispose();
  for (const texture of rig.textures) texture.dispose();
};
