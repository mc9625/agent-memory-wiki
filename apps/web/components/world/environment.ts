/**
 * The set.
 *
 * Everything static lives here: the floor plate, the shells of the six rooms,
 * the props that dress them and the signage. Nothing in this file knows about
 * agents — `world-canvas.tsx` walks avatars through the result.
 *
 * Three geometry sources feed it, chosen by what the shape needs:
 *   - `furniture.ts` (boxes) for anything rectilinear, which is most of it;
 *   - `props.ts` via `voxel.ts` for the armchair and the bookshelf, whose
 *     silhouettes are worth authoring cell by cell;
 *   - `textures.ts` for lettering and tiling, which geometry cannot express.
 *
 * All box props share three materials — lit, unlit and glass — so the whole set
 * costs a few dozen draw calls no matter how many objects are placed.
 *
 * ## Where the walls go
 *
 * The camera looks down the (1, 1, 1) diagonal, so a face is towards it only if
 * its normal points +X or +Z. Every room is therefore closed on the sides that
 * face away — the sides whose *inner* faces the camera can see — and glazed on
 * the rest, with a six-unit doorway on the side `layout.ts` routes avatars
 * through. That single rule is what puts the bookshelves, the whiteboard, the
 * wall screen and the archive shelving where the reference has them.
 */

import * as THREE from "three";
import {
  PLAN_OBSTACLES,
  PLAN_ROOMS,
  ROOMS,
  ROOM_SHIFT,
  type Room,
  type RoomId,
} from "../../lib/world/layout";
import { ARMCHAIR, BOOKSHELF } from "./props";
import { buildVoxelGeometry } from "./voxel";
import {
  createCarpetTexture,
  createFoliageTexture,
  createPlasterTexture,
  createSurfaceTexture,
  createTextTexture,
  createTileTexture,
  createParquetTexture,
} from "./textures";
import * as F from "./furniture";
import type { BuiltProp } from "./build";

const WALL_HEIGHT = 4.2;

/**
 * LINKS' screen wall runs taller than the rest: it carries the wall display and
 * the room plaque one above the other, and at the standard height the plaque
 * lands on the display's bezel instead of clearing it.
 */
const LINKS_WALL_HEIGHT = 6.4;

/**
 * READ's plaque wall, likewise raised so the plaque clears the bookcases below
 * it. It cannot go as high as LINKS': READ sits at the top-left of the frame,
 * and the plaque runs out of screen before the wall runs out of reasons.
 */
const READ_WALL_HEIGHT = 5.6;

/** EDIT's plaque wall, raised for the same reason as the other two. */
const EDIT_WALL_HEIGHT = 6.0;

/**
 * ARCHIVE's plaque wall. Its pigeonhole case stands 4.8 high, so the plaque has
 * to clear more here than anywhere else; the room sits mid-frame on the right,
 * with room above it that READ does not have.
 */
const ARCHIVE_WALL_HEIGHT = 6.6;
const WALL_THICKNESS = 0.4;
const GLASS_HEIGHT = 3.4;
const DESK_TOP = 1.24;

/** Rotation that turns a prop's -Z face towards the camera. */
const CAMERA_FACING = (-3 * Math.PI) / 4;

/**
 * Carpet tint per room. Held one step off full saturation on purpose: the
 * reference reads as coloured *light* on a muted weave, and a fully saturated
 * slab fights the walls instead of sitting under them.
 */
const CARPET: Readonly<Record<string, number>> = {
  read: 0x77873f,
  edit: 0x6f4f93,
  links: 0x74a9a1,
  archive: 0xaea99b,
};

/**
 * One of the four room lights, paired with the intensity it was authored at.
 * `VISUAL_CONFIG.roomLightScale` multiplies that base rather than replacing it,
 * so the reading lamp stays dimmer than the crystal at every setting.
 */
export interface RoomLight {
  readonly light: THREE.PointLight;
  readonly baseIntensity: number;
}

export interface BuiltEnvironment {
  readonly group: THREE.Group;
  /** The four shadowless room lights, so their intensity can be tuned live. */
  readonly roomLights: readonly RoomLight[];
  /** The lit core of the hub crystal, pulsed when an article is created. */
  readonly hubCrystal: THREE.Mesh;
  readonly hubCrystalMaterial: THREE.MeshBasicMaterial;
  /** Faces emitted by the voxel compiler, reported for the console banner. */
  readonly voxelFaceCount: number;
  /**
   * The group each room's props ride in, positioned at that room's shift.
   *
   * Exposed for `?edit=1`, which previews a room move by moving its frame:
   * every coordinate inside it is authored in the plan, so the frame is the one
   * place a whole room can be moved without restating anything.
   */
  readonly roomFrames: ReadonlyMap<RoomId, THREE.Group>;
  /**
   * Fades the three corner offices, which exist only to keep the corners of a
   * wide shot off bare floor. A portrait frame has no such corners to fill —
   * there they read as rooms floating on their own — so the page fades them
   * out. 1 is the built scene; 0 removes them from the frame entirely.
   */
  setSceneryOpacity(value: number): void;
  dispose(): void;
}

