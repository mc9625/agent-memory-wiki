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
/** Cushion height the seated pose targets, matching the armchair in props.ts. */
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
const createFaceTexture = (skin: THREE.Color, hue: number): THREE.CanvasTexture => {
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
  const pupil = new THREE.Color().setHSL(hue / 360, 0.9, 0.72).getHexString();
  fill(2, 3, 1, 1, `#${pupil}`);
  fill(6, 3, 1, 1, `#${pupil}`);
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

export const createAvatar = (hue: number): AvatarRig => {
  const geometries: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];
  const collect = (geometry: THREE.BufferGeometry) => geometries.push(geometry);

  const skin = new THREE.Color().setHSL(hue / 360, 0.72, 0.5);
  const shirt = skin.clone().offsetHSL(0, -0.08, -0.22);
  const trousers = new THREE.Color().setHSL(hue / 360, 0.3, 0.26);

  const headMaterial = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.9, metalness: 0 });
  const faceTexture = createFaceTexture(skin, hue);
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
    rig.armLeft.rotation.x = -swing * 0.8;
    rig.armRight.rotation.x = swing * 0.8;
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
};

export const disposeAvatar = (rig: AvatarRig): void => {
  for (const geometry of rig.geometries) geometry.dispose();
  for (const material of rig.materials) material.dispose();
  for (const texture of rig.textures) texture.dispose();
};
