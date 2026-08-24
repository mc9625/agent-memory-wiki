"use client";

import React, { useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { Pane } from "tweakpane";
import { snoiseGLSL } from "../lib/webgl/shaders/curlNoise";

// --------------------------------------------------------
// TYPES & CHOREOGRAPHY DATA STRUCTURES
// --------------------------------------------------------

import type { SkyArticle, SkyEvent } from "./sky-canvas";

export type ProvenanceType = "full_telemetry" | "partial_telemetry" | "creation_only";

export interface SimAnchor {
  id: string;
  pos: THREE.Vector3;
  title: string;
  excerpt?: string;
  layoutPos: "upper-left" | "upper-right" | "lower-left" | "lower-right" | "lateral";
}

export interface PersistentAnchorState {
  articleId: string;
  structuralEnergy: number; // 0..1 residual field modulation
  revisionCount: number;
  depositStrength: number; // 0..1 permanent trace
  lastEncounteredAt?: number;
}

export interface AgentSession {
  sessionId: string;
  agentIdentifier: string;
  generation: number;
  startedAt: number;
  endedAt?: number;
  provenance: ProvenanceType;
  events: SkyEvent[];
}

export type CueType =
  | "arrival"
  | "encounter"
  | "traversal"
  | "creation"
  | "revision"
  | "departure"
  | "silence"
  | "historical_deposit";

export interface ChoreographyCue {
  id: string;
  type: CueType;
  duration: number; // seconds
  fromAnchor?: SimAnchor | undefined;
  toAnchor?: SimAnchor | undefined;
  targetAnchor?: SimAnchor | undefined;
  agentIdentifier?: string | undefined;
  generation?: number | undefined;
  timestamp?: string | undefined;
  controlPoints?: [THREE.Vector3, THREE.Vector3] | undefined;
  isContinuation?: boolean;
}

export interface CurrentInteractionState {
  activeSessionId?: string | undefined;
  agentIdentifier?: string | undefined;
  generation?: number | undefined;
  timestamp?: string | undefined;
  phase: CueType;
  progress: number; // 0..1
  agentPosition: THREE.Vector3;
  fromAnchor?: SimAnchor | undefined;
  toAnchor?: SimAnchor | undefined;
  targetAnchor?: SimAnchor | undefined;
  controlPoints?: [THREE.Vector3, THREE.Vector3] | undefined;
  isContinuation?: boolean;
}

export interface SampledVisualState {
  agentEnergy: number;
  agentRadius: number;
  activeAnchorPos: THREE.Vector3;
  activeAnchorVortex: number;
  activeAnchorPull: number;
  localTurbulence: number;
  condensation: number;
  globalEnergy: number;
  typographyPresences: Map<string, { opacity: number; scale: number; isCurrent: boolean }>;
  registerOpacity: number;
  registerText: string;
}

// --------------------------------------------------------
// SHADERS
// --------------------------------------------------------

const positionShader = `
uniform float delta;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 tmpPos = texture2D(texturePosition, uv);
  vec4 tmpVel = texture2D(textureVelocity, uv);

  vec3 pos = tmpPos.xyz;
  vec3 vel = tmpVel.xyz;
  float life = tmpPos.w;

  pos += vel * delta;
  
  // Soft boundary safeguard far beyond the composition bounds
  if (length(pos) > 2200.0) {
      pos = pos * 0.85;
  }

  gl_FragColor = vec4(pos, life);
}
`;

const velocityShader = `
uniform float time;
uniform float delta;
uniform float globalEnergy;
uniform float flowStrength;

// Global Confinement Field (Ellipsoidal Equilibrium Shell)
uniform vec3 fieldCenter;
uniform vec3 fieldRadii;
uniform float innerRadius;
uniform float outerRadius;
uniform float falloff;
uniform float confinementStrength;
uniform float damping;
uniform float maxSpeed;

// Agent Disturbance Field
uniform vec3 agentPos;
uniform float agentEnergy;
uniform float agentRadius;

// Article Anchors & Local Excitation (swirl + turbulence, zero gravitational collapse)
uniform vec3 activeAnchorPos;
uniform float activeAnchorPull;
uniform float activeAnchorVortex;

${snoiseGLSL}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 tmpPos = texture2D(texturePosition, uv);
  vec4 tmpVel = texture2D(textureVelocity, uv);

  vec3 pos = tmpPos.xyz;
  vec3 vel = tmpVel.xyz;

  // 1. Multi-scale Fluid Curl Noise (Organic internal morphology with continuous drift)
  vec3 largeCurl = curlNoise(pos * 0.0028 + vec3(time * 0.04, time * 0.025, time * 0.03)) * 0.55;
  vec3 mediumCurl = curlNoise(pos * 0.0085 + vec3(-time * 0.05, time * 0.055, time * 0.02)) * 0.30;
  vec3 fineCurl = curlNoise(pos * 0.028 + vec3(time * 0.12, -time * 0.09, time * 0.06)) * 0.15;
  
  vec3 flow = (largeCurl + mediumCurl + fineCurl) * globalEnergy * flowStrength;

  // 2. Global Confinement Field (Ellipsoidal Equilibrium Shell)
  vec3 toCenter = fieldCenter - pos;
  float distToCenter = length(toCenter);
  vec3 outwardDir = distToCenter > 0.001 ? -normalize(toCenter) : vec3(1.0, 0.0, 0.0);
  
  vec3 normalizedPos = (pos - fieldCenter) / fieldRadii;
  float d = length(normalizedPos);

  // Equilibrium shell: outward push in core (d < 0.70) and inward return at perimeter (d > 0.95)
  float radialForce = 0.0;
  if (d < 0.70) {
    radialForce = smoothstep(0.70, 0.0, d) * (confinementStrength * 1.5);
  } else if (d > 0.95) {
    radialForce = -smoothstep(0.95, 0.95 + falloff, d) * confinementStrength;
  }
  // Pushes along outwardDir: positive = outward, negative = inward
  flow += outwardDir * radialForce;

  // 3. Agent Disturbance Field (divergence-free fluid wake)
  vec3 toAgent = agentPos - pos;
  float distToAgent = length(toAgent);
  if (distToAgent < agentRadius && agentEnergy > 0.001) {
     float influence = smoothstep(agentRadius, 0.0, distToAgent);
     vec3 agentTurbulence = curlNoise(pos * 0.04 + time * 0.8 + agentPos * 0.01);
     flow += agentTurbulence * influence * agentEnergy * 140.0;
  }

  // 4. Active Anchor (Localized fluid eddy, gentle organic curl)
  vec3 toActive = activeAnchorPos - pos;
  float distToActive = length(toActive);
  if (distToActive < 220.0 && (activeAnchorPull > 0.001 || activeAnchorVortex > 0.001)) {
      float influence = smoothstep(220.0, 0.0, distToActive);
      // Divergence-free rotational eddy around anchor (curl noise ring)
      vec3 anchorTurbulence = curlNoise(pos * 0.02 + time * 0.25 + activeAnchorPos * 0.05);
      flow += anchorTurbulence * influence * (activeAnchorPull + activeAnchorVortex) * 55.0;
  }

  // Velocity integration
  vel += flow * delta;

  // 5. Frame-rate-independent exponential damping
  vel *= exp(-damping * delta);

  // 6. Soft velocity ceiling (smooth speed limiter)
  float speed = length(vel);
  if (speed > maxSpeed) {
      float correction = maxSpeed / speed;
      vel *= mix(1.0, correction, 0.35);
  }

  gl_FragColor = vec4(vel, 1.0);
}
`;

const particleVertexShader = `
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float cameraZ;

varying vec3 vColor;
varying float vAlpha;

attribute vec2 reference;

void main() {
  vec4 texPos = texture2D(texturePosition, reference);
  vec4 texVel = texture2D(textureVelocity, reference);
  
  vec3 pos = texPos.xyz;
  vec3 vel = texVel.xyz;
  
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Particle size depends purely on camera depth - fine, consistent, ethereal dust
  gl_PointSize = (1000.0 / -mvPosition.z) * 2.2;
  
  // Speed-based brightness - natural physical response when moving faster
  float speed = length(vel);
  vAlpha = smoothstep(0.0, 90.0, speed) * 0.40 + 0.35;
  
  // Depth attenuation
  float depthDist = abs(mvPosition.z);
  vAlpha *= smoothstep(1200.0, 100.0, depthDist) * 0.7 + 0.3;
  
  vColor = vec3(1.0, 1.0, 1.0);
}
`;

const particleFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = distance(gl_PointCoord, vec2(0.5));
  if (d > 0.5) discard;
  
  float alpha = smoothstep(0.5, 0.1, d) * vAlpha;
  gl_FragColor = vec4(vColor, alpha);
}
`;

const trailsVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const trailsFragmentShader = `
uniform sampler2D tCurrent;
uniform sampler2D tPrevious;
uniform float decay;
varying vec2 vUv;

