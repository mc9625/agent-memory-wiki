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
  agentOrigin,
  buildAgentPlans,
  cleaningTask,
  displayAgentName,
  isHumanAgent,
  stableHash,
  taskForEvent,
  type AgentPlan,
  type AgentTask,
} from "../../lib/world/choreography";
import { WAYPOINTS, findPath, getRoom, type Point, type RoomId } from "../../lib/world/layout";
import {
  avatarPalette,
  createAvatar,
  disposeAvatar,
  poseAvatar,
  setAvatarOpacity,
  type AvatarRig,
  type JanitorTool,
} from "./avatar";
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

/**
 * How long a live actor holds its pose before giving up and walking out.
 *
 * A recorded session is a finished thing: each of its events lasts the few
 * seconds the choreography gives it and the next one follows. A live one is
 * not. Somebody reading an article is *still reading it* until they open
 * something else, so the honest length of their task is "until the next event",
 * and the timer is only there for the case where no next event ever comes —
 * they closed the laptop, or the departure beacon never fired. Cut short by any
 * event from the same session, so a reader who opens a second article changes
 * what their bubble says without getting up.
 *
 * This is what a live task's duration means; `durationMs` from the choreography
 * still governs how long the caption stays up, and replayed actors are unaffected.
 */
const LIVE_IDLE_EXIT_MS = 90_000;
/**
 * How long a reported departure is held before the avatar acts on it.
 *
 * The browser beacons `pagehide`, and a reload raises `pagehide` too — followed
 * a moment later by the page view for the very same visit. Acted on at once,
 * that pair walks the avatar to the door and straight back. Any event arriving
 * inside the grace cancels the exit, which is what makes a reload invisible and
 * leaves a real departure a second and a half late.
 */
const LEAVE_GRACE_MS = 8_000;
/** Seconds of being shoved about without getting nearer before a leg is given up on. */
const STUCK_SECONDS = 2.5;
/** Screen-space gap kept between two captions that would otherwise overlap. */
const BUBBLE_GAP = 6;
/** How long a clicked avatar keeps its card up before closing it itself. */
const INFO_BUBBLE_MS = 20_000;
/**
 * How long the floor has to stay empty before the cleaner comes on.
 *
 * The stage is honest about an idle archive — nothing happening means nobody on
 * the floor — but an empty room for minutes at a time reads as a broken page.
 * One cleaner working the round says closed for the night instead, and is the
 * only avatar on stage that stands for nothing in the archive. It leaves the
 * moment a real agent arrives.
 */
const CLEANER_IDLE_MS = 9_000;
/**
 * How long a shift lasts, and the break before the next one starts.
 *
 * A cleaner that never left would be a fixture rather than somebody working:
 * after a minute it walks out, and the floor is genuinely empty for a while
 * before the next one comes on. The break is random inside the range so the
 * arrivals do not fall into a rhythm the eye can predict.
 */
