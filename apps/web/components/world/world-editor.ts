/**
 * A WYSIWYG editor for the set, shown only when the URL carries `?edit=1`.
 *
 * This is a development tool. It is loaded by dynamic import, so none of it
 * reaches the production bundle, and it is deliberately a *previewer* rather
 * than a second source of truth: nothing here writes to disk. You drag a room
 * or a prop, the panel measures what that did to the walk graph, and the Export
 * button hands back the numbers to paste into `layout.ts` or `environment.ts`.
 *
 * That split is the whole design. The floor plan is authored in two files whose
 * prose carries the reasoning behind every coordinate, and a tool that rewrote
 * them would eventually mangle that prose. A tool that *proposes* numbers costs
 * nothing if it is wrong.
 *
 * ## What moving something actually means
 *
 * - **A room** is its `ROOM_SHIFT` entry. Every prop in it, its carpet, its
 *   planters, its lamp, its waypoints and its obstacle footprints all derive
 *   from that one vector, so the preview moves the room's `THREE.Group` and the
 *   measurement re-derives a whole `Floor` from the candidate shifts.
 * - **A prop** is a coordinate in `environment.ts`, authored in its room's
 *   frame. The preview moves its holder; the export names it by the authored
 *   position it was written at, which is what makes the line greppable.
 * - **An obstacle** is both: the prop the camera sees and the footprint
 *   `layout.ts` declares. They move together here, because a prop whose
 *   footprint stayed behind is exactly the bug this floor has shipped twice.
 *
 * ## What it will not do
 *
 * It does not rebuild the waypoint graph. That graph is authored — twelve nodes
 * and an adjacency table encoding which corridors exist — not derived from the
 * geometry, and generating it from the rooms would replace the corridors with
 * whatever an A* thought was shortest. Nodes tagged to a room travel with it and
 * the three plaza junctions re-derive from the facades, which is what
 * `deriveFloor` already does; everything else is measured and reported, and
 * fixing it is a human's call.
 *
 * It also does not rotate a **room**. A room's walls, doorway sides, seats,
 * waypoints and glass spot are all written axis-aligned in `layout.ts`, and
 * turning its group would turn the model the camera sees away from the model
 * the walk graph uses without a word. Props rotate; rooms slide.
 *
 * ## Cloning and deleting, given that nothing is written
 *
 * A clone has no call in `environment.ts` to name, and a deletion is the
 * absence of one. Both are still worth having — most set dressing is authored
 * by copying a line and changing two numbers — so the preview does the thing
 * and the export describes the edit: a clone comes back as the coordinates plus
 * the id of the prop it was copied from, so the original call is one grep away,
 * and a deletion comes back as the call to remove, named by its authored
 * position. Neither is a patch. Both are a note to the person holding the file.
 */

import * as THREE from "three";
import {
  DEFAULT_FLOOR,
  PLAN_OBSTACLES,
  PLAN_SCENERY,
  ROOM_SHIFT,
  deriveFloor,
  type Point,
  type RoomId,
} from "../../lib/world/layout";
import { MAX_LANE, walkClearances } from "../../lib/world/validate";
import type { BuiltEnvironment } from "./environment";

export const editingEnabled = (): boolean =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("edit");

export interface EditorHandle {
  /** Where the panel is mounted, and where pointer events are read from. */
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.Camera;
  readonly environment: BuiltEnvironment;
}

/** What `environment.ts` stamps on every placed object. */
interface Editable {
  readonly id: string;
  readonly key: string;
  readonly room: RoomId | null;
  readonly authored: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly rotationY: number;
  };
}

/** One thing the editor can move: a whole room, or every object sharing an id. */
interface Selection {
  readonly kind: "room" | "prop";
  readonly label: string;
  /** The objects moved together. A sign is its plaque and its lettering. */
  readonly objects: readonly THREE.Object3D[];
  /** Where they started, so a move can be reported as a delta and undone. */
  readonly origins: readonly THREE.Vector3[];
  readonly room: RoomId | null;
  /** Set when the prop is also a footprint in `OBSTACLES`. */
  readonly obstacleId: string | null;
  /** Set when the prop is a measured-only footprint in `PLAN_SCENERY`. */
  readonly sceneryId: string | null;
}

const SNAPS: readonly number[] = [0, 0.25, 0.5, 1];

/**
 * The turn the rotate buttons take, in degrees.
 *
 * 90 first, and the default, because the set is built on the floor's own two
 * axes: every wall, desk and shelf in `environment.ts` is placed at 0, ±π/2 or
 * π, and a prop turned by anything else reads as dropped rather than laid out.
 * 45 is the diagonal the entrance and the camera-facing props use, and 15 is
 * left in for the few things that are deliberately askew.
 */
const TURNS: readonly number[] = [90, 45, 15];

/**
 * Rotations spelled the way `environment.ts` spells them.
 *
 * The export exists to be pasted, and `rotationY: 2.3562` in a file where every
 * other call reads `CAMERA_FACING` or `-Math.PI / 2` is a number nobody can
 * check by eye. Anything that does not land on one of these comes back as a
 * plain number, which is itself the signal that the prop is off-axis.
 */
const ROTATION_NAMES: readonly (readonly [number, string])[] = [
  [0, "0"],
  [Math.PI / 4, "Math.PI / 4"],
  [Math.PI / 2, "Math.PI / 2"],
  [(3 * Math.PI) / 4, "(3 * Math.PI) / 4"],
  [Math.PI, "Math.PI"],
  [-Math.PI / 4, "-Math.PI / 4"],
  [-Math.PI / 2, "-Math.PI / 2"],
  [(-3 * Math.PI) / 4, "CAMERA_FACING"],
];