void main() {
    vec4 current = texture2D(tCurrent, vUv);
    vec4 previous = texture2D(tPrevious, vUv);
    vec3 color = current.rgb + previous.rgb * decay;
    gl_FragColor = vec4(color, 1.0);
}
`;

// --------------------------------------------------------
// HELPER FUNCTIONS & CHOREOGRAPHY BUILDER
// --------------------------------------------------------

function seededRandom(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  const t = h + 0x6D2B79F5;
  h = Math.imul(t ^ t >>> 15, t | 1);
  h ^= h + Math.imul(h ^ h >>> 7, h | 61);
  return ((h ^ h >>> 14) >>> 0) / 4294967296;
}

function evaluateCubicBezier(
  p0: THREE.Vector3,
  c1: THREE.Vector3,
  c2: THREE.Vector3,
  p1: THREE.Vector3,
  t: number
): THREE.Vector3 {
  const inv = 1 - t;
  const inv2 = inv * inv;
  const inv3 = inv2 * inv;
  const t2 = t * t;
  const t3 = t2 * t;

  return new THREE.Vector3(
    inv3 * p0.x + 3 * inv2 * t * c1.x + 3 * inv * t2 * c2.x + t3 * p1.x,
    inv3 * p0.y + 3 * inv2 * t * c1.y + 3 * inv * t2 * c2.y + t3 * p1.y,
    inv3 * p0.z + 3 * inv2 * t * c1.z + 3 * inv * t2 * c2.z + t3 * p1.z
  );
}

function buildSessionsAndCues(
  articles: readonly SkyArticle[],
  events: readonly SkyEvent[],
  anchors: SimAnchor[]
): { sessions: AgentSession[]; cues: ChoreographyCue[] } {
  const anchorMap = new Map<string, SimAnchor>(anchors.map(a => [a.id, a]));
  
  // 1. Group events by sessionId
  const sessionMap = new Map<string, SkyEvent[]>();
  for (const ev of events) {
    if (ev.sessionId && ev.sessionId.trim().length > 0) {
      const list = sessionMap.get(ev.sessionId) || [];
      list.push(ev);
      sessionMap.set(ev.sessionId, list);
    }
  }

  const sessions: AgentSession[] = [];
  for (const [sId, sEvents] of sessionMap.entries()) {
    sEvents.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const firstEv = sEvents[0]!;
    const lastEv = sEvents[sEvents.length - 1]!;
    const startedAt = new Date(firstEv.createdAt).getTime();
    const endedAt = new Date(lastEv.createdAt).getTime();
    
    const hasStart = sEvents.some(e => e.eventType === "agent_session_started");
    const hasNav = sEvents.some(e => e.eventType === "article_opened" || e.eventType === "wikilink_followed");
    const provenance: ProvenanceType = hasStart && hasNav ? "full_telemetry" : (hasStart || hasNav ? "partial_telemetry" : "creation_only");

    sessions.push({
      sessionId: sId,
      agentIdentifier: firstEv.agentIdentifier || "Agent",
      generation: firstEv.generation || 1,
      startedAt,
      endedAt,
      provenance,
      events: sEvents,
    });
  }

  sessions.sort((a, b) => a.startedAt - b.startedAt);

  const cues: ChoreographyCue[] = [];

  const makeControlPoints = (fromPos: THREE.Vector3, toPos: THREE.Vector3): [THREE.Vector3, THREE.Vector3] => {
    const diff = new THREE.Vector3().subVectors(toPos, fromPos);
    const dist = diff.length();
    const dir = diff.clone().normalize();
    const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0.2)).normalize();
    const curveSign = ((fromPos.x + toPos.y) % 2 > 0) ? 1 : -1;
    const c1 = fromPos.clone().addScaledVector(diff, 0.33).addScaledVector(perp, dist * 0.25 * curveSign);
    const c2 = fromPos.clone().addScaledVector(diff, 0.66).addScaledVector(perp, dist * 0.18 * curveSign);
    return [c1, c2];
  };

  // Historical articles without telemetry
  for (const article of articles) {
    const inSession = sessions.some(s => s.events.some(e => e.articleId === article.id));
    if (!inSession) {
      const anchor = anchorMap.get(article.id);
      if (anchor) {
        cues.push({
          id: `hist-${article.id}`,
          type: "historical_deposit",
          duration: 4.5,
          targetAnchor: anchor,
          timestamp: article.created_at,
        });
      }
    }
  }



  // Build cues from sessions
  for (let sIdx = 0; sIdx < sessions.length; sIdx++) {
    const session = sessions[sIdx]!;
    const { agentIdentifier, generation, events: sEventsRaw } = session;

    const sEvents: SkyEvent[] = [];
    for (const ev of sEventsRaw) {
      const prev = sEvents[sEvents.length - 1];
      if (prev && prev.eventType === ev.eventType && prev.articleId === ev.articleId) {
        continue;
      }
      sEvents.push(ev);
    }

    if (session.provenance === "creation_only" && sEvents.length === 1 && sEvents[0]!.eventType === "article_created") {
      const ev = sEvents[0]!;
      const anchor = ev.articleId ? anchorMap.get(ev.articleId) : undefined;
      if (anchor) {
        cues.push({
          id: `dep-${session.sessionId}`,
          type: "historical_deposit",
          duration: 6.0,
          targetAnchor: anchor,
          agentIdentifier,
          generation,
          timestamp: ev.createdAt,
        });
      }
      continue;
    }

    const anchorEvents = sEvents.filter(e => e.articleId && anchorMap.has(e.articleId));
    const firstAnchor = anchorEvents[0]?.articleId ? anchorMap.get(anchorEvents[0].articleId!) : undefined;

    // Arrival cue
    cues.push({
      id: `arr-${session.sessionId}`,
      type: "arrival",
      duration: 3.5,
      targetAnchor: firstAnchor,
      agentIdentifier,
      generation,
      timestamp: sEvents[0]?.createdAt,
    });

    let currentAnchor: SimAnchor | undefined = undefined;

    for (let i = 0; i < sEvents.length; i++) {
      const ev = sEvents[i]!;
      const target = ev.articleId ? anchorMap.get(ev.articleId) : undefined;
      if (!target) continue;

      if (ev.eventType === "article_opened" || ev.eventType === "wikilink_followed") {
        let isCont = false;
        if (currentAnchor && currentAnchor.id !== target.id) {
          const [c1, c2] = makeControlPoints(currentAnchor.pos, target.pos);
          cues.push({
            id: `trav-${session.sessionId}-${i}`,
            type: "traversal",
            duration: 4.5,
            fromAnchor: currentAnchor,
            toAnchor: target,
            controlPoints: [c1, c2],
            agentIdentifier,
            generation,
            timestamp: ev.createdAt,
          });
        } else if (currentAnchor && currentAnchor.id === target.id) {
          isCont = true;
        }
        cues.push({
          id: `enc-${session.sessionId}-${i}`,
          type: "encounter",
          duration: 7.5,
          targetAnchor: target,
          agentIdentifier,
          generation,
          timestamp: ev.createdAt,
          isContinuation: isCont,
        });
        currentAnchor = target;
      } else if (ev.eventType === "article_created") {
        let isCont = false;
        if (currentAnchor && currentAnchor.id !== target.id) {
          const [c1, c2] = makeControlPoints(currentAnchor.pos, target.pos);
          cues.push({
            id: `trav-${session.sessionId}-${i}`,
            type: "traversal",
            duration: 4.0,
            fromAnchor: currentAnchor,
            toAnchor: target,
            controlPoints: [c1, c2],
            agentIdentifier,
            generation,
            timestamp: ev.createdAt,
          });
        } else if (currentAnchor && currentAnchor.id === target.id) {
          isCont = true;
        }
        cues.push({
          id: `creat-${session.sessionId}-${i}`,
          type: "creation",
          duration: 8.5,
          targetAnchor: target,
          agentIdentifier,
          generation,
          timestamp: ev.createdAt,
          isContinuation: isCont,
        });
        currentAnchor = target;
      } else if (ev.eventType === "article_revised") {
        let isCont = false;
        if (currentAnchor && currentAnchor.id !== target.id) {
          const [c1, c2] = makeControlPoints(currentAnchor.pos, target.pos);
          cues.push({
            id: `trav-${session.sessionId}-${i}`,
            type: "traversal",
            duration: 4.0,
            fromAnchor: currentAnchor,
            toAnchor: target,
            controlPoints: [c1, c2],
            agentIdentifier,
            generation,
            timestamp: ev.createdAt,
          });
        } else if (currentAnchor && currentAnchor.id === target.id) {
          isCont = true;
        }
        cues.push({
          id: `rev-${session.sessionId}-${i}`,
          type: "revision",
          duration: 7.0,
          targetAnchor: target,
          agentIdentifier,
          generation,
          timestamp: ev.createdAt,
          isContinuation: isCont,
        });
        currentAnchor = target;
      }
    }

    // Departure cue
    cues.push({
      id: `dep-${session.sessionId}`,
      type: "departure",
      duration: 4.0,
      fromAnchor: currentAnchor,
      agentIdentifier,
      generation,
      timestamp: sEvents[sEvents.length - 1]?.createdAt,
    });

    // Inter-session Silence cue
    cues.push({
      id: `silence-${session.sessionId}`,
      type: "silence",
      duration: 4.5,
      timestamp: sEvents[sEvents.length - 1]?.createdAt,
    });
  }

  return { sessions, cues };
}

function sampleVisualState(
  interaction: CurrentInteractionState,
  baseParams: { globalEnergy: number }
): SampledVisualState {
  const { phase, progress } = interaction;
  const typographyPresences = new Map<string, { opacity: number; scale: number; isCurrent: boolean }>();

  let agentEnergy: number;
  const agentRadius = 180.0;
  const activeAnchorPos = new THREE.Vector3(0, 0, 0);
  let activeAnchorVortex = 0.0;
  const activeAnchorPull = 0.0;
  let localTurbulence = 0.0;
  let condensation = 0.0;
  let globalEnergy: number;
  let registerOpacity: number;

  // Format Register Text
  const agentName = interaction.agentIdentifier ? interaction.agentIdentifier.toUpperCase() : "AGENT 028";
  const genNumber = interaction.generation !== undefined ? `GEN 00${interaction.generation}`.slice(-7) : "GEN 028";
  let dateString = "24 AUG 2026";
  if (interaction.timestamp) {
    const d = new Date(interaction.timestamp);
    if (!isNaN(d.getTime())) {
      dateString = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
    }
  }
  const registerText = `${agentName}\n\n${genNumber}\n${dateString}`;

  switch (phase) {
    case "arrival": {
      agentEnergy = Math.min(1.0, progress * 1.5);
      registerOpacity = THREE.MathUtils.smoothstep(progress, 0.1, 0.7) * 0.75;
      globalEnergy = THREE.MathUtils.lerp(baseParams.globalEnergy, 0.45, progress);
      if (interaction.targetAnchor) {
        activeAnchorPos.copy(interaction.targetAnchor.pos);
      }
      break;
    }

    case "encounter": {
      agentEnergy = 1.0;
      registerOpacity = 0.75;
      globalEnergy = 0.42;
      const target = interaction.targetAnchor;

      if (target) {
        activeAnchorPos.copy(target.pos);
        // Gentle organic excitation: peaks at 0.40, softly eases to 0.25 for quiet reading
        const easeDecay = 1.0 - THREE.MathUtils.smoothstep(progress, 0.70, 1.0) * 0.45;
        localTurbulence = THREE.MathUtils.smoothstep(progress, 0.0, 0.35) * 0.45 * easeDecay;
        activeAnchorVortex = THREE.MathUtils.smoothstep(progress, 0.05, 0.40) * 0.40 * easeDecay;

        // Typography emergence:
        // 0.0 -> 0.35: invisible (only subtle physical flow)
        // 0.35 -> 0.65: smooth fade in (0.0 -> 0.95)
        // 0.65 -> 1.0: STAYS completely visible and legible (0.95)
        const textOpacity = interaction.isContinuation ? 0.95 : THREE.MathUtils.smoothstep(progress, 0.35, 0.65) * 0.95;

        typographyPresences.set(target.id, {
          opacity: textOpacity,
          scale: 1.0,
          isCurrent: true,
        });
      }
      break;
    }

    case "traversal": {
      agentEnergy = 1.0;
      registerOpacity = 0.75;
      globalEnergy = 0.45;
      localTurbulence = 0.4;

      activeAnchorPos.copy(interaction.agentPosition);

      // Traversal from A -> B:
      // A fades from 0.95 -> 0.15 during progress 0.0 -> 0.50
      if (interaction.fromAnchor) {
        const aFade = 1.0 - THREE.MathUtils.smoothstep(progress, 0.0, 0.50);
        const aOpacity = 0.15 + 0.80 * aFade;
        typographyPresences.set(interaction.fromAnchor.id, {
          opacity: aOpacity,
          scale: 0.98,
          isCurrent: false,
        });
      }

      // B begins physical excitation only when approaching (progress > 0.75)
      if (interaction.toAnchor && progress > 0.75) {
        activeAnchorVortex = THREE.MathUtils.smoothstep(progress, 0.75, 1.0) * 0.35;
      }
      break;
    }

    case "creation": {
      agentEnergy = 1.1;
      registerOpacity = 0.75;
      globalEnergy = 0.48;
      const target = interaction.targetAnchor;

      if (target) {
        activeAnchorPos.copy(target.pos);
        // Phase 1: gentle swirl and condensation in field (0.0 -> 0.50), relaxes softly (0.75 -> 1.0) to 0.25
        const easeDecay = 1.0 - THREE.MathUtils.smoothstep(progress, 0.75, 1.0) * 0.45;
        condensation = THREE.MathUtils.smoothstep(progress, 0.0, 0.45) * 0.35 * easeDecay;
        activeAnchorVortex = THREE.MathUtils.smoothstep(progress, 0.10, 0.50) * 0.45 * easeDecay;
        localTurbulence = THREE.MathUtils.smoothstep(progress, 0.15, 0.55) * 0.35 * easeDecay;

        // Phase 2: late text crystallisation (0.50 -> 0.75) and stays fully visible until cue ends
        const crystallisation = interaction.isContinuation ? 0.95 : THREE.MathUtils.smoothstep(progress, 0.50, 0.75) * 0.95;
        typographyPresences.set(target.id, {
          opacity: crystallisation,
          scale: 1.0,
          isCurrent: true,
        });
      }
      break;
    }

    case "revision": {
      agentEnergy = 1.1;
      registerOpacity = 0.75;
      globalEnergy = 0.46;
      const target = interaction.targetAnchor;

      if (target) {
        activeAnchorPos.copy(target.pos);
        const easeDecay = 1.0 - THREE.MathUtils.smoothstep(progress, 0.70, 1.0) * 0.45;
        localTurbulence = THREE.MathUtils.smoothstep(progress, 0.0, 0.4) * 0.45 * easeDecay;
        activeAnchorVortex = THREE.MathUtils.smoothstep(progress, 0.1, 0.5) * 0.40 * easeDecay;

        const pulse = interaction.isContinuation ? 0.95 : Math.min(0.95, THREE.MathUtils.smoothstep(progress, 0.3, 0.6) * 0.95);
        typographyPresences.set(target.id, {
          opacity: pulse,
          scale: 1.0,
          isCurrent: true,
        });
      }
      break;
    }

    case "departure": {
      agentEnergy = 1.0 - THREE.MathUtils.smoothstep(progress, 0.0, 0.9);
      registerOpacity = (1.0 - THREE.MathUtils.smoothstep(progress, 0.3, 0.95)) * 0.75;
      globalEnergy = THREE.MathUtils.lerp(0.45, baseParams.globalEnergy, progress);

      // Active anchor and physical swirl smoothly decay into the cloud
      if (interaction.fromAnchor) {
        activeAnchorPos.copy(interaction.fromAnchor.pos);
        const settle = 1.0 - THREE.MathUtils.smoothstep(progress, 0.0, 0.85);
        activeAnchorVortex = settle * 0.25;
        localTurbulence = settle * 0.20;

        typographyPresences.set(interaction.fromAnchor.id, {
          opacity: settle * 0.95,
          scale: 0.98,
          isCurrent: false,
        });
      }
      break;
    }

    case "historical_deposit": {
      agentEnergy = 0.0;
      registerOpacity = 0.0;
      globalEnergy = 0.38;
      const target = interaction.targetAnchor;
      if (target) {
        activeAnchorPos.copy(target.pos);
        localTurbulence = THREE.MathUtils.smoothstep(progress, 0.0, 0.4) * (1.0 - THREE.MathUtils.smoothstep(progress, 0.7, 1.0));
        // Soft deposit appearance: emerges 0.2 -> 0.5, stays legible 0.5 -> 0.85, gently settles 0.85 -> 1.0
        let depositFade = THREE.MathUtils.smoothstep(progress, 0.2, 0.5);
        if (progress > 0.85) {
          depositFade *= (1.0 - THREE.MathUtils.smoothstep(progress, 0.85, 1.0));
        }
        typographyPresences.set(target.id, {
          opacity: depositFade * 0.80,
          scale: 0.98,
          isCurrent: true,
        });
      }
      break;
    }

    case "silence":
    default: {
      agentEnergy = 0.0;
      registerOpacity = 0.0;
      globalEnergy = baseParams.globalEnergy;
      break;
    }
  }

  return {
    agentEnergy,
    agentRadius,
    activeAnchorPos,
    activeAnchorVortex,
    activeAnchorPull,
    localTurbulence,
    condensation,
    globalEnergy,
    typographyPresences,
    registerOpacity,
    registerText,
  };
}

// --------------------------------------------------------
// MAIN GENERATIVE SKY COMPONENT
// --------------------------------------------------------

interface GenerativeSkyProps {
  initialArticles?: readonly SkyArticle[];
  initialEvents?: readonly SkyEvent[];
}

export function GenerativeSky({ initialArticles = [], initialEvents = [] }: GenerativeSkyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const domRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<SimAnchor[]>([]);
  const uiLayerRef = useRef<HTMLDivElement>(null);

  // Setup anchors from initialArticles situated inside active particle cloud
  useMemo(() => {
    anchorsRef.current = initialArticles.map((article) => {
      // Deterministic seeded spherical distribution inside active particle cloud
      const u = seededRandom(article.id + "u");
      const v = seededRandom(article.id + "v");
      const rSeed = seededRandom(article.id + "r");

      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      // Situate inside the core dense region (0.30 to 0.70 of field radii)
      const r = 0.30 + rSeed * 0.40;
      const sinPhi = Math.sin(phi);

      const posX = r * sinPhi * Math.cos(theta) * 550.0;
      const posY = r * sinPhi * Math.sin(theta) * 290.0;
      const posZ = r * Math.cos(phi) * 240.0;

      return {
        id: article.id,
        pos: new THREE.Vector3(posX, posY, posZ),
        title: article.title,
        excerpt: article.slug,
        layoutPos: "lateral",
      };
    });
  }, [initialArticles]);

  const cuesRef = useRef<ChoreographyCue[]>([]);
  useMemo(() => {
    const { cues } = buildSessionsAndCues(initialArticles, initialEvents, anchorsRef.current);
    cuesRef.current = cues;
  }, [initialArticles, initialEvents]);

  useEffect(() => {
    if (!containerRef.current || !uiLayerRef.current) return;
    const container = containerRef.current;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 1.5);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(dpr);
    container.appendChild(renderer.domElement);

    const PARAMS = {
      globalEnergy: 0.40,
      flowStrength: 110.0,
      confinementStrength: 25.0,
      innerRadius: 0.60,
      outerRadius: 0.95,
      falloff: 0.30,
      damping: 3.0,
      maxSpeed: 140.0,
      agentEnergyMultiplier: 1.2,
      agentRadius: 180.0,
      decayPerSecond: 0.046,
      timeScale: 1.0,
      manualTimeline: false,
      seqTimeOverride: 0
    };

    let pane: unknown = null;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("debug") === "1") {
     pane = new Pane({ title: "Simulation Parameters" }) as unknown;
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (pane as any).addBinding(PARAMS, "globalEnergy", { min: 0.0, max: 1.0, step: 0.01 });
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (pane as any).addBinding(PARAMS, "flowStrength", { min: 10.0, max: 200.0, step: 1.0 });
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (pane as any).addBinding(PARAMS, "confinementStrength", { min: 0.0, max: 80.0, step: 1.0 });
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (pane as any).addBinding(PARAMS, "innerRadius", { min: 0.05, max: 0.70, step: 0.01 });
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (pane as any).addBinding(PARAMS, "outerRadius", { min: 0.50, max: 1.40, step: 0.01 });
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (pane as any).addBinding(PARAMS, "damping", { min: 0.5, max: 8.0, step: 0.1 });
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (pane as any).addBinding(PARAMS, "maxSpeed", { min: 40.0, max: 400.0, step: 5.0 });
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (pane as any).addBinding(PARAMS, "agentRadius", { min: 50, max: 500, step: 10 });
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 2000);
    camera.position.z = 800;

    // 1. Setup GPGPU
    const particleRes = 316; // 100k particles
    const gpuCompute = new GPUComputationRenderer(particleRes, particleRes, renderer);

    if (renderer.capabilities.isWebGL2) {
      gpuCompute.setDataType(THREE.HalfFloatType);
    } else {
      gpuCompute.setDataType(THREE.FloatType);
    }

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();

    const posArray = dtPosition.image.data as Float32Array;
    const velArray = dtVelocity.image.data as Float32Array;
    // Initial particle distribution inside the 16:9 ellipsoidal volume
    for (let k = 0, kl = posArray.length; k < kl; k += 4) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = Math.cbrt(Math.random()) * 0.85;
      const sinPhi = Math.sin(phi);

      posArray[k + 0] = r * sinPhi * Math.cos(theta) * 700;
      posArray[k + 1] = r * sinPhi * Math.sin(theta) * 380;
      posArray[k + 2] = r * Math.cos(phi) * 420;
      posArray[k + 3] = Math.random();

      velArray[k + 0] = (Math.random() - 0.5) * 2;
      velArray[k + 1] = (Math.random() - 0.5) * 2;
      velArray[k + 2] = (Math.random() - 0.5) * 2;
      velArray[k + 3] = 1;
    }

    const posVariable = gpuCompute.addVariable("texturePosition", positionShader, dtPosition);
    const velVariable = gpuCompute.addVariable("textureVelocity", velocityShader, dtVelocity);
    gpuCompute.setVariableDependencies(posVariable, [posVariable, velVariable]);
    gpuCompute.setVariableDependencies(velVariable, [posVariable, velVariable]);

    const posUniforms = posVariable.material.uniforms;
    const velUniforms = velVariable.material.uniforms;

    posUniforms["delta"] = { value: 0.0 };
    velUniforms["time"] = { value: 0.0 };
    velUniforms["delta"] = { value: 0.0 };
    velUniforms["globalEnergy"] = { value: PARAMS.globalEnergy };
    velUniforms["flowStrength"] = { value: PARAMS.flowStrength };
    velUniforms["fieldCenter"] = { value: new THREE.Vector3(0, 0, 0) };
    velUniforms["fieldRadii"] = { value: new THREE.Vector3(700.0, 380.0, 420.0) };
    velUniforms["innerRadius"] = { value: PARAMS.innerRadius };
    velUniforms["outerRadius"] = { value: PARAMS.outerRadius };
    velUniforms["falloff"] = { value: PARAMS.falloff };
    velUniforms["confinementStrength"] = { value: PARAMS.confinementStrength };
    velUniforms["damping"] = { value: PARAMS.damping };
    velUniforms["maxSpeed"] = { value: PARAMS.maxSpeed };
    velUniforms["agentPos"] = { value: new THREE.Vector3(0, 0, 0) };
    velUniforms["agentEnergy"] = { value: 0.0 };
    velUniforms["agentRadius"] = { value: PARAMS.agentRadius };
    velUniforms["activeAnchorPos"] = { value: new THREE.Vector3(0, 0, 0) };
    velUniforms["activeAnchorPull"] = { value: 0.0 };
    velUniforms["activeAnchorVortex"] = { value: 0.0 };

    gpuCompute.init();

    // 2. Setup Particles
    const geometry = new THREE.BufferGeometry();
    const uvs = new Float32Array(particleRes * particleRes * 2);
    const positions = new Float32Array(particleRes * particleRes * 3);
    let p = 0;
    for (let j = 0; j < particleRes; j++) {
      for (let i = 0; i < particleRes; i++) {
        uvs[p++] = i / (particleRes - 1);
        uvs[p++] = j / (particleRes - 1);
      }
    }
    geometry.setAttribute("reference", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        texturePosition: { value: null },
        textureVelocity: { value: null },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(geometry, particleMaterial);
    particles.frustumCulled = false;
    scene.add(particles);

    // 3. Setup Trails
    const rtCurrent = new THREE.WebGLRenderTarget(width * dpr, height * dpr, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const rtPrevious = rtCurrent.clone();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadScene = new THREE.Scene();
    const trailMaterial = new THREE.ShaderMaterial({
      uniforms: { tCurrent: { value: null }, tPrevious: { value: null }, decay: { value: 0.96 } },
      vertexShader: trailsVertexShader,
      fragmentShader: trailsFragmentShader,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), trailMaterial);
    quadScene.add(quad);

    // 4. State & Choreography Engine
    const clock = new THREE.Clock();

    let cueIndex = 0;
    let cueTimeElapsed = 0.0;
    const currentAgentPos = new THREE.Vector3(0, 0, 800);

    const tempVec3 = new THREE.Vector3();

    const animate = () => {
      const rawDelta = clock.getDelta();
      const delta = rawDelta * PARAMS.timeScale;
      const cues = cuesRef.current;

      // 4.1 Advance Choreography Sequencer smoothly (without single-frame index desync)
      if (cueIndex < cues.length) {
        cueTimeElapsed += delta;
        while (cueIndex < cues.length && cueTimeElapsed >= (cues[cueIndex]?.duration || 1.0)) {
          cueTimeElapsed -= cues[cueIndex]!.duration;
          cueIndex++;
        }
      }

      let currentCue: ChoreographyCue | undefined = cues[cueIndex];
      let cueProgress: number;

      if (currentCue) {
        cueProgress = Math.min(1.0, cueTimeElapsed / Math.max(0.1, currentCue.duration));

        // Advance agent position along trajectory if in traversal or arrival
        if (currentCue.type === "traversal" && currentCue.fromAnchor && currentCue.toAnchor && currentCue.controlPoints) {
          const [c1, c2] = currentCue.controlPoints;
          const pos = evaluateCubicBezier(currentCue.fromAnchor.pos, c1, c2, currentCue.toAnchor.pos, cueProgress);
          currentAgentPos.copy(pos);
        } else if (currentCue.type === "arrival" && currentCue.targetAnchor) {
          currentAgentPos.lerpVectors(new THREE.Vector3(0, 0, 600), currentCue.targetAnchor.pos, cueProgress);
        } else if (currentCue.targetAnchor) {
          currentAgentPos.copy(currentCue.targetAnchor.pos);
        }
      } else {
        // Reached the present / live latent state
        currentCue = {
          id: "latent-present",
          type: "silence",
          duration: 10.0,
        };
        cueProgress = 1.0;
      }

      // 4.2 Sample Visual & Interaction State
      const interaction: CurrentInteractionState = {
        activeSessionId: currentCue.id,
        agentIdentifier: currentCue.agentIdentifier,
        generation: currentCue.generation,
        timestamp: currentCue.timestamp,
        phase: currentCue.type,
        progress: cueProgress,
        agentPosition: currentAgentPos,
        fromAnchor: currentCue.fromAnchor,
        toAnchor: currentCue.toAnchor,
        targetAnchor: currentCue.targetAnchor,
        controlPoints: currentCue.controlPoints,
        isContinuation: currentCue.isContinuation ?? false,
      };

      const sampled = sampleVisualState(interaction, PARAMS);

      // 4.3 Update GPGPU Uniforms
      const vMat = velVariable.material.uniforms;
      vMat["globalEnergy"]!.value = sampled.globalEnergy;
      vMat["flowStrength"]!.value = PARAMS.flowStrength;
      vMat["confinementStrength"]!.value = PARAMS.confinementStrength;
      vMat["innerRadius"]!.value = PARAMS.innerRadius;
      vMat["outerRadius"]!.value = PARAMS.outerRadius;
      vMat["falloff"]!.value = PARAMS.falloff;
      vMat["damping"]!.value = PARAMS.damping;
      vMat["maxSpeed"]!.value = PARAMS.maxSpeed;
      vMat["agentRadius"]!.value = sampled.agentRadius;
      vMat["agentEnergy"]!.value = sampled.agentEnergy;

      (vMat["agentPos"]!.value as THREE.Vector3).copy(currentAgentPos);
      (vMat["activeAnchorPos"]!.value as THREE.Vector3).copy(sampled.activeAnchorPos);
      vMat["activeAnchorPull"]!.value = sampled.activeAnchorPull;
      vMat["activeAnchorVortex"]!.value = sampled.activeAnchorVortex;

      posVariable.material.uniforms["delta"]!.value = delta;
      vMat["delta"]!.value = delta;
      vMat["time"]!.value = clock.getElapsedTime() * PARAMS.timeScale;

      gpuCompute.compute();

      particleMaterial.uniforms["texturePosition"]!.value = gpuCompute.getCurrentRenderTarget(posVariable).texture;
      particleMaterial.uniforms["textureVelocity"]!.value = gpuCompute.getCurrentRenderTarget(velVariable).texture;

      // 4.4 Render Trails & Scene
      renderer.setRenderTarget(rtCurrent);
      renderer.clear();
      renderer.render(scene, camera);

      renderer.setRenderTarget(null);
      trailMaterial.uniforms["decay"]!.value = Math.pow(PARAMS.decayPerSecond, rawDelta);
      trailMaterial.uniforms["tCurrent"]!.value = rtCurrent.texture;
      trailMaterial.uniforms["tPrevious"]!.value = rtPrevious.texture;
      renderer.render(quadScene, quadCamera);

      renderer.setRenderTarget(rtPrevious);
      renderer.render(quadScene, quadCamera);

      // 4.5 Update Typography & Floating Register in lockstep
      anchorsRef.current.forEach(anchor => {
        const el = domRefs.current.get(anchor.id);
        if (!el) return;

        const pres = sampled.typographyPresences.get(anchor.id);
        const opacity = pres ? pres.opacity : 0.0;

        tempVec3.copy(anchor.pos).project(camera);
        const x = (tempVec3.x * .5 + .5) * window.innerWidth;
        const y = (tempVec3.y * -.5 + .5) * window.innerHeight;

        if (opacity > 0.005) {
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
          el.style.opacity = opacity.toFixed(3);
        } else {
          el.style.opacity = "0";
        }
      });

      // Update Floating Typographic Register
      if (registerRef.current) {
        registerRef.current.innerText = sampled.registerText;
        registerRef.current.style.opacity = sampled.registerOpacity.toFixed(3);
      }

      requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      rtCurrent.setSize(w * dpr, h * dpr);
      rtPrevious.setSize(w * dpr, h * dpr);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      container.removeChild(renderer.domElement);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (pane) (pane as any).dispose();
      renderer.dispose();
      rtCurrent.dispose();
      rtPrevious.dispose();
    };
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#000", position: "absolute", zIndex: 1 }}
      />
      <div ref={uiLayerRef} className="sky-ui-layer">

        {/* Floating Typographic Register (No box, no panel, pure floating typography) */}
        <div
          ref={registerRef}
          style={{
            position: "absolute",
            top: "3.5rem",
            left: "3.5rem",
            color: "rgba(255, 255, 255, 0.9)",
            fontFamily: "var(--font-jetbrains-mono, monospace)",
            fontSize: "0.78rem",
            lineHeight: "1.6",
            letterSpacing: "0.14em",
            whiteSpace: "pre-line",
            pointerEvents: "none",
            zIndex: 10,
            opacity: 0,
            transition: "opacity 0.5s ease-out",
          }}
        />

        {/* Archive Register (DOM Nodes controlled by refs) */}
        {anchorsRef.current.map((anchor) => (
          <div
            key={anchor.id}
            ref={(el) => {
              if (el) domRefs.current.set(anchor.id, el);
            }}
            className="sky-anchor-label"
            style={{ opacity: 0 }}
          >
            <h2 className="sky-archive-title">{anchor.title}</h2>
          </div>
        ))}

      </div>
    </>
  );
}
