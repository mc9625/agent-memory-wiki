"use client";

/**
 * Wiki World — an isometric room-scale view of the archive.
 *
 * Agents are not simulated: every avatar on screen is replaying a real session
 * from `archive_events`, and each step it takes corresponds to one recorded
 * event. Live events arriving over SSE are appended to the agent that produced
 * them, or spawn it if it is not already on stage.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { SkyEvent, SkyArticle } from "../sky-canvas";
import {
  agentHue,
  buildAgentPlans,
  displayAgentName,
  taskForEvent,
  type AgentPlan,
  type AgentTask,
} from "../../lib/world/choreography";
import { WAYPOINTS, findPath, getRoom, type Point, type RoomId } from "../../lib/world/layout";
import { createAvatar, disposeAvatar, poseAvatar, type AvatarRig } from "./avatar";
import { buildEnvironment } from "./environment";
import { VISUAL_CONFIG, keyLightPosition } from "./visual";
import { createTunePanel } from "./tune-panel";

/**
 * Display-space saturation, applied after the tone map.
 *
 * Deliberately the last thing in the chain and deliberately small. Reaching for
 * saturation before the lighting is right buys brighter room colours and no
 * extra volume; once the shading carries the shape, a few per cent here is all
 * that is left to do.
 */
const SATURATION_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float luma = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(mix(vec3(luma), texel.rgb, saturation), texel.a);
    }
  `,
};

/** Stage capacity. The HUD shows the roster against it, as the reference does. */
export const MAX_CONCURRENT_AGENTS = 6;
const SPAWN_INTERVAL_MS = 2600;
const WALK_SPEED = 4.6; // world units per second
const ARRIVAL_EPSILON = 0.12;
/**
 * Half the space an avatar keeps to itself, in world units. The rig is 0.86
 * across the torso and wider again at the arms, so anything under this leaves
 * two of them visibly inside each other.
 */
const AGENT_RADIUS = 0.85;
/**
 * Lateral offsets from the centre line of a corridor, handed out in turn as
 * actors spawn.
 *
 * This is the part that stops a crowd from jamming, and it is worth being
 * precise about why. Avatars share a dozen waypoints, so without lanes several
 * of them aim at the *same* point, get within a body's width of each other and
 * are pushed apart — straight back off the point they are each trying to stand
 * on. Nobody ever arrives and the whole group locks up in the middle of the
 * plaza. Give each actor its own line down the corridor and there is nothing
 * left to contend for.
 */
const LANES: readonly number[] = [0, 0.8, -0.8, 0.4, -0.4, 1.2];
/** Seconds of being shoved about without getting nearer before a leg is given up on. */
const STUCK_SECONDS = 2.5;

interface Actor {
  readonly sessionId: string;
  readonly agentIdentifier: string;
  readonly displayName: string;
  readonly generation: number;
  readonly rig: AvatarRig;
  readonly bubble: HTMLDivElement;
  tasks: AgentTask[];
  currentTask: AgentTask | null;
  /** Waypoint node the actor last stood on, used as the pathfinding origin. */
  currentNode: string;
  /** Seat currently reserved for this actor, as `${roomId}:${index}`. */
  seatKey: string | null;
  path: Point[];
  pathIndex: number;
  /** This actor's offset from the centre line of whatever leg it is walking. */
  lane: number;
  /** Where the current leg started, which is what the lane offset is measured off. */
  segmentOrigin: Point;
  /** Closest this actor has come to its current target, for the jam watchdog. */
  nearestApproach: number;
  blockedFor: number;
  /** Unit heading, kept so separation can push sideways and never backwards. */
  headingX: number;
  headingZ: number;
  /** Distance left to the current target, read by the separation pass. */
  distanceToTarget: number;
  phase: "walking" | "acting" | "done";
  actionRemainingMs: number;
  walkPhase: number;
  facing: number;
  bornAt: number;
}

export interface WorldCanvasProps {
  readonly initialArticles: readonly SkyArticle[];
  readonly initialEvents: readonly SkyEvent[];
  readonly liveEvent: SkyEvent | null;
  /**
   * Whether to keep the stage populated from the recorded archive between live
   * events. Off, the only avatars on screen are the ones a live event put
   * there, and an idle archive means an empty floor — which is the honest
   * picture when nothing is happening, and the reason the switch exists.
   */
  readonly replay?: boolean;
  /** Called whenever the roster changes, so the HUD can mirror it. */
  readonly onRosterChange?: (
    roster: readonly { name: string; status: string; hue: number }[],
  ) => void;
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  walking: "Moving",
  read: "Reading",
  type: "Editing",
  browse: "Browsing",
  sort: "Organizing",
  idle: "Idle",
  leave: "Leaving",
};

export function WorldCanvas({
  initialArticles,
  initialEvents,
  liveEvent,
  replay = true,
  onRosterChange,
}: WorldCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const plansRef = useRef<readonly AgentPlan[]>([]);
  const pendingLiveRef = useRef<SkyEvent[]>([]);
  const replayRef = useRef(replay);
  const rosterCallbackRef = useRef(onRosterChange);
  const articleCountRef = useRef(0);
  // Bumped by the tuning panel when a value baked into the geometry changes.
  // Everything else in `VISUAL_CONFIG` is re-read per frame instead.
  const [buildToken, setBuildToken] = useState(0);

  rosterCallbackRef.current = onRosterChange;
  replayRef.current = replay;
  articleCountRef.current = initialArticles.length;

  useEffect(() => {
    plansRef.current = buildAgentPlans(initialEvents);
  }, [initialEvents]);

  useEffect(() => {
    if (liveEvent) pendingLiveRef.current.push(liveEvent);
  }, [liveEvent]);

  useEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    let width = container.clientWidth;
    let height = container.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    // Variance shadow maps, not PCF. PCF gives a hard edge whose softness is
    // capped by the texel size, and at a 4096 map over this set that edge was
    // razor sharp; VSM stores depth moments instead, so `shadow.radius` blurs
    // the map itself and the penumbra can be as wide as the reference's.
    renderer.shadowMap.type = THREE.VSMShadowMap;
    // The reference art is bright and low-contrast; a filmic curve keeps the
    // white walls from clipping while the lit screens stay saturated.
    //
    // The whole balance is deliberately warm. Every neutral in the set — the
    // sky fill, the corridor tile, the walls, the sheet behind the building —
    // was a cool grey, and a hundred cool greys read as a colour cast no amount
    // of warm sun can cancel. They are now warm greys, and the only cool light
    // left is the low back fill.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdedacf);

    /**
     * Fixed 2:1 dimetric framing.
     *
     * The reference is drawn at a 30° elevation, not the 35.26° of a true
     * (1, 1, 1) isometric: with the camera at azimuth 45°, a floor axis draws
     * with screen slope sin(elevation), and sin(30°) = 0.5 is the two-across,
     * one-down staircase every tile in the reference follows. The frustum is
     * tight enough that the outer rooms run off the edges, which is what makes
     * the building read as bigger than the frame.
     */
    const frustum = 16.6;
    const camera = new THREE.OrthographicCamera(-frustum, frustum, frustum, -frustum, 0.1, 400);
    const applyCameraFrustum = () => {
      const aspect = width / height;
      camera.left = -frustum * aspect;
      camera.right = frustum * aspect;
      camera.top = frustum;
      camera.bottom = -frustum;
      camera.updateProjectionMatrix();
    };
    // Direction (1, 0.8165, 1) is elevation 30° at azimuth 45°.
    const CAMERA_TARGET = new THREE.Vector3(0, 0, 1);
    camera.position.set(
      CAMERA_TARGET.x + 110,
      CAMERA_TARGET.y + 89.8,
      CAMERA_TARGET.z + 110,
    );
    camera.lookAt(CAMERA_TARGET);
    applyCameraFrustum();

    /**
     * Sky and ground fill.
     *
     * Kept deliberately low. The earlier balance flooded the set with ambient
     * light, which is what made it read flat: every face received nearly the
     * same energy, so nothing separated a lit surface from a shaded one. The
     * shape now comes from the sun and from the AO pass, and this only keeps
     * the shadow side from going black.
     */
    const hemisphere = new THREE.HemisphereLight(0xeaeefa, 0xd0b892, 1);
    const ambient = new THREE.AmbientLight(0xfff0dc, 1);
    scene.add(hemisphere);
    scene.add(ambient);

    /**
     * The key.
     *
     * Its azimuth is the value that most decides whether the set reads as voxel
     * blocks or as flat primitives. It used to sit at 57° against a camera at
     * 45°: twelve degrees apart is a frontal light, so the +X and +Z faces of
     * every box — the only two sides the camera can see — came back with almost
     * the same N·L, and every shadow fell directly behind the prop casting it.
     * `VISUAL_CONFIG.keyAzimuthDeg` swings it out to 70°, which opens those two
     * faces to roughly 2.7:1 and lays the shadows across the frame.
     */
    const sun = new THREE.DirectionalLight(0xffeecd, 1);
    sun.castShadow = true;
    // Deliberately low. VSM blurs the map, so the penumbra a given radius buys
    // is measured in texels: fewer texels over the same shadow camera is what
    // makes the blur wide in world units. Pushing the radius instead of the
    // resolution washes the shadow out altogether — VSM's variance bound bleeds
    // light as the blur grows, and at radius 9 the props cast nothing at all.
    sun.shadow.mapSize.set(1792, 1792);
    // Wide enough to cover every square of floor the frustum can see. VSM blurs
    // the map, and a blur that runs off the edge of the shadow camera smears
    // instead of stopping — the earlier ±46 left grey streaks at the frame edges.
    sun.shadow.camera.left = -58;
    sun.shadow.camera.right = 58;
    sun.shadow.camera.top = 58;
    sun.shadow.camera.bottom = -58;
    sun.shadow.camera.far = 190;
    // The penumbra is set by the blur, not by the resolution. Wide, but no wider
    // than it has to be: VSM's variance bound bleeds light as the blur grows,
    // and that bleed lands hardest exactly where depth varies most — under a
    // desk, under a chair, along the wall-to-floor crease. Those are the contact
    // shadows the reference has and this set was missing, so the radius came
    // down and the AO pass picked the difference up.
    sun.shadow.blurSamples = 16;
    // VSM compares depth moments rather than sampling a depth test, so the
    // constant bias PCF needed only darkens contact points here.
    sun.shadow.bias = 0;
    sun.shadow.normalBias = 0;
    scene.add(sun);
    scene.add(sun.target);

    /**
     * The pool. Same axis as the key, so it shades the same faces; no shadow,
     * so the key's dimetric shadows are the only ones in the frame; decay 0, so
     * the whole gradient comes from the cone rather than from distance.
     */
    const keySpot = new THREE.SpotLight(0xffeecd, 1, 0, 1, 1, 0);
    scene.add(keySpot);
    scene.add(keySpot.target);

    // A cool fill from behind lifts the faces the sun never reaches, which is
    // what the reference uses instead of a second hard shadow.
    const fill = new THREE.DirectionalLight(0xbfcbe0, 1);
    fill.position.set(-34, 28, -38);
    scene.add(fill);

    const environment = buildEnvironment();
    scene.add(environment.group);

    /**
     * Post chain: render, ground-truth ambient occlusion, then tone map.
     *
     * The AO is the part that matters. A voxel set is all coplanar boxes meeting
     * at right angles, and a direct light alone gives those junctions nothing —
     * the crease where a wall meets the floor, the underside of a desk and the
     * inside of a shelf all come out at the same brightness as the open floor.
     * GTAO puts that contact shading back, which is the shadow language the
     * reference art is drawn in. `OutputPass` has to be last: it is what applies
     * the renderer's tone curve and colour space, once, at the end.
     */
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));

    const ao = new GTAOPass(scene, camera, width, height);
    composer.addPass(ao);

    /**
     * Bloom, on a high threshold so it only ever touches the crystal and the
     * screens. It sits before the tone map, where the emissive surfaces are
     * still above 1 and the white walls are not.
     */
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0, 0, 1);
    composer.addPass(bloom);

    composer.addPass(new OutputPass());

    // After the tone map, so the adjustment is perceptual rather than a change
    // to the light the scene is actually rendered with.
    const saturation = new ShaderPass(SATURATION_SHADER);
    // `ShaderPass` clones the uniform block, so its members come back loosely
    // typed; the shader above is the only definition of what is in there.
    const saturationUniform = saturation.uniforms.saturation as THREE.IUniform<number>;
    composer.addPass(saturation);

    /**
     * Pushes `VISUAL_CONFIG` into the scene. Called once at build and again on
     * every slider move, so the panel needs no knowledge of what it is driving.
     */
    const applyVisuals = (): void => {
      const config = VISUAL_CONFIG;
      renderer.toneMappingExposure = config.exposure;

      hemisphere.intensity = config.hemiIntensity;
      ambient.intensity = config.ambientIntensity;
      fill.intensity = config.fillIntensity;

      const keyPosition = keyLightPosition(config);
      sun.intensity = config.keyIntensity;
      sun.position.set(...keyPosition);
      sun.shadow.radius = config.shadowRadius;

      keySpot.intensity = config.keySpotIntensity;
      keySpot.position.set(...keyPosition);
      keySpot.angle = (config.keySpotAngleDeg * Math.PI) / 180;
      keySpot.penumbra = config.keySpotPenumbra;

      for (const { light, baseIntensity } of environment.roomLights) {
        light.intensity = baseIntensity * config.roomLightScale;
      }

      // Radius is in world units: about one desk depth, so it reaches into the
      // corners of a room without darkening a whole wall.
      ao.updateGtaoMaterial({
        radius: config.aoRadius,
        distanceExponent: 1.4,
        thickness: 1.2,
        scale: 1.15,
        samples: 16,
        screenSpaceRadius: false,
      });
      ao.blendIntensity = config.aoIntensity;

      bloom.strength = config.bloomStrength;
      bloom.radius = config.bloomRadius;
      bloom.threshold = config.bloomThreshold;

      saturationUniform.value = config.saturation;
    };
    applyVisuals();

    const disposeTunePanel = createTunePanel(container, {
      onChange: applyVisuals,
      onRebuild: () => setBuildToken((token) => token + 1),
    });

    const actors: Actor[] = [];
    let replayQueue: AgentPlan[] = [];
    let lastSpawnAt = 0;
    let spawnCount = 0;
    let hubPulse = 0;

    // Seat reservations, so two agents working in the same room never resolve to
    // the same point. Keyed `${roomId}:${seatIndex}`.
    const occupiedSeats = new Set<string>();

    const releaseSeat = (actor: Actor): void => {
      if (actor.seatKey) occupiedSeats.delete(actor.seatKey);
      actor.seatKey = null;
    };

    const claimSeat = (actor: Actor, room: RoomId): Point => {
      releaseSeat(actor);
      const seats = getRoom(room).seats;
      for (const [index, seat] of seats.entries()) {
        const key = `${room}:${index}`;
        if (occupiedSeats.has(key)) continue;
        occupiedSeats.add(key);
        actor.seatKey = key;
        return seat;
      }
      // Every seat taken: fall back to the first one and accept the overlap
      // rather than stranding the avatar in the corridor.
      return seats[0] ?? getRoom(room).center;
    };

    const project = (position: THREE.Vector3): { x: number; y: number } => {
      // The camera never moves, but its world matrix is only refreshed during a
      // render — project before the first frame and everything lands off-screen.
      camera.updateMatrixWorld();
      const projected = position.clone().project(camera);
      return {
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-projected.y * 0.5 + 0.5) * height,
      };
    };

    const makeLabel = (className: string): HTMLDivElement => {
      const element = document.createElement("div");
      element.className = className;
      overlay.appendChild(element);
      return element;
    };

    const spawnActor = (plan: AgentPlan): Actor | null => {
      if (plan.tasks.length === 0) return null;
      const hue = agentHue(plan.agentIdentifier);
      const rig = createAvatar(hue);
      const entrance = WAYPOINTS["entrance"] ?? { x: 0, z: 17 };
      rig.root.position.set(entrance.x, 0, entrance.z);
      scene.add(rig.root);

      const bubble = makeLabel("world-bubble");
      bubble.style.opacity = "0";

      const actor: Actor = {
        sessionId: plan.sessionId,
        agentIdentifier: plan.agentIdentifier,
        displayName: displayAgentName(plan.agentIdentifier),
        generation: plan.generation,
        rig,
        bubble,
        tasks: [...plan.tasks],
        currentTask: null,
        currentNode: "entrance",
        seatKey: null,
        path: [],
        pathIndex: 0,
        lane: LANES[spawnCount % LANES.length] ?? 0,
        segmentOrigin: { x: entrance.x, z: entrance.z },
        nearestApproach: Number.POSITIVE_INFINITY,
        blockedFor: 0,
        headingX: 0,
        headingZ: 1,
        distanceToTarget: Number.POSITIVE_INFINITY,
        phase: "walking",
        actionRemainingMs: 0,
        walkPhase: 0,
        facing: Math.PI,
        bornAt: performance.now(),
      };
      actors.push(actor);
      spawnCount += 1;
      return actor;
    };

    const beginNextTask = (actor: Actor): void => {
      const next = actor.tasks.shift();
      if (!next) {
        // No work left: walk out and despawn on arrival.
        if (actor.currentNode === "entrance") {
          actor.phase = "done";
          return;
        }
        actor.currentTask = {
          room: "entrance",
          action: "leave",
          durationMs: 0,
          sourceEventId: `exit-${actor.sessionId}`,
        };
      } else {
        actor.currentTask = next;
      }

      const target = actor.currentTask.room;
      const seat = claimSeat(actor, target);
      const path = findPath(actor.currentNode, target);
      // The graph ends at the room's doorway waypoint; the last leg is the walk
      // to whichever seat this actor reserved.
      actor.path = path.length > 0 ? [...path, seat] : [seat];
      actor.pathIndex = 0;
      actor.segmentOrigin = { x: actor.rig.root.position.x, z: actor.rig.root.position.z };
      actor.nearestApproach = Number.POSITIVE_INFINITY;
      actor.blockedFor = 0;
      actor.phase = "walking";
      actor.currentNode = target;

      // The icon alone is what the reference draws, but the caption is the part
      // that says which specimen the agent is actually working on, so it stays.
      const caption = actor.currentTask.caption;
      actor.bubble.textContent = caption
        ? `${actor.currentTask.icon ?? ""} ${caption}`.trim()
        : (actor.currentTask.icon ?? "");
    };

    const removeActor = (actor: Actor, index: number): void => {
      releaseSeat(actor);
      scene.remove(actor.rig.root);
      disposeAvatar(actor.rig);
      actor.bubble.remove();
      actors.splice(index, 1);
    };

    const ingestLiveEvents = (now: number): void => {
      const queued = pendingLiveRef.current;
      if (queued.length === 0) return;
      pendingLiveRef.current = [];

      for (const event of queued) {
        const task = taskForEvent(event);
        if (!task) continue;
        if (event.eventType === "article_created") hubPulse = 1;

        const existing = actors.find((actor) => actor.sessionId === event.sessionId);
        if (existing) {
          existing.tasks.push(task);
          if (existing.phase === "done") existing.phase = "walking";
          continue;
        }
        if (actors.length >= MAX_CONCURRENT_AGENTS) continue;

        const actor = spawnActor({
          sessionId: event.sessionId,
          agentIdentifier: event.agentIdentifier || "Agent",
          generation: event.generation || 1,
          startedAt: now,
          tasks: [task],
        });
        if (actor) beginNextTask(actor);
      }
    };

    const stageReplay = (now: number): void => {
      if (actors.length >= MAX_CONCURRENT_AGENTS) return;
      if (now - lastSpawnAt < SPAWN_INTERVAL_MS) return;
      if (replayQueue.length === 0) {
        // Loop the archive so the room is never empty between live events.
        replayQueue = [...plansRef.current];
        if (replayQueue.length === 0) return;
      }
      const plan = replayQueue.shift();
      if (!plan) return;
      if (actors.some((actor) => actor.sessionId === plan.sessionId)) return;

      const actor = spawnActor(plan);
      if (actor) {
        beginNextTask(actor);
        lastSpawnAt = now;
      }
    };

    /**
     * The point an actor actually walks to: its waypoint, shifted sideways onto
     * its own lane, so two avatars heading the same way travel side by side
     * instead of fighting over one spot. The last point of a path is the seat
     * the actor reserved, which is already its own, and is left where it is.
     */
    const legTarget = (actor: Actor, waypoint: Point, isFinal: boolean): Point => {
      if (isFinal || actor.lane === 0) return waypoint;
      const dx = waypoint.x - actor.segmentOrigin.x;
      const dz = waypoint.z - actor.segmentOrigin.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-3) return waypoint;
      return {
        x: waypoint.x - (dz / length) * actor.lane,
        z: waypoint.z + (dx / length) * actor.lane,
      };
    };

    const finishLeg = (actor: Actor, target: Point): void => {
      actor.pathIndex += 1;
      actor.segmentOrigin = target;
      actor.nearestApproach = Number.POSITIVE_INFINITY;
      actor.blockedFor = 0;
      if (actor.pathIndex < actor.path.length) return;

      actor.phase = "acting";
      actor.actionRemainingMs = actor.currentTask?.durationMs ?? 0;
      const room = actor.currentTask ? getRoom(actor.currentTask.room) : null;
      if (room) actor.facing = room.stationFacing;
    };

    const advanceActor = (actor: Actor, delta: number, elapsed: number): void => {
      const position = actor.rig.root.position;

      if (actor.phase === "walking") {
        const waypoint = actor.path[actor.pathIndex];
        if (!waypoint) {
          actor.phase = "acting";
          actor.actionRemainingMs = actor.currentTask?.durationMs ?? 0;
        } else {
          const isFinal = actor.pathIndex === actor.path.length - 1;
          const target = legTarget(actor, waypoint, isFinal);
          const dx = target.x - position.x;
          const dz = target.z - position.z;
          const distance = Math.hypot(dx, dz);
          actor.distanceToTarget = distance;

          // Three ways a leg ends: standing on it, having been carried past it,
          // or having spent too long shuffling without getting any closer. The
          // last two are what keep a busy corridor from locking up — an actor
          // nudged off a waypoint it can no longer touch would otherwise stand
          // there for the rest of the session.
          const legX = target.x - actor.segmentOrigin.x;
          const legZ = target.z - actor.segmentOrigin.z;
          const passed = (position.x - target.x) * legX + (position.z - target.z) * legZ > 0;
          actor.blockedFor = distance < actor.nearestApproach - 0.01 ? 0 : actor.blockedFor + delta;
          actor.nearestApproach = Math.min(actor.nearestApproach, distance);

          // The watchdog is for corridor waypoints only. A seat is reserved to
          // one actor, so the walk to it always completes — giving up on it
          // would leave the avatar acting out its task in the middle of the
          // floor, which is worse than waiting.
          const stuck = !isFinal && actor.blockedFor > STUCK_SECONDS;
          if (distance < ARRIVAL_EPSILON || passed || stuck) {
            finishLeg(actor, target);
          } else {
            const step = Math.min(distance, WALK_SPEED * delta);
            actor.headingX = dx / distance;
            actor.headingZ = dz / distance;
            position.x += actor.headingX * step;
            position.z += actor.headingZ * step;
            actor.walkPhase += delta * 9.2;
            actor.facing = Math.atan2(dx, dz) + Math.PI;
          }
        }
      } else if (actor.phase === "acting") {
        actor.actionRemainingMs -= delta * 1000;
        if (actor.actionRemainingMs <= 0) beginNextTask(actor);
      }

      // Shortest-arc rotation towards the target facing.
      let deltaAngle = actor.facing - actor.rig.root.rotation.y;
      while (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
      while (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
      actor.rig.root.rotation.y += deltaAngle * Math.min(1, delta * 11);

      const action = actor.phase === "walking" ? "walk" : (actor.currentTask?.action ?? "idle");
      poseAvatar(actor.rig, action, actor.walkPhase, elapsed, delta);

      const anchor = new THREE.Vector3(position.x, 3.2, position.z);
      const screen = project(anchor);

      const showBubble =
        actor.phase === "acting" && actor.bubble.textContent !== "" && actor.actionRemainingMs > 600;
      actor.bubble.style.opacity = showBubble ? "1" : "0";
      actor.bubble.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`;
    };

    /**
     * Pushes one avatar out of another, sideways.
     *
     * The direction matters more than the amount. A shove with any component
     * back along an actor's own route is what deadlocks a crowd — two avatars
     * converging on the same corridor spend the rest of the session pushing
     * each other off it — so only the part across the heading survives.
     */
    const nudge = (actor: Actor, nx: number, nz: number, amount: number): void => {
      // An actor that has arrived is standing where its task put it; the one
      // with somewhere else to be is the one that moves.
      if (actor.phase !== "walking") return;
      // Close to its target, an actor is committed: pushing it now is what
      // stops it from ever standing on the spot it is walking to.
      if (actor.distanceToTarget < 1.6) return;

      const along = nx * actor.headingX + nz * actor.headingZ;
      let sideX = nx - actor.headingX * along;
      let sideZ = nz - actor.headingZ * along;
      let length = Math.hypot(sideX, sideZ);
      if (length < 1e-3) {
        // Dead ahead, so there is no sideways to speak of: pick one.
        sideX = -actor.headingZ;
        sideZ = actor.headingX;
        length = 1;
      }

      actor.rig.root.position.x += (sideX / length) * amount;
      actor.rig.root.position.z += (sideZ / length) * amount;
    };

    /** Keeps two avatars out of each other, once per frame. */
    const separateActors = (): void => {
      for (let first = 0; first < actors.length; first += 1) {
        for (let second = first + 1; second < actors.length; second += 1) {
          const one = actors[first];
          const other = actors[second];
          if (!one || !other) continue;

          const movers = (one.phase === "walking" ? 1 : 0) + (other.phase === "walking" ? 1 : 0);
          if (movers === 0) continue;

          const here = one.rig.root.position;
          const there = other.rig.root.position;
          let dx = there.x - here.x;
          let dz = there.z - here.z;
          let distance = Math.hypot(dx, dz);
          if (distance >= AGENT_RADIUS * 2) continue;
          if (distance < 1e-4) {
            // Exactly coincident — two actors spawn on the same entrance tile.
            // Any stable axis will do; dividing by zero will not.
            dx = 1;
            dz = 0;
            distance = 1;
          }

          const share = (AGENT_RADIUS * 2 - distance) / movers;
          nudge(one, -dx / distance, -dz / distance, share);
          nudge(other, dx / distance, dz / distance, share);
        }
      }
    };

    const publishRoster = (): void => {
      const callback = rosterCallbackRef.current;
      if (!callback) return;
      callback(
        actors.map((actor) => ({
          name: actor.displayName,
          status:
            actor.phase === "walking"
              ? (STATUS_LABEL["walking"] ?? "Moving")
              : (STATUS_LABEL[actor.currentTask?.action ?? "idle"] ?? "Idle"),
          hue: agentHue(actor.agentIdentifier),
        })),
      );
    };

    let frameHandle = 0;
    let lastFrameTime = performance.now();
    let rosterClock = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      frameHandle = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min(0.05, (now - lastFrameTime) / 1000);
      lastFrameTime = now;
      const elapsed = clock.getElapsedTime();

      ingestLiveEvents(now);
      if (replayRef.current) stageReplay(now);

      for (let index = actors.length - 1; index >= 0; index -= 1) {
        const actor = actors[index];
        if (!actor) continue;
        advanceActor(actor, delta, elapsed);
        if (actor.phase === "done" && now - actor.bornAt > 4000) removeActor(actor, index);
      }
      separateActors();

      // Hub crystal: slow breathing, plus a flash when an article is created.
      hubPulse = Math.max(0, hubPulse - delta * 0.85);
      const glow = 0.62 + Math.sin(elapsed * 1.5) * 0.12 + hubPulse * 0.9;
      environment.hubCrystalMaterial.opacity = Math.min(1, glow);
      environment.hubCrystal.rotation.y = elapsed * 0.35;
      environment.hubCrystal.scale.setScalar(1 + hubPulse * 0.35);

      rosterClock += delta;
      if (rosterClock > 0.5) {
        rosterClock = 0;
        publishRoster();
      }

      composer.render();
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      width = containerRef.current.clientWidth;
      height = containerRef.current.clientHeight;
      renderer.setSize(width, height);
      composer.setSize(width, height);
      ao.setSize(width, height);
      bloom.setSize(width, height);
      applyCameraFrustum();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameHandle);
      window.removeEventListener("resize", handleResize);
      for (let index = actors.length - 1; index >= 0; index -= 1) {
        const actor = actors[index];
        if (actor) removeActor(actor, index);
      }
      disposeTunePanel();
      environment.dispose();
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // `buildToken` only ever changes from the tuning panel, and only for values
    // that are compiled into the geometry rather than read per frame.
  }, [buildToken]);

  return (
    <div className="world-stage">
      <div ref={containerRef} className="world-viewport" />
      <div ref={overlayRef} className="world-overlay" />
    </div>
  );
}