const CLEANER_SHIFT_MS = 62_000;
const CLEANER_BREAK_MIN_MS = 25_000;
const CLEANER_BREAK_MAX_MS = 80_000;
/** Tools the shift rotates through, so two consecutive cleaners differ. */
const CLEANER_TOOLS: readonly JanitorTool[] = ["vacuum", "broom", "cloth"];

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
  /**
   * Station reserved for this actor: `${roomId}:s${index}` for a seat,
   * `${roomId}:w${index}` for a standby spot in the room's waiting queue.
   */
  stationKey: string | null;
  /** Queued for a seat rather than sitting in one. */
  waiting: boolean;
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
  /** Put on stage by a live event, and therefore allowed to wait for the next. */
  live: boolean;
  /**
   * Whether this avatar came from the live stream at all.
   *
   * Separate from `live`, which is the behavioural flag and is cleared when the
   * LIVE sign goes dark so the actor stops holding for a next event. This one
   * never changes, and it is what the ghosting reads: an agent that walked in
   * live is still the live one while it finishes up and leaves, and the
   * recorded cast around it still has to read as recorded. Set when a live
   * event lands on a replayed session too: from that moment the avatar is the
   * live one, whichever queue put it on the floor.
   */
  fromLive: boolean;
  /** One of the cleaners: generated, never rostered, never counted as an agent. */
  readonly janitor: boolean;
  /** Which tool it carries, or null for an agent. The rag works the glass. */
  readonly tool: JanitorTool | null;
  /** Facing the current task asks for, when it is not the room's own station. */
  facingOverride: number | null;
  /** What the rig's materials are currently set to, so the fade writes once. */
  opacity: number;
  /** A cleaner that has been sent home, and is walking out rather than working. */
  retiring: boolean;
  /** Roster swatch, resolved once at spawn from the avatar's own palette. */
  readonly human: boolean;
  readonly head: string;
  readonly shirt: string;
  /** How long the caption stays up, which is not how long the pose is held. */
  bubbleMs: number;
  /** Caption box, measured when the text changes and read by the stacking pass. */
  bubbleWidth: number;
  bubbleHeight: number;
  /** The card a click puts over this avatar's head, and when it closes itself. */
  readonly info: HTMLDivElement;
  infoUntil: number;
  infoWidth: number;
  infoHeight: number;
  /** The span inside the bubble, which is what the shake animates. */
  glyph: HTMLSpanElement | null;
  /** A bubble carrying an icon and no words, which is drawn large and shaken. */
  iconOnly: boolean;
  /** Where the caption wants to sit this frame, before any stacking. */
  bubbleX: number;
  bubbleY: number;
  bubbleVisible: boolean;
  /** When a reported departure becomes real, or null when none is pending. */
  exitAt: number | null;
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
  readonly onRosterChange?: (roster: readonly RosterEntry[]) => void;
}

export interface RosterEntry {
  readonly name: string;
  readonly status: string;
  readonly hue: number;
  /** A person reading the wiki, rather than an agent. */
  readonly human: boolean;
  /**
   * Whether this one came in on the live stream. The roster shows both casts at
   * once whenever a live session is still finishing up under a replay, so the
   * row has to say which is which — the same thing the ghosting says on stage.
   */
  readonly live: boolean;
  /** The avatar's own head colour, so the HUD swatch matches what is on stage. */
  readonly head: string;
  /** Its shirt, drawn as a band under the head the way the avatar wears it. */
  readonly shirt: string;
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
    /** When the next cleaner may come on, and when the one on now clocks off. */
    let cleanerDueAt = performance.now() + CLEANER_IDLE_MS;
    let shiftEndsAt = Number.POSITIVE_INFINITY;
    /** Which shift is on, and how far through its round it is. */
    let cleanerShift = 0;
    let cleaningStep = 0;
    /** The sign as the loop last saw it, so a flip can be acted on once. */
    let replayMode = replayRef.current;

    // Station reservations, so two agents working in the same room never resolve
    // to the same point. Keyed `${roomId}:s${index}` and `${roomId}:w${index}`.
    const occupiedStations = new Set<string>();

    const releaseStation = (actor: Actor): void => {
      if (actor.stationKey) occupiedStations.delete(actor.stationKey);
      actor.stationKey = null;
    };

    const claimStation = (actor: Actor, room: RoomId): Point => {
      releaseStation(actor);
      const { seats, standby, center } = getRoom(room);

      // Seats first, then the standby row. Three agents fit the desks; a fourth
      // used to be sent to the first seat anyway and stood inside whoever was
      // already in it, so it queues instead and `promoteWaiting` moves it up
      // when one frees. A cleaner takes the two in the other order: it works
      // the floor rather than a desk, which also leaves every seat free for the
      // agents it is standing in for.
      const groups: readonly (readonly [string, readonly Point[]])[] = actor.janitor
        ? [["w", standby], ["s", seats]]
        : [["s", seats], ["w", standby]];

      for (const [prefix, points] of groups) {
        for (const [index, point] of points.entries()) {
          const key = `${room}:${prefix}${index}`;
          if (occupiedStations.has(key)) continue;
          occupiedStations.add(key);
          actor.stationKey = key;
          actor.waiting = prefix === "w";
          return point;
        }
      }

      // Six in one room, which the concurrency cap makes possible only if every
      // agent is doing the same thing at once. Overlap beats stranding them.
      actor.waiting = true;
      return seats[0] ?? center;
    };