/** Normalised to (-π, π], so a prop turned four times reads as untouched. */
const normaliseTurn = (angle: number): number => {
  const wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) return wrapped - Math.PI * 2;
  if (wrapped <= -Math.PI) return wrapped + Math.PI * 2;
  return wrapped;
};

const rotationSource = (angle: number): string => {
  const wrapped = normaliseTurn(angle);
  for (const [value, name] of ROTATION_NAMES) {
    if (Math.abs(wrapped - value) < 1e-6) return name;
  }
  return `${Math.round(wrapped * 1e4) / 1e4}`;
};

const CSS = `
/* The activity log owns the bottom-left corner and would sit on top of the
   panel, swallowing its clicks. Nothing is staged while editing, so the log has
   nothing to say anyway. */
body.world-editing .world-hud-log{display:none}
.world-edit{position:absolute;left:12px;bottom:12px;z-index:30;width:330px;
padding:10px 12px 12px;border-radius:10px;background:rgba(18,20,26,.9);color:#e8e6df;
font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;backdrop-filter:blur(6px);
box-shadow:0 8px 28px rgba(0,0,0,.4)}
.world-edit h4{margin:9px 0 4px;font-size:10px;letter-spacing:.09em;text-transform:uppercase;opacity:.55}
.world-edit h4:first-child{margin-top:0}
/* The whole point of the grip: the panel owns a corner of the frame, and the
   corner it owns is sometimes the one with the prop you are trying to place in
   it. Dragging by the title bar is the cheapest way out of that. */
.world-edit .grip{display:flex;align-items:center;justify-content:space-between;
margin:-10px -12px 7px;padding:7px 12px 6px;border-radius:10px 10px 0 0;
background:rgba(255,255,255,.05);font-size:10px;letter-spacing:.09em;text-transform:uppercase;
opacity:.7;cursor:grab;touch-action:none;user-select:none}
.world-edit .grip:active{cursor:grabbing}
.world-edit .grip i{font-style:normal;letter-spacing:.24em;opacity:.5}
.world-edit button:disabled{opacity:.3;cursor:default}
.world-edit button:disabled:hover{background:#2f3a4a}
.world-edit .sel em{font-style:normal;color:#e8c06a}
.world-edit .row{display:flex;gap:6px;align-items:center;margin-bottom:5px}
.world-edit button{padding:3px 8px;border:0;border-radius:5px;background:#2f3a4a;color:#e8e6df;
font:inherit;cursor:pointer}
.world-edit button:hover{background:#3c4a5e}
.world-edit button.on{background:#2a6b86;color:#eafaff}
.world-edit .sel{min-height:18px;color:#7fd4ff}
.world-edit .hint{opacity:.45;font-size:10px;line-height:1.45}
/* Green while every leg still has room, amber once one is inside the lane
   budget, red once something is touching. The number is the point, not the
   colour, but the colour is what makes a bad drag obvious mid-drag. */
.world-edit .clear{margin:0;padding:0;list-style:none;font-size:10px}
.world-edit .clear li{display:flex;justify-content:space-between;gap:8px;white-space:nowrap}
.world-edit .clear b{font-weight:500}
.world-edit .ok b{color:#7fd08a}
.world-edit .near b{color:#e8c06a}
.world-edit .hit b{color:#ff8a80}
.world-edit .out{width:100%;height:96px;margin-top:6px;resize:vertical;border:0;border-radius:6px;
padding:6px;background:#11141a;color:#cfd6df;font:10px/1.45 ui-monospace,Menlo,monospace}
`;

/**
 * Mounts the editor. Returns a disposer; the caller is expected to have checked
 * `editingEnabled` already, since it is what decides whether to import at all.
 */