export const buildEnvironment = (): BuiltEnvironment => {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const track = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };
  const trackMaterial = <T extends THREE.Material>(material: T): T => {
    materials.push(material);
    return material;
  };

  // One grain texture, shared by every lit prop. Both geometry paths emit UVs
  // measured in blocks, so it lands at the same density on all of them.
  const surfaceTexture = createSurfaceTexture();
  textures.push(surfaceTexture);

  const solidMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: surfaceTexture,
      // Rough and non-metallic: the set is painted wood, plaster and fabric, and
      // a specular highlight on a voxel would only read as an artefact.
      roughness: 0.88,
      metalness: 0,
    }),
  );
  const glowMaterial = trackMaterial(new THREE.MeshBasicMaterial({ vertexColors: true }));

  // Lit exactly like the solids, but under the coarse mottle rather than the
  // block grain: the grain's bevelled border framed every leaf cube and the
  // canopies came back as wire grids.
  const foliageTexture = createFoliageTexture();
  textures.push(foliageTexture);
  const foliageMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: foliageTexture,
      roughness: 0.94,
      metalness: 0,
    }),
  );
  /*
   * Unlit, like the `glow` channel — a lit pane was the whole problem.
   *
   * As a MeshPhysicalMaterial the pane's colour was `PALETTE.glass` times the
   * light landing on it, and the partitions stand in the spot's pool: the key
   * blew them to white, and white at a third opacity over a pale set is not a
   * pane, it is nothing. Unlit, what blends over the room is exactly the
   * authored tint, whichever way the panel faces and wherever it stands.
   */
  const glassMaterial = trackMaterial(
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Flat tint carries further than a lit one did, so this sits below the
      // 0.38 the lit material needed. Much past it the room behind goes milky.
      opacity: 0.3,
      // Without this the glass would hide whatever stands behind it.
      depthWrite: false,
    }),
  );
  const plaster = createPlasterTexture(9, 3);
  textures.push(plaster);
  const wallMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({ color: 0xf0ebdf, map: plaster, roughness: 0.96, metalness: 0 }),
  );
  const skirtingMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({ color: 0xc2bcac, roughness: 0.9, metalness: 0 }),
  );

  /* ------------------------------------------------------------ placement */

  /**
   * Room frames.
   *
   * Every coordinate written below is in the floor plan as *authored*, at the
   * original room spacing — which is also how `layout.ts` reads. The rooms then
   * sit closer to the hub than that plan says, by `ROOM_SHIFT`, and rather than
   * restating a hundred numbers each room's props go into a group carrying that
   * shift. So `inRoom` is what makes a coordinate here mean the same thing as
   * the same coordinate in the plan, and moving a room is one value in
   * `layout.ts` rather than an edit in two files that can disagree.
   *
   * Anything read straight out of `layout.ts` — the carpets, the obstacle list —
   * is already shifted, so it is placed at the root instead.
   */
  const roomFrames = new Map<RoomId, THREE.Group>();
  let parent: THREE.Group = group;
  /** The room whose frame `place` is currently adding to, or null at the root. */
  let currentRoom: RoomId | null = null;
  const inRoom = <T>(id: RoomId, dress: (plan: Room) => T): T => {
    let frame = roomFrames.get(id);
    if (!frame) {
      frame = new THREE.Group();
      const shift = ROOM_SHIFT[id];
      frame.position.set(shift.x, 0, shift.z);
      group.add(frame);
      roomFrames.set(id, frame);
    }
    const plan = PLAN_ROOMS.find((room) => room.id === id);
    if (!plan) throw new Error(`Unknown room: ${id}`);
    parent = frame;
    currentRoom = id;
    const built = dress(plan);
    parent = group;
    currentRoom = null;
    return built;
  };

  /**
   * What the editor needs to know about a placed object, recorded on the object
   * itself rather than in a table beside it.
   *
   * `?edit=1` walks the built scene looking for these: a prop with no stamp is
   * a prop it cannot select, and a prop it can select it can also name in the
   * patch it exports. The id is positional — `plant-tall#3` is the third of
   * that key placed — so the authored transform travels with it, because that
   * is what makes an exported line greppable back to the call that wrote it.
   *
   * Nothing in the page reads this. It costs one object per prop.
   */
  const placedCount = new Map<string, number>();
  const stamp = (
    object: THREE.Object3D,
    key: string,
    id: string | undefined,
    x: number,
    y: number,
    z: number,
    rotationY: number,
  ): void => {
    const seen = (placedCount.get(key) ?? 0) + 1;
    placedCount.set(key, seen);
    object.userData.editable = {
      id: id ?? `${key}#${seen}`,
      key,
      room: currentRoom,
      authored: { x, y, z, rotationY },
    };
  };

  const propCache = new Map<string, BuiltProp>();

  /**
   * Places a prop, compiling its geometry the first time the key is seen. A
   * prop can contribute up to three meshes, one per material channel.
   */
  const place = (
    key: string,
    make: () => BuiltProp,
    x: number,
    y: number,
    z: number,
    rotationY = 0,
    /** Overrides the positional id, to tie a prop to the lettering on it. */
    id?: string,
  ): THREE.Group => {
    let prop = propCache.get(key);
    if (!prop) {
      prop = make();
      propCache.set(key, prop);
      for (const geometry of [prop.solid, prop.glow, prop.glass, prop.foliage]) {
        if (geometry) track(geometry);
      }
    }

    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = rotationY;

    if (prop.solid) {
      const mesh = new THREE.Mesh(prop.solid, solidMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder.add(mesh);
    }
    if (prop.foliage) {
      const mesh = new THREE.Mesh(prop.foliage, foliageMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder.add(mesh);
    }
    if (prop.glow) holder.add(new THREE.Mesh(prop.glow, glowMaterial));
    if (prop.glass) {
      const mesh = new THREE.Mesh(prop.glass, glassMaterial);
      mesh.renderOrder = 2;
      holder.add(mesh);
    }

    stamp(holder, key, id, x, y, z, rotationY);
    parent.add(holder);
    return holder;
  };

  let voxelFaceCount = 0;
  const voxelCache = new Map<string, THREE.BufferGeometry>();

  const placeVoxel = (
    key: string,
    model: typeof ARMCHAIR,
    x: number,
    z: number,
    rotationY: number,
  ): THREE.Mesh => {
    let geometry = voxelCache.get(key);
    if (!geometry) {
      const built = buildVoxelGeometry(model);
      voxelFaceCount += built.faceCount;
      geometry = track(built.geometry);
      voxelCache.set(key, geometry);
    }
    const mesh = new THREE.Mesh(geometry, solidMaterial);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    stamp(mesh, key, undefined, x, 0, z, rotationY);
    parent.add(mesh);
    return mesh;
  };

  /** Lettering, mounted a hair in front of whatever it is printed on. */
  const placeText = (
    lines: readonly string[],
    height: number,
    x: number,
    y: number,
    z: number,
    rotationY: number,
    color = "#e6e3db",
    options: {
      readonly tracking?: number;
      readonly padding?: number;
      /** Skips tone mapping, so the glyphs stay over the bloom threshold. */
      readonly glow?: boolean;
      /**
       * The id of the prop this lettering is printed on, so `?edit=1` moves the
       * two together. Without it a dragged plaque slides out from under its own
       * letters.
       */
      readonly id?: string;
    } = {},
  ): void => {
    const { glow = false, id, ...textOptions } = options;
    const { texture, aspect } = createTextTexture(lines, { color, ...textOptions });
    textures.push(texture);
    const geometry = track(new THREE.PlaneGeometry(height * aspect, height));
    const material = trackMaterial(
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: !glow,
      }),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    // A plane's normal is +Z, while a prop's front is -Z: the lettering faces
    // out of the surface it is printed on only if it is turned the other way.
    mesh.rotation.y = rotationY + Math.PI;
    mesh.renderOrder = 3;
    stamp(mesh, "text", id, x, y, z, rotationY);
    parent.add(mesh);
  };

  /* ---------------------------------------------------------------- floor */

  // A step darker than the walls. At the earlier value the corridor was the
  // brightest thing in the frame and the props had nothing to sit against, and
  // it came down again once the woods went lighter.
  const tile = createTileTexture("#aca79b", "#928d81", 48);
  textures.push(tile);
  const floor = new THREE.Mesh(
    track(new THREE.BoxGeometry(140, 0.8, 140)),
    trackMaterial(new THREE.MeshStandardMaterial({ map: tile, roughness: 0.82, metalness: 0 })),
  );
  floor.position.set(0, -0.4, 0);
  floor.receiveShadow = true;
  group.add(floor);

  /* ------------------------------------------------------------ room shells */

  const addWall = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number = WALL_HEIGHT,
  ): void => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(width, height, depth)), wallMaterial);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    // A darker skirting reads as the contact shadow the reference has underneath.
    const skirting = new THREE.Mesh(
      track(new THREE.BoxGeometry(width + 0.12, 0.4, depth + 0.12)),
      skirtingMaterial,
    );
    skirting.position.set(x, 0.2, z);
    parent.add(skirting);
  };

  const addCarpet = (room: Room): void => {
    // ARCHIVE is boarded, not carpeted, which is what the reference shows.
    const texture =
      room.id === "archive" ? createParquetTexture() : createCarpetTexture(CARPET[room.id] ?? 0xc6c4bf);
    textures.push(texture);
    const carpet = new THREE.Mesh(
      track(new THREE.BoxGeometry(room.width, 0.16, room.depth)),
      trackMaterial(new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })),
    );
    // Sunk into the concourse rather than laid on top of it. At the full 0.16
    // the room floor stood proud of the corridor, and everything standing in it
    // — chair legs, crate corners, an avatar's shoes, the vacuum's head — was
    // buried to that depth, because props and avatars are all placed at y 0.
    // Two centimetres of lip is enough to read as an inlay and shallow enough
    // to hide nothing.
    carpet.position.set(room.center.x, -0.06, room.center.z);
    carpet.receiveShadow = true;
    parent.add(carpet);

    if (room.open) return;
    for (const [width, depth, offsetX, offsetZ] of [
      [room.width + 0.6, 0.6, 0, room.depth / 2],
      [room.width + 0.6, 0.6, 0, -room.depth / 2],
      [0.6, room.depth + 0.6, room.width / 2, 0],
      [0.6, room.depth + 0.6, -room.width / 2, 0],
    ] as const) {
      const strip = new THREE.Mesh(
        track(new THREE.BoxGeometry(width, 0.18, depth)),
        trackMaterial(
          new THREE.MeshStandardMaterial({ color: F.PALETTE.wood, roughness: 0.85, metalness: 0 }),
        ),
      );
      // Same reasoning as the carpet, and more so: the doorway strips are the
      // one bit of trim an avatar walks straight over.
      strip.position.set(room.center.x + offsetX, -0.05, room.center.z + offsetZ);
      strip.receiveShadow = true;
      parent.add(strip);
    }
  };

  // The open rooms — the plaza and the entrance — sit straight on the concourse
  // tiling. A slab under either one reads as a rug nobody laid.
  //
  // Laid in the room's own frame, from the plan, rather than at the root from
  // the shifted list: a room's floor is part of that room, and a carpet left at
  // the root is a carpet that stays behind when the room moves.
  for (const plan of PLAN_ROOMS) if (!plan.open) inRoom(plan.id, addCarpet);

  // Glazed partitions. The pair of short runs on a room's doorway side leaves
  // the six units in the middle open, which is where avatars walk through.
  const glass = (length: number, x: number, z: number, rotationY: number): void => {
    place(`glass-${length}`, () => F.glassPartition(length, GLASS_HEIGHT), x, 0, z, rotationY);
  };

  // Each shell goes up inside its room's frame: solid on the sides whose inner
  // face the camera can see, glazed on the rest.
  inRoom("read", () => {
    addWall(-27, -2, WALL_THICKNESS, 14.4, READ_WALL_HEIGHT); // back wall
    addWall(-20, -9, 14.4, WALL_THICKNESS, READ_WALL_HEIGHT); // north
    glass(4, -13, -7, Math.PI / 2);
    glass(4, -13, 3, Math.PI / 2);
    glass(14, -20, 5, 0);
  });
  inRoom("edit", () => {
    addWall(-5, -20, WALL_THICKNESS, 14.4); // west
    addWall(2, -27, 14.4, WALL_THICKNESS, EDIT_WALL_HEIGHT); // north
    glass(4, -3, -13, 0);
    glass(4, 7, -13, 0);
    glass(14, 9, -20, Math.PI / 2);
  });
  inRoom("links", () => {
    addWall(-9, 20, WALL_THICKNESS, 14.4, LINKS_WALL_HEIGHT); // west
    glass(4, -7, 13, 0);
    glass(4, 3, 13, 0);
    glass(14, 5, 20, Math.PI / 2);
    glass(14, -2, 27, 0);
  });
  inRoom("archive", () => {
    addWall(20, -5, 14.4, WALL_THICKNESS, ARCHIVE_WALL_HEIGHT); // north
    glass(4, 13, -3, Math.PI / 2);
    glass(4, 13, 7, Math.PI / 2);
    glass(14, 20, 9, 0);
    glass(14, 27, 2, Math.PI / 2);
  });

  /* ------------------------------------------------------------------ READ */

  // A seat point is where the avatar's hips go, so the chair stands one voxel
  // behind it: that puts the cushion's front edge under the knees instead of
  // under the shins, which is what used to swallow them.
  inRoom("read", (plan) => {
    for (const [index, seat] of plan.seats.entries()) {
      placeVoxel(`armchair-${index}`, ARMCHAIR, seat.x - 0.145, seat.z, -Math.PI / 2);
    }
    for (const x of [-25, -21.5, -18]) placeVoxel(`bookshelf-${x}`, BOOKSHELF, x, -8.5, Math.PI);
    place("lamp-table", F.lampTable, -25.6, 0, 3.6, Math.PI);
    place("plant-ficus", F.plantFicus, -14.6, 0, -7.4);
    place("plant-ficus", F.plantFicus, -25.6, 0, -6.6);
    place("cabinet", F.filingCabinet, -26.2, 0, 0.2, -Math.PI / 2);
    place("plant-small", F.plantSmall, -26.2, 1.6, 0.2);
    // Moved off the tall plant's line. White ground, with the mount left at
    // PALETTE.paper so the frame still steps down from board to surround.
    place(
      "frame-poster",
      () => F.pictureFrame(4.4, 3.2, 0xffffff),
      -26.75,
      3.4,
      -2.4,
      -Math.PI / 2,
    );
    placeText(["KNOWLEDGE", "IS", "POWER"], 2.35, -26.64, 3.4, -2.4, -Math.PI / 2, "#171b22");
  });

  /* ------------------------------------------------------------------ EDIT */

  inRoom("edit", (plan) => {
    for (const seat of plan.seats) {
      place("desk", F.desk, seat.x, 0, seat.z - 1.7);
      place("monitor", F.monitor, seat.x, DESK_TOP, seat.z - 2.1, Math.PI);
      place("keyboard", F.keyboard, seat.x, DESK_TOP, seat.z - 1.15);
      place("office-chair", F.officeChair, seat.x, 0, seat.z + 0.5);
    }
    place("whiteboard", F.whiteboard, 6.4, 2.8, -26.75, Math.PI);
    placeText(
      ["RESEARCH", "WRITE", "REVIEW", "PUBLISH"],
      1.5,
      6.4,
      2.8,
      -26.64,
      Math.PI,
      "#2b3038",
    );
    placeVoxel("bookshelf-edit", BOOKSHELF, -4.4, -22.5, -Math.PI / 2);
    place("plant-small", F.plantSmall, 6.4, DESK_TOP, -23.9);
    place("plant-ficus", F.plantFicus, 8.0, 0, -25.8);
    place("plant-ficus", F.plantFicus, -3.6, 0, -14.4);
    place("cabinet", F.filingCabinet, 8.2, 0, -15.6, Math.PI);
    place("plant-small", F.plantSmall, 8.2, 1.6, -15.6);
  });

  /* ----------------------------------------------------------------- LINKS */

  inRoom("links", () => {
    place("wall-screen", F.wallScreen, -8.6, 2.5, 20, -Math.PI / 2);
    placeText(["LINKS"], 0.46, -8.5, 3.56, 21.6, -Math.PI / 2, "#ffffff");
    // Turned to face the wall screen, the way the reference sits its workstation
    // under the display rather than in the far corner.
    place("desk", F.desk, 0.4, 0, 17.6, -Math.PI / 2);
    place("laptop", F.laptop, 0.2, DESK_TOP, 17.6, -Math.PI / 2);
    place("office-chair", F.officeChair, 2.2, 0, 17.6, Math.PI / 2);
    place("cabinet", F.filingCabinet, 4.2, 0, 15.8, Math.PI / 2);
    place("shelf-boxes", F.shelfBoxes, 4.2, 1.6, 15.8, Math.PI / 2);
    // The lounge pair moved to the room's -X half in the set editor, which is
    // the side the doorway legs run down. The chair landed clear, but the table
    // landed on top of LINKS' third standby spot at a measured 0.00 — a spot is
    // a place an actor stands, so that is a prop worn as a hat, not a near
    // miss. It has been walked north to z 25.4, which puts it at 1.45. Both are
    // in `PLAN_SCENERY` now, so the clearance test measures them.
    place("lounge-chair", F.loungeChair, -7.5, 0, 15, -Math.PI / 2);
    place("lounge-table", F.loungeTable, -6, 0, 14.5, Math.PI / 2);
    place("plant-ficus", F.plantFicus, -7.5, 0, 25.75);
    place("plant-ficus", F.plantFicus, 3.6, 0, 26.0);
    place("frame-art-a", () => F.pictureFrame(1.7, 1.5, 0x5f8f4a), -8.75, 3.1, 15.0, -Math.PI / 2);
  });

  /* --------------------------------------------------------------- ARCHIVE */

  inRoom("archive", () => {
    place("archive-shelf", () => F.archiveShelf(4, 3), 19.6, 0, -4.3, Math.PI);
    place("desk", F.desk, 23.25, 0, 4.5, Math.PI);
    place("plant-ficus", F.plantFicus, 17, 0, 7.75);
    place("plant-ficus", F.plantFicus, 26.0, 0, 1.25);
    place("frame-poster-b", () => F.pictureFrame(2.2, 2.0, 0xe8dcc0), 25.4, 2.9, -4.75, Math.PI);
    placeText(["ORGANIZE", "PRESERVE", "SHARE"], 1.1, 25.4, 2.9, -4.64, Math.PI, "#4a3524");
    // Outside the east glass, which is the wall the frame's bottom-right corner
    // looks straight at. Not in `OBSTACLES`: no route reaches this side of the
    // room, which is served only by the doorway on the far one.
    for (const z of [-2, 4]) place("hedge-4", () => F.hedgePlanter(4), 28.0, 0, z, Math.PI / 2);
  });

  /* ------------------------------------------------------------------- HUB */

  // The fountain is built inside the hub's frame like any other room, and hands
  // back the two things the animation in `world-canvas.tsx` drives.
  const { hubCrystal, hubCrystalMaterial } = inRoom("hub", () => {
    place("hub-plinth", F.hubPlinth, 0, 0, -3);

    // Base of the monolith, which is the plinth's inner slab plus its lit pad.
    const HUB_BASE = 0.5;

    // Built by hand rather than through `place`, so its edges can take a material
    // of their own: skipping tone mapping keeps them at full white, which is what
    // pushes them clear of the bloom threshold the rest of the set sits under.
    const monolithProp = F.hubMonolith();
    for (const geometry of [monolithProp.solid, monolithProp.glow, monolithProp.glass]) {
      if (geometry) track(geometry);
    }
    const monolithHolder = new THREE.Group();
    monolithHolder.position.set(0, HUB_BASE, -3);
    if (monolithProp.glow) {
      const edges = new THREE.Mesh(
        monolithProp.glow,
        trackMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
      );
      monolithHolder.add(edges);
    }
    if (monolithProp.glass) {
      const shell = new THREE.Mesh(monolithProp.glass, glassMaterial);
      shell.renderOrder = 2;
      monolithHolder.add(shell);
    }
    parent.add(monolithHolder);

    // The core keeps its own holder: the animation spins and breathes it, and the
    // shell and its edges must not follow.
    const crystalProp = F.hubCrystal();
    for (const geometry of [crystalProp.solid, crystalProp.glow, crystalProp.glass]) {
      if (geometry) track(geometry);
    }
    const crystalHolder = new THREE.Group();
    crystalHolder.position.set(0, HUB_BASE, -3);
    const hubCrystalMaterial = trackMaterial(
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }),
    );
    const hubCrystal = new THREE.Mesh(
      crystalProp.glow ?? track(new THREE.BoxGeometry(1.45, 2.65, 1.45)),
      hubCrystalMaterial,
    );
    crystalHolder.add(hubCrystal);
    parent.add(crystalHolder);

    // Lettering on the two faces the isometric camera sees: +Z reads to the left
    // of the screen, +X to the right. Held near white so it blooms with the edges.
    const HUB_TEXT_Y = HUB_BASE + 1.9;
    // Tight tracking and a thin margin: both come straight off the glyph size,
    // and the face is only 1.9 wide to fit four letters into.
    const HUB_TEXT = { tracking: 0.05, padding: 0.12, glow: true } as const;
    placeText(
      ["WIKI"],
      0.96,
      0,
      HUB_TEXT_Y,
      -3 + F.HUB_MONOLITH.depth / 2 + 0.04,
      Math.PI,
      "#ffffff",
      HUB_TEXT,
    );
    placeText(
      ["W"],
      2.12,
      F.HUB_MONOLITH.width / 2 + 0.04,
      HUB_TEXT_Y - 0.1,
      -3,
      -Math.PI / 2,
      "#ffffff",
      HUB_TEXT,
    );

    place(
      "sign-hub",
      () => F.roomSign(4.0, 0x33415f),
      -1,
      6.0,
      -4,
      CAMERA_FACING,
      "sign-hub",
    ).scale.setScalar(0.85);
    placeText(["HUB"], 2.2, -0.83, 6.0, -3.83, CAMERA_FACING, "#e6e3db", { id: "sign-hub" });

    return { hubCrystal, hubCrystalMaterial };
  });

  /* -------------------------------------------------------------- corridor */

  /*
   * Plaza dressing, and the one place the inset had to be thought about rather
   * than applied: these props stood in the notches between two room facades,
   * and pulling the rooms in closed those notches over them.
   *
   * The pillar and the kiosk each stand a unit off the facade they face, so
   * they go into that room's frame and keep their distance at any inset. The
   * two small plants sit on the diagonal, where they belong to neither room,
   * and were moved by hand out of what is now floor inside EDIT and READ. The
   * tall pair, out in the corners, never moved.
   */
  // Beside ARCHIVE's doorway, on the screen-right side of it and a step out from
  // the facade. Further north — where the reference puts its own pillar —
  // ARCHIVE's north wall stands in front of it and hides all but its top.
  // The z went -1.5 → -1.25 → -2.5: ARCHIVE moving east carried the pillar onto
  // the `c_ne` junction, which is derived from the same facade and therefore
  // moved with it, and the two closed to 0.42. A unit further north is the
  // whole fix, and it stays south of the wall that would hide it.
  inRoom("archive", () => place("info-pillar", F.infoPillar, 14.25, 0, -1.25, CAMERA_FACING));
  // Out in the concourse between the two near rooms and the reception, which is
  // otherwise the one bare patch in the frame. Its old spot measured 0.00
  // against the leg out to `entrance standby 1` and had done since the
  // concourse was dressed — a zero nothing tested, because nothing measured the
  // props this file places by hand. The set editor moved it off by eye; the
  // measurement that says so came afterwards, and `PLAN_SCENERY` is what keeps
  // it.
  place("kiosk", F.kiosk, 10.25, 0, 22, CAMERA_FACING);
  // Was against LINKS' east glass; the set editor took it across the plaza to
  // the notch between READ and LINKS. It keeps LINKS' frame, so it still
  // travels with that room.
  inRoom("links", () => place("plant-tall", F.plantTall, -19.75, 0, 9.75));
  place("plant-small", F.plantSmall, -7.75, 0, 6.0);
  place("plant-small", F.plantSmall, -6.75, 0, 9.75);
  place("plant-tall", F.plantTall, -17.75, 0, 11.25);
  place("plant-tall", F.plantTall, 11.25, 0, -14.75);

  /* -------------------------------------------------------------- entrance */

  inRoom("entrance", () => {
    place("reception", F.receptionDesk, 19.4, 0, 19.4, CAMERA_FACING, "reception");
    placeText(["WELCOME,", "AGENT!", ":)"], 2.3, 19.58, 3.1, 19.58, CAMERA_FACING, "#eae6dc", {
      id: "reception",
    });
    // Two, flanking the desk. The outer pair stood four units further out on
    // the same diagonal and read as a hedge run rather than as a reception.
    place("plant-tall", F.plantTall, 14.5, 0, 21.5);
    place("plant-tall", F.plantTall, 21.25, 0, 14.75);
  });

  /* --------------------------------------------------------- floor obstacles */

  /**
   * Planters, crates and the reading room's low table are placed from the list
   * `layout.ts` declares, not from coordinates written here. A prop that stands
   * near a route has to be in the walk graph's model of the floor or avatars
   * walk straight through it, which is exactly what the corridor planters and
   * the first archive stack used to do.
   */
  for (const obstacle of PLAN_OBSTACLES) {
    // In its room's frame, from the plan, for the same reason the carpet is:
    // the planters at a doorway belong to that doorway. Each piece is stamped
    // with the obstacle's own id, so a stack of crates is one thing to move and
    // the footprint `layout.ts` declares can be moved with it.
    inRoom(obstacle.room, () => {
      switch (obstacle.kind) {
        case "planter": {
          const alongZ = obstacle.depth > obstacle.width;
          const length = alongZ ? obstacle.depth : obstacle.width;
          place(
            `hedge-${length}`,
            () => F.hedgePlanter(length),
            obstacle.x,
            0,
            obstacle.z,
            alongZ ? Math.PI / 2 : 0,
            obstacle.id,
          );
          break;
        }
        case "crates": {
          // Two on the floor and one on top, which is the whole footprint.
          place("crate", F.crate, obstacle.x - 0.6, 0, obstacle.z, 0.12, obstacle.id);
          place("crate", F.crate, obstacle.x + 0.6, 0, obstacle.z, -0.24, obstacle.id);
          place("crate", F.crate, obstacle.x, 0.9, obstacle.z, 0.36, obstacle.id);
          break;
        }
        case "table":
          // Turned by its own footprint, the way a planter is: the declared
          // extents are what the walk graph measures, so a table laid along Z
          // that rendered along X would be a prop disagreeing with its own
          // footprint — which is the one thing this loop exists to prevent.
          place(
            "coffee-table",
            F.coffeeTable,
            obstacle.x,
            0,
            obstacle.z,
            obstacle.depth > obstacle.width ? Math.PI / 2 : 0,
            obstacle.id,
          );
          break;
        case "fountain":
          // Placed by the hub's own dressing, not from this list. It is in the
          // obstacle model so the walk graph knows it is solid; it is not in
          // `PLAN_OBSTACLES`, so this loop never sees it.
          break;
      }
    });
  }

  /* ------------------------------------------------------------- room signs */

  const SIGNS: readonly {
    room: string;
    width: number;
    x: number;
    y: number;
    z: number;
    rotationY: number;
    /** Overrides the room's HUD colour when the two should not match. */
    color?: number;
    /** Shorter plaques for signs that run out of frame; the type is unaffected. */
    height?: number;
  }[] = [
    { room: "READ", width: 5.8, x: -20, y: 4.35, z: -8.75, rotationY: Math.PI, height: 2.0 },
    // Rose, to sit with EDIT's carpet. The HUD keeps the room's violet.
    { room: "EDIT", width: 5.8, x: -1.4, y: 4.4, z: -26.75, rotationY: Math.PI, color: 0xb0759d },
    { room: "LINKS", width: 7.0, x: -8.75, y: 6.5, z: 20, rotationY: -Math.PI / 2 },
    { room: "ARCHIVE", width: 8.6, x: 20, y: 6.7, z: -4.75, rotationY: Math.PI, color: 0xe0b47e },
  ];

  for (const sign of SIGNS) {
    const room = ROOMS.find((candidate) => candidate.label === sign.room);
    if (!room) continue;
    // A plaque is mounted on its room's wall, so it travels in that room's frame.
    inRoom(room.id, () => {
      place(
        `sign-${sign.room}`,
        () => F.roomSign(sign.width, sign.color ?? room.color, sign.height),
        sign.x,
        sign.y,
        sign.z,
        sign.rotationY,
        `sign-${sign.room}`,
      );
      const forwardX = -Math.sin(sign.rotationY) * 0.24;
      const forwardZ = -Math.cos(sign.rotationY) * 0.24;
      placeText(
        [sign.room],
        3.0,
        sign.x + forwardX,
        sign.y,
        sign.z + forwardZ,
        sign.rotationY,
        "#e6e3db",
        { id: `sign-${sign.room}` },
      );
    });
  }

  /* -------------------------------------- offices beyond the corridor corners */

  // The reference frames the building tightly and lets it run off every edge.
  // These rooms exist only so the corners of the shot are not bare floor.
  const outerFloorTexture = createCarpetTexture(0x998f82);
  textures.push(outerFloorTexture);
  const outerFloorMaterial = trackMaterial(
    new THREE.MeshStandardMaterial({ map: outerFloorTexture, roughness: 0.95, metalness: 0 }),
  );
  // Held in a group of their own so they can be faded as one. `place` parents
  // to the scene group, so each holder is moved across after the fact.
  const outerOffices = new THREE.Group();
  group.add(outerOffices);

  // Pulled in with the building: the rooms they back onto moved towards the hub,
  // and left where they were these three would stand off across bare tile. Each
  // takes its shift from the two rooms it backs onto, so it follows them even
  // where those two moved by different amounts.
  for (const [x, z] of [
    [-25 + ROOM_SHIFT.read.x, -27 + ROOM_SHIFT.edit.z],
    [-27 + ROOM_SHIFT.read.x, 25 + ROOM_SHIFT.links.z],
    [27 + ROOM_SHIFT.archive.x, -25 + ROOM_SHIFT.edit.z],
  ] as const) {
    const slab = new THREE.Mesh(track(new THREE.BoxGeometry(18, 0.18, 14)), outerFloorMaterial);
    slab.position.set(x, 0.09, z - 1);
    slab.receiveShadow = true;
    outerOffices.add(slab);

    outerOffices.add(place("outer-window", () => F.windowWall(18.4, WALL_HEIGHT), x, 0, z - 8));
    outerOffices.add(
      place(
        "outer-window-side",
        () => F.windowWall(14, WALL_HEIGHT),
        x - 9.2,
        0,
        z - 1,
        Math.PI / 2,
      ),
    );
    outerOffices.add(place("sofa", F.sofa, x - 2, 0, z + 1));
    outerOffices.add(place("desk", F.desk, x + 5.5, 0, z - 5));
    outerOffices.add(place("monitor", F.monitor, x + 5.5, DESK_TOP, z - 5.4, Math.PI));
    outerOffices.add(place("office-chair", F.officeChair, x + 5.5, 0, z - 3.4));
    outerOffices.add(place("plant-tall", F.plantTall, x - 7.6, 0, z + 3.4));
    outerOffices.add(place("plant-tall", F.plantTall, x + 7.6, 0, z + 3.4));
    outerOffices.add(place("cabinet", F.filingCabinet, x + 7.6, 0, z - 5.5, Math.PI / 2));
  }

  /*
   * The four channel materials are shared by the whole set — a desk out here is
   * the same material as a desk in EDIT — so fading them where they stand would
   * fade the building with them. These offices get their own copies instead:
   * four more materials, and nothing else in the scene can see their opacity.
   */
  const sceneryMaterials: THREE.Material[] = [];
  const sceneryClones = new Map<THREE.Material, THREE.Material>();
  outerOffices.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const original = object.material as THREE.Material;
    let clone = sceneryClones.get(original);
    if (!clone) {
      clone = trackMaterial(original.clone());
      sceneryClones.set(original, clone);
      sceneryMaterials.push(clone);
    }
    object.material = clone;
  });

  let sceneryOpacity = 1;
  const setSceneryOpacity = (value: number): void => {
    const next = Math.min(1, Math.max(0, value));
    if (next === sceneryOpacity) return;
    sceneryOpacity = next;
    outerOffices.visible = next > 0;
    for (const material of sceneryMaterials) {
      // Blending is switched on only while the fade is running: a material left
      // transparent at full opacity is sorted against the rest of the scene for
      // no reason, and sorts wrong as often as not.
      const blended = next < 1;
      if (material.transparent !== blended) {
        material.transparent = blended;
        material.needsUpdate = true;
      }
      // The glass panes are authored translucent; their own tint is the ceiling.
      material.opacity = (material.userData.baseOpacity as number) * next;
    }
    // A shadow has no opacity of its own, so it would hold at full strength
    // under a room that is no longer there. It goes as the fade begins, while
    // the room it belongs to is still nearly solid.
    outerOffices.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = next >= 1;
    });
  };
  for (const material of sceneryMaterials) {
    material.userData.baseOpacity = material.opacity;
  }

  /* ----------------------------------------------------------- local lights */

  /**
   * The sun and the sky fill are flat by design; these four are what give each
   * room its own colour of light, which is most of what separates the reference
   * from a uniformly lit model. Each sits just off the thing it belongs to, and
   * none casts a shadow — a second shadow map per room buys nothing at this
   * scale and the contact shading comes from the AO pass instead.
   */
  const roomLights: RoomLight[] = [];
  // Each sits at its room's authored coordinates, inside that room's frame,
  // exactly as the prop it lights does.
  for (const [id, x, y, z, color, intensity, distance] of [
    ["read", -25.6, 1.9, 3.6, 0xffc389, 16, 12], // the reading room's lamp
    ["hub", 0, 2.1, -3, 0x6fd9ff, 34, 17], // the hub crystal
    ["links", -7.4, 2.6, 20, 0x6cd0ff, 28, 15], // the LINKS wall screen
    ["edit", 2, 2.3, -22.4, 0x8ec2ff, 16, 13], // the EDIT monitors
    // ARCHIVE had no light of its own. Its case wall faces +Z, which the key
    // barely grazes, so the pale joinery came back mahogany however light the
    // colour was authored.
    // Hung high and run bright, rather than low and dim. With decay 2 the ratio
    // between what the case gets and what an avatar's crown gets is set by the
    // *ratio* of their distances, so a lamp just above head height blows the
    // head out at any intensity that still reaches the shelving. At 8.0 the two
    // distances are within a fifth of each other.
    ["archive", 19.6, 8.0, -2.0, 0xffdcae, 30, 22], // the archive
  ] as const satisfies readonly (readonly [RoomId, ...number[]])[]) {
    const lamp = new THREE.PointLight(color, intensity, distance, 2);
    lamp.position.set(x, y, z);
    inRoom(id, () => parent.add(lamp));
    roomLights.push({ light: lamp, baseIntensity: intensity });
  }

  return {
    group,
    hubCrystal,
    hubCrystalMaterial,
    roomLights,
    voxelFaceCount,
    roomFrames,
    setSceneryOpacity,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
};