    /**
     * Walks a queued avatar to a seat as soon as one frees.
     *
     * The route goes through the room's own waypoint rather than straight
     * across, because that is the leg the layout tests prove clear of the
     * furniture — a diagonal from a standby spot to a seat is not.
     */
    const promoteWaiting = (): void => {
      for (const actor of actors) {
        // A cleaner is standing on a standby spot on purpose, not queueing.
        if (actor.janitor || !actor.waiting || actor.phase !== "acting") continue;
        const room = actor.currentTask?.room;
        if (!room) continue;

        const seats = getRoom(room).seats;
        let claimed: Point | null = null;
        for (const [index, seat] of seats.entries()) {
          const key = `${room}:s${index}`;
          if (occupiedStations.has(key)) continue;
          releaseStation(actor);
          occupiedStations.add(key);
          actor.stationKey = key;
          actor.waiting = false;
          claimed = seat;
          break;
        }
        if (!claimed) continue;

        const arrival = WAYPOINTS[room];
        actor.path = arrival ? [arrival, claimed] : [claimed];
        actor.pathIndex = 0;
        actor.segmentOrigin = { x: actor.rig.root.position.x, z: actor.rig.root.position.z };
        actor.nearestApproach = Number.POSITIVE_INFINITY;
        actor.blockedFor = 0;
        actor.phase = "walking";
      }
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

    const spawnActor = (
      plan: AgentPlan,
      live = false,
      janitorTool: JanitorTool | null = null,
    ): Actor | null => {
      if (plan.tasks.length === 0) return null;
      const hue = agentHue(plan.agentIdentifier);
      // A browsing human is dressed rather than monochrome, and which outfit
      // comes off the session identifier — the only thing that separates two
      // readers, since every one of them classifies to the same agent name.
      const style = {
        human: isHumanAgent(plan.agentIdentifier),
        variant: stableHash(plan.sessionId),
        ...(janitorTool ? { janitor: janitorTool } : {}),
      };
      const rig = createAvatar(hue, style);
      const palette = avatarPalette(hue, style);
      const entrance = WAYPOINTS["entrance"] ?? { x: 0, z: 17 };
      rig.root.position.set(entrance.x, 0, entrance.z);
      scene.add(rig.root);

      const bubble = makeLabel("world-bubble");
      bubble.style.opacity = "0";
      const info = makeLabel("world-bubble world-bubble-card");
      info.style.opacity = "0";

      const actor: Actor = {
        sessionId: plan.sessionId,
        agentIdentifier: plan.agentIdentifier,
        displayName: displayAgentName(plan.agentIdentifier),
        generation: plan.generation,
        rig,
        bubble,
        info,
        infoUntil: 0,
        infoWidth: 0,
        infoHeight: 0,
        tasks: [...plan.tasks],
        currentTask: null,
        currentNode: "entrance",
        stationKey: null,
        waiting: false,
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
        live,
        fromLive: live,
        janitor: janitorTool !== null,
        tool: janitorTool,
        facingOverride: null,
        opacity: 1,
        retiring: false,
        bubbleMs: 0,
        bubbleWidth: 0,
        bubbleHeight: 0,
        glyph: null,
        iconOnly: false,
        bubbleX: 0,
        bubbleY: 0,
        bubbleVisible: false,
        human: style.human,
        head: `#${palette.skin.getHexString()}`,
        shirt: `#${palette.shirt.getHexString()}`,
        exitAt: null,
      };
      actors.push(actor);
      spawnCount += 1;
      return actor;
    };

    /**
     * Fills the card a click puts over an avatar's head.
     *
     * Four short lines, because it hangs in the scene rather than in a panel: a
     * card wide enough for a raw user agent would cover the room the avatar is
     * standing in. What is left is who it is, what kind of client it came from,
     * the head of its session digest, and how long it has been on the floor.
     */
    const fillInfo = (actor: Actor, now: number): void => {
      const seconds = Math.max(1, Math.round((now - actor.bornAt) / 1000));
      const lines = [
        `${actor.displayName} · ${actor.fromLive ? "LIVE" : "REPLAY"}`,
        actor.janitor ? "night shift · not an agent" : agentOrigin(actor.agentIdentifier),
        `#${actor.sessionId.slice(0, 8)}`,
        `${(actor.currentTask?.room ?? "hub").toUpperCase()} · ${seconds}s`,
      ];
      actor.info.replaceChildren(
        ...lines.map((line, index) => {
          const row = document.createElement("div");
          if (index === 0) row.className = "world-bubble-card-name";
          row.textContent = line;
          return row;
        }),
      );
      actor.infoWidth = actor.info.offsetWidth || 140;
      actor.infoHeight = actor.info.offsetHeight || 56;
    };

    /**
     * Opens or closes an avatar's card. A second click on the same avatar shuts
     * it, and so does the timer: a card left up over somebody who has walked to
     * the other side of the floor is a label following them about.
     */
    const toggleInfo = (actor: Actor, now: number): void => {
      if (actor.infoUntil > now) {
        actor.infoUntil = 0;
        return;
      }
      fillInfo(actor, now);
      actor.infoUntil = now + INFO_BUBBLE_MS;
    };

    /** Finds the actor a click landed on, if any. */
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handleClick = (clickEvent: MouseEvent): void => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clickEvent.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((clickEvent.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const roots = actors.map((actor) => actor.rig.root);
      const hits = raycaster.intersectObjects(roots, true);
      const first = hits[0];
      if (!first) return;

      // The hit is a limb; the actor is whichever root it hangs from.
      let node: THREE.Object3D | null = first.object;
      while (node !== null) {
        const owner = actors.find((candidate) => candidate.rig.root === node);
        if (owner) {
          toggleInfo(owner, performance.now());
          return;
        }
        node = node.parent;
      }
    };
    renderer.domElement.addEventListener("click", handleClick);

    /** The caption, which the bubble shows for the choreography's own duration. */
    const setCaption = (actor: Actor, task: AgentTask): void => {
      // The icon alone is what the reference draws, but the caption is the part
      // that says which specimen the agent is actually working on, so it stays.
      // The text lives in a span rather than in the bubble itself: the bubble's
      // own transform is where it sits on screen, so the shake needs something
      // of its own to animate.
      const glyph = document.createElement("span");
      glyph.className = "world-bubble-glyph";
      glyph.textContent = task.caption
        ? `${task.icon ?? ""} ${task.caption}`.trim()
        : (task.icon ?? "");
      actor.bubble.replaceChildren(glyph);
      actor.glyph = glyph;
      actor.iconOnly = !task.caption && Boolean(task.icon);
      actor.bubble.classList.toggle("world-bubble-icon", actor.iconOnly);
      actor.bubbleMs = task.durationMs;
      // Measured here rather than per frame: the stacking pass needs the box,
      // and reading it every frame forces a layout for every avatar on stage.
      actor.bubbleWidth = actor.bubble.offsetWidth || 150;
      actor.bubbleHeight = actor.bubble.offsetHeight || 26;
    };

    /** How long a task holds its pose once the avatar has arrived. */
    /**
     * How long a task holds its pose once the avatar has arrived.
     *
     * The long live hold is a wait for the next event, so it only applies when
     * there is nothing waiting already. A reader who opened a second article
     * while still walking to READ used to sit down, hold the first caption for
     * a minute and a half, and only then show the second one — the event had
     * arrived during the walk, so the shortcut in `ingestLiveEvents` that ends
     * the hold early never fired.
     */
    const holdFor = (actor: Actor, task: AgentTask): number =>
      actor.live && task.action !== "leave" && actor.tasks.length === 0
        ? LIVE_IDLE_EXIT_MS
        : task.durationMs;

    const beginNextTask = (actor: Actor): void => {
      let next = actor.tasks.shift();
      // A cleaner is never finished: while the floor is empty it moves on to
      // the next room of its round. Once sent home it falls through to the exit
      // below like anybody else.
      if (!next && actor.janitor && !actor.retiring) {
        cleaningStep += 1;
        next = cleaningTask(cleaningStep, actor.tool === "cloth");
      }
      if (!next) {
        // Nothing arrived within the hold: walk out and despawn on arrival.
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
        // Already in the room the next event belongs to, and already settled in
        // it: stay in the seat. Somebody moving from one article to the next is
        // still reading, and standing them up to walk a circuit back to the
        // chair they are sitting in is the wrong picture of what happened.
        if (actor.phase === "acting" && actor.currentNode === next.room) {
          actor.currentTask = next;
          setCaption(actor, next);
          actor.actionRemainingMs = holdFor(actor, next);
          return;
        }
        actor.currentTask = next;
      }

      const target = actor.currentTask.room;
      // The window cleaner goes to the pane rather than to a station: nothing
      // reserves that spot, because only one cleaner is ever on the floor.
      const pane = actor.tool === "cloth" ? getRoom(target).glass : undefined;
      if (pane) releaseStation(actor);
      actor.facingOverride = pane ? pane.facing : null;
      const seat = pane ? pane.at : claimStation(actor, target);
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
      setCaption(actor, actor.currentTask);
    };

    const removeActor = (actor: Actor, index: number): void => {
      releaseStation(actor);
      scene.remove(actor.rig.root);
      disposeAvatar(actor.rig);
      actor.bubble.remove();
      actor.info.remove();
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
          if (event.eventType === "agent_session_ended") {
            existing.exitAt = now + LEAVE_GRACE_MS;
            continue;
          }
          // Anything else from this session says they are still here.
          existing.exitAt = null;
          existing.tasks.push(task);
          existing.live = true;
          existing.fromLive = true;
          // The hold is a wait for exactly this, so end it now rather than
          // making the visitor watch out the rest of it.
          if (existing.phase === "acting") existing.actionRemainingMs = 0;
          if (existing.phase === "done") existing.phase = "walking";
          continue;
        }
        // A visitor leaving is only worth showing if they were on the floor.
        // Spawning for the exit alone puts an avatar at the door for the length
        // of one walk to the same door, which reads as a glitch.
        if (event.eventType === "agent_session_ended") continue;
        if (agentCount() >= MAX_CONCURRENT_AGENTS) continue;

        const actor = spawnActor(
          {
            sessionId: event.sessionId,
            agentIdentifier: event.agentIdentifier || "Agent",
            generation: event.generation || 1,
            startedAt: now,
            tasks: [task],
          },
          true,
        );
        if (actor) beginNextTask(actor);
      }
    };