export const mountEditor = (handle: EditorHandle): (() => void) => {
  const { container, canvas, camera, environment } = handle;

  const style = document.createElement("style");
  style.textContent = CSS;
  const panel = document.createElement("div");
  panel.className = "world-edit";
  container.append(style, panel);
  document.body.classList.add("world-editing");

  /* ------------------------------------------------------------- the model */

  /** Candidate room shifts, seeded from the ones the scene was built with. */
  const shifts: Record<RoomId, Point> = Object.fromEntries(
    Object.entries(ROOM_SHIFT).map(([id, point]) => [id, { ...point }]),
  ) as Record<RoomId, Point>;

  /** Obstacle footprints moved by hand, in the plan frame. */
  const movedObstacles = new Map<string, Point>();
  /**
   * The same, for the measured-only footprints.
   *
   * Without this a prop in `PLAN_SCENERY` moved on screen without moving in the
   * measurement, so the panel reported the clearance it had *before* the drag —
   * which is worse than reporting nothing, because it reads as a drag that cost
   * nothing. The kiosk and LINKS' side table are both on that list, and both
   * have been found standing on a route.
   */
  const movedScenery = new Map<string, Point>();
  /** Props moved by hand, in whatever frame they were authored in. */
  const movedProps = new Map<
    string,
    { label: string; from: Editable["authored"]; to: Point; y: number; rotationY: number }
  >();
  /** Props hidden by `delete`, by stamp id. Nothing is removed from the scene. */
  const removedProps = new Map<string, { label: string; from: Editable["authored"] }>();
  /** Props added by `clone`, in the order they were made. */
  interface CloneRecord {
    readonly id: string;
    readonly from: string;
    readonly key: string;
    readonly room: RoomId | null;
    readonly objects: readonly THREE.Object3D[];
    /** The footprint the source carried, if it carried one. */
    readonly footprint: "obstacle" | "scenery" | null;
    readonly sourceFootprintId: string | null;
    /** Where the source was authored, so the export can name the call to copy. */
    readonly sourceAuthored: Editable["authored"] | null;
  }
  const clones: CloneRecord[] = [];

  const obstacleIds = new Set(PLAN_OBSTACLES.map((obstacle) => obstacle.id));
  const obstacleRoom = new Map(PLAN_OBSTACLES.map((obstacle) => [obstacle.id, obstacle.room]));
  /** Stamp id → footprint id, which is how a selection finds its own footprint. */
  const sceneryByProp = new Map(PLAN_SCENERY.map((prop) => [prop.prop, prop.id]));

  /**
   * The floor as the current candidate describes it.
   *
   * Every footprint the editor can touch is applied here — moved, deleted or
   * cloned — because this is the value `walkClearances` reads, and a panel that
   * measures the floor as authored while the screen shows a different one is
   * the failure this whole module exists to prevent.
   */
  const candidateFloor = () => {
    const floor = deriveFloor(shifts);

    const obstacles = floor.obstacles
      .filter((obstacle) => !removedProps.has(obstacle.id))
      .map((obstacle) => {
        const moved = movedObstacles.get(obstacle.id);
        if (!moved) return obstacle;
        const by = shifts[obstacle.room];
        return { ...obstacle, x: moved.x + by.x, z: moved.z + by.z };
      });

    const scenery = floor.scenery
      .filter((prop) => !removedProps.has(prop.prop))
      .map((prop) => {
        const moved = movedScenery.get(prop.id);
        if (!moved) return prop;
        const by = prop.room === null ? { x: 0, z: 0 } : shifts[prop.room];
        return { ...prop, x: moved.x + by.x, z: moved.z + by.z };
      });

    // A clone of a prop that carried a footprint carries one too, derived from
    // the source's extents at the copy's own position. A clone of a crate stack
    // that measured as empty floor would be the same lie as an unmoved one.
    for (const clone of clones) {
      const [object] = clone.objects;
      if (!object || !clone.sourceFootprintId) continue;
      const by = clone.room === null ? { x: 0, z: 0 } : shifts[clone.room];
      const at = { x: object.position.x + by.x, z: object.position.z + by.z };
      if (clone.footprint === "obstacle") {
        const source = PLAN_OBSTACLES.find((plan) => plan.id === clone.sourceFootprintId);
        if (source) obstacles.push({ ...source, id: clone.id, x: at.x, z: at.z });
      } else {
        const source = PLAN_SCENERY.find((plan) => plan.id === clone.sourceFootprintId);
        if (source) scenery.push({ ...source, id: clone.id, x: at.x, z: at.z });
      }
    }

    return { ...floor, obstacles, scenery };
  };

  /* --------------------------------------------------------------- picking */

  const editableOf = (object: THREE.Object3D): Editable | null => {
    const stamp: unknown = object.userData.editable;
    return stamp ? (stamp as Editable) : null;
  };

  /** Every object sharing an id, so a plaque and its lettering move as one. */
  const siblings = (id: string): THREE.Object3D[] => {
    const found: THREE.Object3D[] = [];
    environment.group.traverse((object) => {
      if (editableOf(object)?.id === id) found.push(object);
    });
    return found;
  };

  const asSelection = (kind: "room" | "prop", object: THREE.Object3D): Selection | null => {
    if (kind === "room") {
      for (const [id, frame] of environment.roomFrames) {
        let node: THREE.Object3D | null = object;
        while (node) {
          if (node === frame) {
            return {
              kind,
              label: `room ${id}`,
              objects: [frame],
              origins: [frame.position.clone()],
              room: id,
              obstacleId: null,
              sceneryId: null,
            };
          }
          node = node.parent;
        }
      }
      return null;
    }

    let node: THREE.Object3D | null = object;
    while (node) {
      const stamp = editableOf(node);
      if (stamp) {
        const objects = siblings(stamp.id);
        return {
          kind,
          label: stamp.id,
          objects,
          origins: objects.map((sibling) => sibling.position.clone()),
          room: stamp.room,
          obstacleId: obstacleIds.has(stamp.id) ? stamp.id : null,
          sceneryId: sceneryByProp.get(stamp.id) ?? null,
        };
      }
      node = node.parent;
    }
    return null;
  };

  /* ------------------------------------------------------------------ undo */

  /**
   * Undo as a stack of closures that put back what one action changed.
   *
   * Nothing here is a document with a serialisable state, so there is nothing
   * to diff: the model is a scene graph plus four maps, and the cheapest honest
   * undo is to record the fields an action is about to touch and restore them.
   * That means an entry has to be taken *before* the change, which is why a
   * drag captures on pointer-down and only pushes on pointer-up — a drag is one
   * action to a person, however many frames it took.
   */
  interface Change {
    readonly label: string;
    readonly undo: () => void;
  }
  const history: Change[] = [];
  /** Deep enough for a session's worth of nudging, shallow enough to bound. */
  const HISTORY_LIMIT = 120;

  const restoreEntry = <T>(
    map: Map<string, T>,
    id: string | null,
    had: boolean,
    was: T | undefined,
  ) => {
    if (!id) return;
    if (had && was !== undefined) map.set(id, was);
    else map.delete(id);
  };

  /** Everything one action on this selection can change, recorded to be put back. */
  const capture = (target: Selection): (() => void) => {
    const objects = [...target.objects];
    const transforms = objects.map((object) => ({
      position: object.position.clone(),
      rotationY: object.rotation.y,
      visible: object.visible,
    }));
    const room = target.kind === "room" ? target.room : null;
    const shiftWas = room ? { ...shifts[room] } : null;

    const propId = target.kind === "prop" ? target.label : null;
    const propHad = propId ? movedProps.has(propId) : false;
    const propWas = propId ? movedProps.get(propId) : undefined;
    const removedHad = propId ? removedProps.has(propId) : false;
    const removedWas = propId ? removedProps.get(propId) : undefined;
    const obstacleHad = target.obstacleId ? movedObstacles.has(target.obstacleId) : false;
    const obstacleWas = target.obstacleId ? movedObstacles.get(target.obstacleId) : undefined;
    const sceneryHad = target.sceneryId ? movedScenery.has(target.sceneryId) : false;
    const sceneryWas = target.sceneryId ? movedScenery.get(target.sceneryId) : undefined;

    return () => {
      objects.forEach((object, index) => {
        const was = transforms[index];
        if (!was) return;
        object.position.copy(was.position);
        object.rotation.y = was.rotationY;
        object.visible = was.visible;
      });
      if (room && shiftWas) shifts[room] = shiftWas;
      restoreEntry(movedProps, propId, propHad, propWas);
      restoreEntry(removedProps, propId, removedHad, removedWas);
      restoreEntry(movedObstacles, target.obstacleId, obstacleHad, obstacleWas);
      restoreEntry(movedScenery, target.sceneryId, sceneryHad, sceneryWas);
    };
  };

  const push = (label: string, undo: () => void): void => {
    history.push({ label, undo });
    if (history.length > HISTORY_LIMIT) history.shift();
  };

  /* ----------------------------------------------------------------- state */

  let mode: "room" | "prop" = "prop";
  let snap = 0.25;
  let turn = TURNS[0] ?? 90;
  let selection: Selection | null = null;
  let dragging = false;
  /** Taken on pointer-down, pushed on pointer-up, and only if the drag moved. */
  let dragUndo: (() => void) | null = null;
  let dragMoved = false;
  let cloneCount = 0;
  /** Shown on the selection line for one action: why a key did nothing. */
  let notice = "";
  /** Where the pointer grabbed the selection, in the selection's own frame. */
  const grabOffset = new THREE.Vector3();

  /*
   * The selection box, drawn through whatever is in front of it.
   *
   * With the depth test on it is a set of hairlines lost inside the prop they
   * wrap, and at this scale — a crate is under a unit across — that reads as no
   * selection at all. Skipping the tone map keeps it the same blue at every
   * exposure, which is what a marker is for.
   */
  const outline = new THREE.BoxHelper(new THREE.Object3D(), 0x35e0ff);
  const outlineMaterial = outline.material as THREE.LineBasicMaterial;
  outlineMaterial.depthTest = false;
  outlineMaterial.toneMapped = false;
  outline.visible = false;
  outline.renderOrder = 999;
  environment.group.parent?.add(outline);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  const readPointer = (event: PointerEvent): void => {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  };

  /** Where the pointer meets the floor, in the frame the selection lives in. */
  const floorPointIn = (parent: THREE.Object3D | null): THREE.Vector3 | null => {
    if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return null;
    const local = hitPoint.clone();
    return parent ? parent.worldToLocal(local) : local;
  };

  const round = (value: number): number =>
    snap === 0 ? Math.round(value * 1000) / 1000 : Math.round(value / snap) * snap;

  /* ---------------------------------------------------------------- moving */

  const applyMove = (x: number, z: number): void => {
    if (!selection) return;
    const [first] = selection.objects;
    if (!first) return;
    const dx = x - first.position.x;
    const dz = z - first.position.z;
    if (dx !== 0 || dz !== 0) dragMoved = true;
    for (const object of selection.objects) object.position.x += dx;
    for (const object of selection.objects) object.position.z += dz;

    if (selection.kind === "room" && selection.room) {
      shifts[selection.room] = { x: first.position.x, z: first.position.z };
    }
    /*
     * A footprint follows its prop from where the prop was *authored*, not from
     * where this selection picked it up.
     *
     * It used to be `plan + (position - selectionOrigin)`, and a selection's
     * origin is taken afresh every time you click. So a prop dragged, released,
     * clicked again and dragged again recorded only the second drag: the prop
     * ended up in one place and its footprint in another, and the exported
     * patch said both. Two of them came back from a real session that way. The
     * offset between a prop's origin and its footprint centre is fixed, so
     * anchoring on the authored position is both correct and stateless.
     */
    const authored = editableOf(first)?.authored;
    if (selection.obstacleId && authored) {
      const plan = PLAN_OBSTACLES.find((obstacle) => obstacle.id === selection?.obstacleId);
      if (plan)
        movedObstacles.set(plan.id, {
          x: plan.x + (first.position.x - authored.x),
          z: plan.z + (first.position.z - authored.z),
        });
    }
    if (selection.sceneryId && authored) {
      const plan = PLAN_SCENERY.find((prop) => prop.id === selection?.sceneryId);
      if (plan)
        movedScenery.set(plan.id, {
          x: plan.x + (first.position.x - authored.x),
          z: plan.z + (first.position.z - authored.z),
        });
    }
    if (selection.kind === "prop") {
      const stamp = editableOf(first);
      if (stamp) {
        movedProps.set(stamp.id, {
          label: stamp.id,
          from: stamp.authored,
          to: { x: first.position.x, z: first.position.z },
          y: first.position.y,
          rotationY: first.rotation.y,
        });
      }
    }
    refresh();
  };

  /* -------------------------------------------------------------- rotating */

  /**
   * Turns the selection about the object the selection is named for.
   *
   * Not each object about its own centre, which is what this used to do: a sign
   * is its plaque *and* the lettering placed a few centimetres in front of it,
   * and spinning those two in place at ninety degrees leaves the letters facing
   * out of the wall they are painted on. Rotating the siblings' positions about
   * the anchor as well keeps the group rigid, which is what a person dragging
   * one thing expects of it.
   */
  /**
   * Whether a prop has been turned onto its other axis since it was authored.
   *
   * A footprint is axis-aligned, so a prop laid along X and turned a quarter
   * turn is a footprint whose width and depth have swapped. The export used to
   * emit the authored extents whatever the rotation, which is a footprint that
   * disagrees with the prop standing in it — the thing `PLAN_OBSTACLES` exists
   * to prevent. Only quarter turns matter: anything else is off-axis and gets
   * the authored extents plus a rotation the reader can see is odd.
   */
  const turnedOntoOtherAxis = (from: number, to: number): boolean => {
    const delta = Math.abs(normaliseTurn(to - from));
    return Math.abs(delta - Math.PI / 2) < 1e-6;
  };

  const applyTurn = (degrees: number): void => {
    if (!selection) return;
    if (selection.kind === "room") {
      // A room's walls, doorways, seats and waypoints are all authored
      // axis-aligned in `layout.ts`, and none of them would follow.
      notice = "rooms do not rotate";
      refresh();
      return;
    }
    const [anchor] = selection.objects;
    if (!anchor) return;

    push(`rotate ${selection.label}`, capture(selection));

    const angle = (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const pivot = anchor.position.clone();
    for (const object of selection.objects) {
      const dx = object.position.x - pivot.x;
      const dz = object.position.z - pivot.z;
      // The three.js Y rotation, so a sibling travels the way its own mesh turns.
      object.position.x = pivot.x + dx * cos + dz * sin;
      object.position.z = pivot.z - dx * sin + dz * cos;
      object.rotation.y = normaliseTurn(object.rotation.y + angle);
    }

    const stamp = editableOf(anchor);
    if (stamp) {
      movedProps.set(stamp.id, {
        label: stamp.id,
        from: stamp.authored,
        to: { x: anchor.position.x, z: anchor.position.z },
        y: anchor.position.y,
        rotationY: anchor.rotation.y,
      });
    }
    refresh();
  };

  /* --------------------------------------------------------- clone / delete */

  /**
   * Copies the selection, offset by one snap so the copy is visibly a second
   * object rather than z-fighting with the first.
   *
   * `Object3D.clone` shares geometry and material, so a copy costs a transform
   * and nothing on the GPU — which is what makes cloning the right way to try
   * out a row of planters rather than a reason to go and author one.
   */
  const cloneSelection = (): void => {
    if (!selection || selection.kind !== "prop") {
      notice = "select a prop to clone";
      refresh();
      return;
    }
    const source = selection;
    const [anchor] = source.objects;
    if (!anchor) return;

    cloneCount += 1;
    const step = snap === 0 ? 1 : Math.max(snap, 0.5);
    const id = `${source.label}~copy${cloneCount}`;
    const stamp = editableOf(anchor);

    const objects = source.objects.map((object) => {
      const copy = object.clone(true);
      /*
       * `Object3D.copy` carries the orientation as a quaternion, and the Euler
       * it derives back from one is only *an* equivalent: a half-turn about Y
       * comes back as (π, 0, π) rather than (0, π, 0). The copy looks right and
       * reports `rotationY` 0, so the exported line said 0 while the screen
       * said a half turn. Copying the source's Euler outright keeps the two
       * agreeing, and everything here only ever reads `rotation.y`.
       */
      copy.rotation.copy(object.rotation);
      copy.position.x += step;
      copy.position.z += step;
      const own = editableOf(object);
      if (own) copy.userData.editable = { ...own, id };
      object.parent?.add(copy);
      return copy;
    });

    const record: CloneRecord = {
      id,
      from: source.label,
      key: stamp?.key ?? source.label,
      room: source.room,
      objects,
      footprint: source.obstacleId ? "obstacle" : source.sceneryId ? "scenery" : null,
      sourceFootprintId: source.obstacleId ?? source.sceneryId,
      sourceAuthored: stamp?.authored ?? null,
    };
    clones.push(record);

    push(`clone ${source.label}`, () => {
      for (const object of objects) object.removeFromParent();
      const at = clones.indexOf(record);
      if (at >= 0) clones.splice(at, 1);
      if (selection && selection.objects.some((object) => objects.includes(object))) {
        selection = null;
      }
    });

    // Select the copy, because the next thing anyone does with a clone is put
    // it somewhere else.
    selection = {
      kind: "prop",
      label: id,
      objects,
      origins: objects.map((object) => object.position.clone()),
      room: source.room,
      obstacleId: null,
      sceneryId: null,
    };
    refresh();
  };

  /**
   * Hides the selection rather than disposing it.
   *
   * Its geometry is shared with every other prop of the same key, so disposing
   * would take the rest of them with it; and a deletion here is a proposal, not
   * a demolition — the export names the call to remove and the file is still
   * the source of truth.
   */
  const removeSelection = (): void => {
    if (!selection || selection.kind !== "prop") {
      notice = "select a prop to delete";
      refresh();
      return;
    }
    const target = selection;
    const [anchor] = target.objects;
    const stamp = anchor ? editableOf(anchor) : null;

    /*
     * A clone deleted is a clone gone. It has no call in `environment.ts` to
     * remove, so recording it as a deletion would name a line that does not
     * exist; it comes out of the scene and out of the clone list instead. That
     * also means `capture` cannot undo it — `capture` restores transforms, not
     * membership of the scene graph — so this branch pushes its own entry.
     */
    const cloned = clones.findIndex((clone) => clone.id === target.label);
    if (cloned >= 0) {
      const [record] = clones.splice(cloned, 1);
      if (!record) return;
      const parents = record.objects.map((object) => object.parent);
      for (const object of record.objects) object.removeFromParent();
      const at = cloned;
      push(`delete ${target.label}`, () => {
        record.objects.forEach((object, index) => parents[index]?.add(object));
        clones.splice(at, 0, record);
      });
      selection = null;
      refresh();
      return;
    }

    push(`delete ${target.label}`, capture(target));
    for (const object of target.objects) object.visible = false;
    if (stamp) removedProps.set(target.label, { label: target.label, from: stamp.authored });

    selection = null;
    refresh();
  };

  const undo = (): void => {
    const last = history.pop();
    if (!last) {
      notice = "nothing to undo";
      refresh();
      return;
    }
    last.undo();
    notice = `undid ${last.label}`;
    refresh();
  };

  const nudge = (dx: number, dy: number, dz: number): void => {
    if (!selection) return;
    const [first] = selection.objects;
    if (!first) return;
    push(`nudge ${selection.label}`, capture(selection));
    if (dy !== 0) {
      for (const object of selection.objects) object.position.y += dy;
    }
    applyMove(first.position.x + dx, first.position.z + dz);
  };

  /* ----------------------------------------------------------------- panel */

  const heading = (text: string): HTMLElement => {
    const node = document.createElement("h4");
    node.textContent = text;
    return node;
  };

  const grip = document.createElement("div");
  grip.className = "grip";
  const gripLabel = document.createElement("span");
  gripLabel.textContent = "edit";
  const gripDots = document.createElement("i");
  gripDots.textContent = "⠿";
  grip.append(gripLabel, gripDots);

  const modeRow = document.createElement("div");
  modeRow.className = "row";
  const roomButton = document.createElement("button");
  roomButton.textContent = "rooms";
  const propButton = document.createElement("button");
  propButton.textContent = "props";
  const snapButton = document.createElement("button");
  modeRow.append(roomButton, propButton, snapButton);

  const turnRow = document.createElement("div");
  turnRow.className = "row";
  const turnLeftButton = document.createElement("button");
  turnLeftButton.textContent = "⟲";
  turnLeftButton.title = "rotate anticlockwise";
  const turnRightButton = document.createElement("button");
  turnRightButton.textContent = "⟳";
  turnRightButton.title = "rotate clockwise";
  const turnStepButton = document.createElement("button");
  const cloneButton = document.createElement("button");
  cloneButton.textContent = "clone";
  const deleteButton = document.createElement("button");
  deleteButton.textContent = "delete";
  turnRow.append(turnLeftButton, turnRightButton, turnStepButton, cloneButton, deleteButton);

  const selected = document.createElement("div");
  selected.className = "sel";

  const clearances = document.createElement("ul");
  clearances.className = "clear";

  const actions = document.createElement("div");
  actions.className = "row";
  const undoButton = document.createElement("button");
  undoButton.textContent = "undo";
  const exportButton = document.createElement("button");
  exportButton.textContent = "export";
  const resetButton = document.createElement("button");
  resetButton.textContent = "reset";
  actions.append(undoButton, exportButton, resetButton);

  const output = document.createElement("textarea");
  output.className = "out";
  output.readOnly = true;
  output.hidden = true;

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent =
    "drag the title bar to move this panel · click to select · drag on the floor · " +
    "arrows nudge (shift ×10) · q/e height · r / shift-r turn · c clone · del delete · " +
    "ctrl-z undo · esc clears";

  panel.append(
    grip,
    modeRow,
    selected,
    turnRow,
    heading(`clearance (lane budget ${MAX_LANE})`),
    clearances,
    actions,
    output,
    hint,
  );

  const refresh = (): void => {
    roomButton.classList.toggle("on", mode === "room");
    propButton.classList.toggle("on", mode === "prop");
    snapButton.textContent = snap === 0 ? "free" : `snap ${snap}`;
    turnStepButton.textContent = `turn ${turn}°`;

    const isProp = selection?.kind === "prop";
    turnLeftButton.disabled = !isProp;
    turnRightButton.disabled = !isProp;
    cloneButton.disabled = !isProp;
    deleteButton.disabled = !isProp;
    undoButton.disabled = history.length === 0;

    selected.replaceChildren(
      document.createTextNode(selection ? selection.label : "nothing selected"),
    );
    if (notice) {
      const flag = document.createElement("em");
      flag.textContent = ` — ${notice}`;
      selected.append(flag);
      // One action's worth. It answers "why did that key do nothing", and a
      // message that outlived the action would start answering it wrongly.
      notice = "";
    }

    if (selection) {
      const [first] = selection.objects;
      if (first) {
        outline.setFromObject(first);
        outline.visible = true;
      }
    } else {
      outline.visible = false;
    }

    clearances.replaceChildren();
    for (const clearance of walkClearances(candidateFloor()).slice(0, 6)) {
      const row = document.createElement("li");
      row.className =
        clearance.distance === 0 ? "hit" : clearance.distance < MAX_LANE ? "near" : "ok";
      const name = document.createElement("span");
      name.textContent = `${clearance.leg} · ${clearance.hazard}`;
      const value = document.createElement("b");
      value.textContent = clearance.distance.toFixed(2);
      row.append(name, value);
      clearances.append(row);
    }
  };

  /* ---------------------------------------------------------------- export */

  const buildExport = (): string => {
    const lines: string[] = [];

    for (const [id, point] of Object.entries(shifts)) {
      const was = ROOM_SHIFT[id as RoomId];
      if (point.x === was.x && point.z === was.z) continue;
      lines.push(
        `// layout.ts — ROOM_SHIFT.${id}: was { x: ${was.x}, z: ${was.z} }`,
        `${id}: { x: ${round(point.x)}, z: ${round(point.z)} },`,
      );
    }

    // A prop that is being deleted does not also need moving: the two lines
    // together would ask whoever pastes them to edit an entry and then remove
    // it, in that order.
    for (const [id, moved] of movedObstacles) {
      const plan = PLAN_OBSTACLES.find((obstacle) => obstacle.id === id);
      if (!plan || removedProps.has(id)) continue;
      const prop = movedProps.get(id);
      const swap = prop ? turnedOntoOtherAxis(prop.from.rotationY, prop.rotationY) : false;
      const width = swap ? plan.depth : plan.width;
      const depth = swap ? plan.width : plan.depth;
      lines.push(
        `// layout.ts — PLAN_OBSTACLES ${id}: was x ${plan.x}, z ${plan.z}` +
          (swap ? `, ${plan.width} × ${plan.depth} — turned onto its other axis` : ""),
        `{ id: "${id}", room: "${obstacleRoom.get(id) ?? plan.room}", ` +
          `x: ${round(moved.x)}, z: ${round(moved.z)}, ` +
          `width: ${width}, depth: ${depth}, kind: "${plan.kind}" },`,
      );
    }

    for (const [id, moved] of movedScenery) {
      const plan = PLAN_SCENERY.find((prop) => prop.id === id);
      if (!plan || removedProps.has(plan.prop)) continue;
      const prop = movedProps.get(plan.prop);
      const swap = prop ? turnedOntoOtherAxis(prop.from.rotationY, prop.rotationY) : false;
      const width = swap ? plan.depth : plan.width;
      const depth = swap ? plan.width : plan.depth;
      lines.push(
        `// layout.ts — PLAN_SCENERY ${id}: was x ${plan.x}, z ${plan.z}` +
          (swap ? `, ${plan.width} × ${plan.depth} — turned onto its other axis` : ""),
        `{ id: "${id}", prop: "${plan.prop}", ` +
          `room: ${plan.room === null ? "null" : `"${plan.room}"`}, ` +
          `x: ${round(moved.x)}, z: ${round(moved.z)}, ` +
          `width: ${width}, depth: ${depth} },`,
      );
    }

    const cloneIds = new Set(clones.map((clone) => clone.id));
    for (const [id, moved] of movedProps) {
      // A clone reports itself below, as a line to write rather than to amend.
      if (removedProps.has(id) || cloneIds.has(id)) continue;
      const turned = Math.abs(normaliseTurn(moved.rotationY - moved.from.rotationY)) > 1e-6;
      const rotation = turned ? `, ${rotationSource(moved.rotationY)}` : "";
      lines.push(
        `// environment.ts — ${id}: was (${moved.from.x}, ${moved.from.y}, ${moved.from.z})` +
          (turned ? ` at ${rotationSource(moved.from.rotationY)}` : ""),
        `place(..., ${round(moved.to.x)}, ${round(moved.y)}, ${round(moved.to.z)}${rotation})`,
      );
    }

    /*
     * A clone has no line to amend, so it is reported as a line to write, and
     * the id of the prop it came from is what makes the original greppable: the
     * builder argument is a function reference this module cannot name, and
     * guessing at `F.something` would be a paste that does not compile.
     */
    for (const clone of clones) {
      const [object] = clone.objects;
      if (!object) continue;
      const authored = clone.sourceAuthored;
      lines.push(
        `// environment.ts — NEW, a copy of ${clone.from}` +
          (authored ? ` (authored at ${authored.x}, ${authored.y}, ${authored.z})` : "") +
          `; copy that call and change the numbers`,
        `place("${clone.key}", <builder>, ${round(object.position.x)}, ` +
          `${round(object.position.y)}, ${round(object.position.z)}, ` +
          `${rotationSource(object.rotation.y)})` +
          (clone.room ? `   // inside inRoom("${clone.room}", …)` : ""),
      );
      if (clone.footprint) {
        const list = clone.footprint === "obstacle" ? "PLAN_OBSTACLES" : "PLAN_SCENERY";
        lines.push(`//   …and a matching ${list} entry, copied from ${clone.sourceFootprintId}`);
      }
    }

    for (const [id, gone] of removedProps) {
      lines.push(
        `// environment.ts — DELETE ${id}, the call authored at ` +
          `(${gone.from.x}, ${gone.from.y}, ${gone.from.z})`,
      );
      if (obstacleIds.has(id)) lines.push(`//   …and its PLAN_OBSTACLES entry`);
      const footprint = sceneryByProp.get(id);
      if (footprint) lines.push(`//   …and its PLAN_SCENERY entry, ${footprint}`);
    }

    if (lines.length === 0) return "nothing moved yet.";

    const worst = walkClearances(candidateFloor())[0];
    lines.push(
      "",
      `// tightest clearance on this floor: ${worst ? `${worst.distance.toFixed(2)} — ${worst.leg} · ${worst.hazard}` : "n/a"}`,
    );
    return lines.join("\n");
  };

  /* ---------------------------------------------------------------- events */

  /**
   * The nearest hit that is not a glass pane, falling back to the nearest hit.
   *
   * Every room is glazed on the sides that face the camera, so the pane is the
   * first thing the ray meets for most of the floor: clicking a desk in EDIT
   * selected the pane in front of it, and the props inside a room were
   * effectively unreachable. Preferring what is behind the glass makes them
   * pickable; the fallback keeps a pane selectable where there is nothing
   * behind it, which is how you would move one.
   */
  const pick = (hits: readonly THREE.Intersection[]): Selection | null => {
    let fallback: Selection | null = null;
    for (const hit of hits) {
      const found = asSelection(mode, hit.object);
      if (!found) continue;
      fallback ??= found;
      if (!found.label.startsWith("glass-")) return found;
    }
    return fallback;
  };

  const onPointerDown = (event: PointerEvent): void => {
    readPointer(event);
    const hits = raycaster.intersectObject(environment.group, true);
    const picked = pick(hits);
    if (!picked) {
      selection = null;
      refresh();
      return;
    }
    selection = picked;

    const [target] = picked.objects;
    const point = target ? floorPointIn(target.parent) : null;
    if (target && point) {
      grabOffset.set(point.x - target.position.x, 0, point.z - target.position.z);
      dragging = true;
      // Taken now, pushed on release, and only if the drag went anywhere: a
      // click that selects is not an action to undo.
      dragUndo = capture(picked);
      dragMoved = false;
      canvas.setPointerCapture(event.pointerId);
    }
    refresh();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || !selection) return;
    const [target] = selection.objects;
    if (!target) return;
    readPointer(event);
    const point = floorPointIn(target.parent);
    if (!point) return;
    applyMove(round(point.x - grabOffset.x), round(point.z - grabOffset.z));
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (dragMoved && dragUndo) push(`move ${selection?.label ?? "selection"}`, dragUndo);
    dragUndo = null;
    dragMoved = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    refresh();
  };

  /* ------------------------------------------------------- the panel itself */

  /*
   * The panel is positioned from the bottom-left until it is first dragged, and
   * from the top-left after: an element cannot be dragged in y while `bottom`
   * is what pins it, and switching at the moment of the grab is what keeps the
   * default corner a default rather than a computed number.
   */
  let panelDrag: { pointerId: number; x: number; y: number } | null = null;

  const onGripDown = (event: PointerEvent): void => {
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${bounds.left}px`;
    panel.style.top = `${bounds.top}px`;
    panel.style.bottom = "auto";
    panelDrag = {
      pointerId: event.pointerId,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    grip.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onGripMove = (event: PointerEvent): void => {
    if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
    const bounds = panel.getBoundingClientRect();
    // Kept far enough inside the window that the grip is always grabbable
    // again, which a panel dragged off the edge otherwise would not be.
    const minLeft = 40 - bounds.width;
    const maxLeft = window.innerWidth - 40;
    const maxTop = window.innerHeight - 32;
    const left = Math.min(Math.max(event.clientX - panelDrag.x, minLeft), maxLeft);
    const top = Math.min(Math.max(event.clientY - panelDrag.y, 8), maxTop);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };

  const onGripUp = (event: PointerEvent): void => {
    if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
    if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    panelDrag = null;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLTextAreaElement) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      undo();
      event.preventDefault();
      return;
    }
    const step = event.shiftKey ? (snap === 0 ? 1 : snap * 10) : snap === 0 ? 0.1 : snap;
    switch (event.key) {
      case "ArrowLeft":
        nudge(-step, 0, 0);
        break;
      case "ArrowRight":
        nudge(step, 0, 0);
        break;
      case "ArrowUp":
        nudge(0, 0, -step);
        break;
      case "ArrowDown":
        nudge(0, 0, step);
        break;
      case "q":
        nudge(0, -0.1, 0);
        break;
      case "e":
        nudge(0, 0.1, 0);
        break;
      case "r":
      case "R":
        applyTurn(event.shiftKey ? -turn : turn);
        break;
      case "c":
      case "C":
        cloneSelection();
        break;
      case "Delete":
      case "Backspace":
        removeSelection();
        break;
      case "Escape":
        selection = null;
        refresh();
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  roomButton.addEventListener("click", () => {
    mode = "room";
    selection = null;
    refresh();
  });
  propButton.addEventListener("click", () => {
    mode = "prop";
    selection = null;
    refresh();
  });
  snapButton.addEventListener("click", () => {
    snap = SNAPS[(SNAPS.indexOf(snap) + 1) % SNAPS.length] ?? 0;
    refresh();
  });
  turnStepButton.addEventListener("click", () => {
    turn = TURNS[(TURNS.indexOf(turn) + 1) % TURNS.length] ?? 90;
    refresh();
  });
  turnLeftButton.addEventListener("click", () => applyTurn(-turn));
  turnRightButton.addEventListener("click", () => applyTurn(turn));
  cloneButton.addEventListener("click", cloneSelection);
  deleteButton.addEventListener("click", removeSelection);
  undoButton.addEventListener("click", undo);
  exportButton.addEventListener("click", () => {
    const text = buildExport();
    output.value = text;
    output.hidden = false;
    void navigator.clipboard?.writeText(text).catch(() => {});
    console.log(text);
  });
  resetButton.addEventListener("click", () => {
    window.location.reload();
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  grip.addEventListener("pointerdown", onGripDown);
  grip.addEventListener("pointermove", onGripMove);
  grip.addEventListener("pointerup", onGripUp);
  window.addEventListener("keydown", onKeyDown);

  refresh();
  console.log(
    `[world] editor on. ${DEFAULT_FLOOR.rooms.length} rooms, ` +
      `${PLAN_OBSTACLES.length} obstacles. Nothing here writes to disk.`,
  );

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    grip.removeEventListener("pointerdown", onGripDown);
    grip.removeEventListener("pointermove", onGripMove);
    grip.removeEventListener("pointerup", onGripUp);
    window.removeEventListener("keydown", onKeyDown);
    for (const clone of clones) for (const object of clone.objects) object.removeFromParent();
    outline.removeFromParent();
    outline.dispose();
    document.body.classList.remove("world-editing");
    panel.remove();
    style.remove();
  };
};
