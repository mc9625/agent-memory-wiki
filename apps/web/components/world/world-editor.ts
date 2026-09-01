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
 */

import * as THREE from "three";
import {
  DEFAULT_FLOOR,
  PLAN_OBSTACLES,
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
  readonly authored: { readonly x: number; readonly y: number; readonly z: number };
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
}

const SNAPS: readonly number[] = [0, 0.25, 0.5, 1];

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
  /** Props moved by hand, in whatever frame they were authored in. */
  const movedProps = new Map<
    string,
    { label: string; from: Editable["authored"]; to: Point; y: number }
  >();

  const obstacleIds = new Set(PLAN_OBSTACLES.map((obstacle) => obstacle.id));
  const obstacleRoom = new Map(PLAN_OBSTACLES.map((obstacle) => [obstacle.id, obstacle.room]));

  /** The floor as the current candidate describes it. */
  const candidateFloor = () => {
    const floor = deriveFloor(shifts);
    if (movedObstacles.size === 0) return floor;
    return {
      ...floor,
      obstacles: floor.obstacles.map((obstacle) => {
        const moved = movedObstacles.get(obstacle.id);
        if (!moved) return obstacle;
        const by = shifts[obstacle.room];
        return { ...obstacle, x: moved.x + by.x, z: moved.z + by.z };
      }),
    };
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
        };
      }
      node = node.parent;
    }
    return null;
  };

  /* ----------------------------------------------------------------- state */

  let mode: "room" | "prop" = "prop";
  let snap = 0.25;
  let selection: Selection | null = null;
  let dragging = false;
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
    const [origin] = selection.origins;
    if (!first || !origin) return;
    const dx = x - first.position.x;
    const dz = z - first.position.z;
    for (const object of selection.objects) object.position.x += dx;
    for (const object of selection.objects) object.position.z += dz;

    if (selection.kind === "room" && selection.room) {
      shifts[selection.room] = { x: first.position.x, z: first.position.z };
    }
    if (selection.obstacleId) {
      const plan = PLAN_OBSTACLES.find((obstacle) => obstacle.id === selection?.obstacleId);
      if (plan)
        movedObstacles.set(plan.id, {
          x: plan.x + (first.position.x - origin.x),
          z: plan.z + (first.position.z - origin.z),
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
        });
      }
    }
    refresh();
  };

  const nudge = (dx: number, dy: number, dz: number): void => {
    if (!selection) return;
    const [first] = selection.objects;
    if (!first) return;
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

  const modeRow = document.createElement("div");
  modeRow.className = "row";
  const roomButton = document.createElement("button");
  roomButton.textContent = "rooms";
  const propButton = document.createElement("button");
  propButton.textContent = "props";
  const snapButton = document.createElement("button");
  modeRow.append(roomButton, propButton, snapButton);

  const selected = document.createElement("div");
  selected.className = "sel";

  const clearances = document.createElement("ul");
  clearances.className = "clear";

  const actions = document.createElement("div");
  actions.className = "row";
  const exportButton = document.createElement("button");
  exportButton.textContent = "export";
  const resetButton = document.createElement("button");
  resetButton.textContent = "reset";
  actions.append(exportButton, resetButton);

  const output = document.createElement("textarea");
  output.className = "out";
  output.readOnly = true;
  output.hidden = true;

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent =
    "click to select · drag on the floor · arrows nudge (shift ×10) · q/e height · r rotates · esc clears";

  panel.append(
    heading("edit"),
    modeRow,
    selected,
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
    selected.textContent = selection ? selection.label : "nothing selected";

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

    for (const [id, moved] of movedObstacles) {
      const plan = PLAN_OBSTACLES.find((obstacle) => obstacle.id === id);
      if (!plan) continue;
      lines.push(
        `// layout.ts — PLAN_OBSTACLES ${id}: was x ${plan.x}, z ${plan.z}`,
        `{ id: "${id}", room: "${obstacleRoom.get(id) ?? plan.room}", x: ${round(moved.x)}, z: ${round(moved.z)}, ` +
          `width: ${plan.width}, depth: ${plan.depth}, kind: "${plan.kind}" },`,
      );
    }

    for (const [id, moved] of movedProps) {
      if (movedObstacles.has(id)) continue;
      lines.push(
        `// environment.ts — ${id}: was (${moved.from.x}, ${moved.from.y}, ${moved.from.z})`,
        `place(..., ${round(moved.to.x)}, ${round(moved.y)}, ${round(moved.to.z)})`,
      );
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

  const onPointerDown = (event: PointerEvent): void => {
    readPointer(event);
    const hits = raycaster.intersectObject(environment.group, true);
    const first = hits[0];
    if (!first) {
      selection = null;
      refresh();
      return;
    }

    const picked = asSelection(mode, first.object);
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
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLTextAreaElement) return;
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
      case "r": {
        if (!selection) return;
        const turn = (event.shiftKey ? -1 : 1) * (Math.PI / 12);
        for (const object of selection.objects) object.rotation.y += turn;
        refresh();
        break;
      }
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
    window.removeEventListener("keydown", onKeyDown);
    outline.removeFromParent();
    outline.dispose();
    document.body.classList.remove("world-editing");
    panel.remove();
    style.remove();
  };
};