    /**
     * Ends the replay without emptying the floor by force.
     *
     * Clearing the recorded cast's remaining tasks is all it takes: an actor
     * with nothing queued walks to the door when its current action ends.
     * Deleting them outright made the switch read as a bug — half the cast
     * disappearing mid-stride — where this reads as a shift ending. Live
     * avatars are never touched: the live stage is always on.
     */
    const retireReplayCast = (now: number): void => {
      for (const actor of actors) {
        if (actor.janitor || actor.fromLive) continue;
        actor.tasks = [];
        actor.exitAt = null;
      }
      lastSpawnAt = now;
    };

    /** Agents on stage. The cleaner does not count towards the cap or the HUD. */
    const agentCount = (): number => actors.reduce((total, actor) => total + (actor.janitor ? 0 : 1), 0);

    /** Sends the cleaner to the door, and stops its round refilling. */
    const dismissCleaner = (actor: Actor, now: number): void => {
      if (actor.retiring) return;
      actor.retiring = true;
      actor.tasks = [];
      // The exit branch of the frame loop is what walks it out, the same way a
      // visitor's reported departure does.
      actor.exitAt = now;
    };

    /**
     * Puts one cleaner on an empty floor, and takes it off again when an agent
     * turns up. Only ever one: two of them mopping an empty office reads as a
     * crowd scene, which is the opposite of what the quiet stage is saying.
     */
    const stageCleaners = (now: number): void => {
      if (agentCount() > 0) {
        // An agent on the floor ends the shift, and the next one waits out the
        // idle timer from the moment the archive goes quiet again.
        cleanerDueAt = now + CLEANER_IDLE_MS;
        for (const actor of actors) {
          if (actor.janitor) dismissCleaner(actor, now);
        }
        return;
      }

      const onShift = actors.find((actor) => actor.janitor);
      if (onShift) {
        if (now >= shiftEndsAt) {
          dismissCleaner(onShift, now);
          shiftEndsAt = Number.POSITIVE_INFINITY;
          cleanerDueAt =
            now +
            CLEANER_BREAK_MIN_MS +
            Math.random() * (CLEANER_BREAK_MAX_MS - CLEANER_BREAK_MIN_MS);
        }
        return;
      }
      if (now < cleanerDueAt) return;

      const tool = CLEANER_TOOLS[cleanerShift % CLEANER_TOOLS.length] ?? "vacuum";
      cleanerShift += 1;
      cleaningStep = cleanerShift;
      const actor = spawnActor(
        {
          sessionId: `cleaner-${cleanerShift}`,
          agentIdentifier: "Custodian",
          generation: 0,
          startedAt: now,
          tasks: [cleaningTask(cleaningStep, tool === "cloth")],
        },
        false,
        tool,
      );
      if (actor) {
        beginNextTask(actor);
        shiftEndsAt = now + CLEANER_SHIFT_MS;
      }
    };

    const stageReplay = (now: number): void => {
      if (agentCount() >= MAX_CONCURRENT_AGENTS) return;
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
      actor.actionRemainingMs = actor.currentTask ? holdFor(actor, actor.currentTask) : 0;
      const room = actor.currentTask ? getRoom(actor.currentTask.room) : null;
      if (room) actor.facing = actor.facingOverride ?? room.stationFacing;
    };

    const advanceActor = (actor: Actor, delta: number, elapsed: number): void => {
      const position = actor.rig.root.position;

      if (actor.phase === "walking") {
        const waypoint = actor.path[actor.pathIndex];
        if (!waypoint) {
          actor.phase = "acting";
          actor.actionRemainingMs = actor.currentTask ? holdFor(actor, actor.currentTask) : 0;
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
        actor.bubbleMs -= delta * 1000;
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

      // The caption runs on its own clock. A live actor holds its pose for as
      // long as ninety seconds, and a speech bubble left up for all of it is a
      // label, not a line of dialogue.
      const showBubble =
        actor.phase === "acting" && actor.bubble.textContent !== "" && actor.bubbleMs > 600;
      actor.bubble.style.opacity = showBubble ? "1" : "0";
      // A wordless bubble shakes as it appears, the way an iMessage effect does.
      // Restarted by hand: the animation only replays if the class goes away and
      // the browser is made to lay the element out in between.
      if (showBubble && !actor.bubbleVisible && actor.iconOnly && actor.glyph) {
        actor.glyph.classList.remove("world-bubble-shake");
        void actor.glyph.offsetWidth;
        actor.glyph.classList.add("world-bubble-shake");
      }
      // Where it wants to be. `layoutBubbles` decides where it goes, once every
      // avatar has moved and the whole set can be compared.
      actor.bubbleVisible = showBubble;
      actor.bubbleX = screen.x;
      actor.bubbleY = screen.y;
    };

    /**
     * Lifts captions off each other.
     *
     * Avatars seated side by side in one room put their bubbles at nearly the
     * same screen height, and the isometric camera gives no depth to separate
     * them with. The lower a bubble sits the nearer its avatar is to the
     * camera, so the near one keeps the spot over its head and the ones behind
     * rise above it — which is the order the eye reads them in anyway. A lifted
     * bubble drops its tail: an arrow that no longer points at its own avatar
     * is worse than none.
     */
    const layoutBubbles = (now: number): void => {
      const placed: { left: number; right: number; top: number; bottom: number }[] = [];

      /** Puts one bubble at the head, or above whatever is already there. */
      const place = (
        element: HTMLDivElement,
        x: number,
        y: number,
        width: number,
        height: number,
      ): void => {
        const left = x - width / 2;
        const right = x + width / 2;
        let bottom = y;

        // One lift can push a bubble into a box it had already cleared, so the
        // sweep repeats until a pass moves nothing. Each pass that moves clears
        // at least one more box, so the bound is the number of boxes.
        for (let pass = 0; pass <= placed.length; pass += 1) {
          let moved = false;
          for (const box of placed) {
            if (right <= box.left || left >= box.right) continue;
            if (bottom - height >= box.bottom || bottom <= box.top) continue;
            bottom = box.top - BUBBLE_GAP;
            moved = true;
          }
          if (!moved) break;
        }

        placed.push({ left, right, top: bottom - height, bottom });
        element.classList.toggle("world-bubble-lifted", bottom < y - 1);
        element.style.transform = `translate(-50%, -100%) translate(${x}px, ${bottom}px)`;
      };

      // Cards first, so they keep the spot over the head they belong to and it
      // is the caption that rides above them: a card is asked for by name and
      // has to stay attached to the avatar it was asked about.
      const cards = actors.filter((actor) => actor.infoUntil > now);
      cards.sort((left, right) => right.bubbleY - left.bubbleY);
      for (const actor of cards) {
        actor.info.style.opacity = "1";
        place(actor.info, actor.bubbleX, actor.bubbleY, actor.infoWidth, actor.infoHeight);
      }
      for (const actor of actors) {
        if (actor.infoUntil <= now) actor.info.style.opacity = "0";
      }

      const visible = actors.filter((actor) => actor.bubbleVisible);
      visible.sort((left, right) => right.bubbleY - left.bubbleY);
      for (const actor of visible) {
        place(actor.bubble, actor.bubbleX, actor.bubbleY, actor.bubbleWidth, actor.bubbleHeight);
      }
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

    /**
     * Fades the recorded cast while a live one shares the floor.
     *
     * Both are real sessions, but only one of them is happening now, and with
     * both drawn solid the viewer has no way to tell which avatar is the reason
     * the LIVE sign is lit.
     */
    const applyGhosting = (): void => {
      const liveOnStage = actors.some((actor) => actor.fromLive && !actor.janitor);
      for (const actor of actors) {
        const ghost = liveOnStage && !actor.fromLive && !actor.janitor;
        const target = ghost ? 0.5 : 1;
        if (actor.opacity === target) continue;
        actor.opacity = target;
        setAvatarOpacity(actor.rig, target);
        actor.bubble.style.filter = ghost ? "opacity(0.55)" : "";
        actor.info.style.filter = ghost ? "opacity(0.55)" : "";
      }
    };

    const publishRoster = (): void => {
      const callback = rosterCallbackRef.current;
      if (!callback) return;
      callback(
        // The cleaner is not an agent and never appears in the roster: the HUD
        // counts what the archive is doing, and it is doing nothing.
        actors
          .filter((actor) => !actor.janitor)
          .map((actor) => ({
            name: actor.displayName,
            status:
              actor.phase === "walking"
                ? (STATUS_LABEL["walking"] ?? "Moving")
                : (STATUS_LABEL[actor.currentTask?.action ?? "idle"] ?? "Idle"),
            hue: agentHue(actor.agentIdentifier),
            human: actor.human,
            live: actor.fromLive,
            head: actor.head,
            shirt: actor.shirt,
          })),
      );
    };

    let frameHandle = 0;
    let lastFrameTime = performance.now();
    let rosterClock = 0;
    let infoClock = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      frameHandle = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min(0.05, (now - lastFrameTime) / 1000);
      lastFrameTime = now;
      const elapsed = clock.getElapsedTime();

      if (replayRef.current !== replayMode) {
        replayMode = replayRef.current;
        if (!replayMode) retireReplayCast(now);
      }

      ingestLiveEvents(now);
      if (replayMode) stageReplay(now);
      stageCleaners(now);

      for (let index = actors.length - 1; index >= 0; index -= 1) {
        const actor = actors[index];
        if (!actor) continue;
        if (actor.exitAt !== null && now >= actor.exitAt) {
          actor.exitAt = null;
          actor.tasks.push({
            room: "entrance",
            action: "leave",
            durationMs: 0,
            sourceEventId: `exit-${actor.sessionId}`,
          });
          // Cut the hold short: they are gone, there is nothing left to wait for.
          if (actor.phase === "acting") actor.actionRemainingMs = 0;
        }
        advanceActor(actor, delta, elapsed);
        if (actor.phase === "done" && now - actor.bornAt > 4000) removeActor(actor, index);
      }
      separateActors();
      promoteWaiting();
      applyGhosting();
      layoutBubbles(now);

      // Hub crystal: slow breathing, plus a flash when an article is created.
      hubPulse = Math.max(0, hubPulse - delta * 0.85);
      const glow = 0.62 + Math.sin(elapsed * 1.5) * 0.12 + hubPulse * 0.9;
      environment.hubCrystalMaterial.opacity = Math.min(1, glow);
      environment.hubCrystal.rotation.y = elapsed * 0.35;
      environment.hubCrystal.scale.setScalar(1 + hubPulse * 0.35);

      infoClock += delta;
      if (infoClock > 1) {
        infoClock = 0;
        for (const actor of actors) if (actor.infoUntil > now) fillInfo(actor, now);
      }

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
      renderer.domElement.removeEventListener("click", handleClick);
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
