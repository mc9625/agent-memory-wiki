"use client";

import React, { useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { Pane } from "tweakpane";
import { snoiseGLSL } from "../lib/webgl/shaders/curlNoise";

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

  // 4. Active Anchor (Localized fluid eddy, ZERO gravitational sinkhole)
  vec3 toActive = activeAnchorPos - pos;
  float distToActive = length(toActive);
  if (distToActive < 220.0 && (activeAnchorPull > 0.001 || activeAnchorVortex > 0.001)) {
      float influence = smoothstep(220.0, 0.0, distToActive);
      // Divergence-free rotational eddy around anchor (curl noise ring)
      vec3 anchorTurbulence = curlNoise(pos * 0.02 + time * 0.3 + activeAnchorPos * 0.05);
      flow += anchorTurbulence * influence * (activeAnchorPull + activeAnchorVortex) * 90.0;
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

  // Particle size depends on depth - fine-tuned size
  gl_PointSize = (1000.0 / -mvPosition.z) * 2.5;
  
  // Speed-based brightness - keep them highly visible at all times
  float speed = length(vel);
  vAlpha = smoothstep(0.0, 100.0, speed) * 0.5 + 0.3;
  
  // Depth attenuation (distant particles are dimmer, but never disappear entirely)
  float depthDist = abs(mvPosition.z);
  vAlpha *= smoothstep(1200.0, 100.0, depthDist) * 0.8 + 0.2;
  
  vColor = vec3(1.0, 1.0, 1.0); // pure white light
}
`;

const particleFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
  // Soft circle
  float d = distance(gl_PointCoord, vec2(0.5));
  if (d > 0.5) discard;
  
  // Soft edge bloom
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
    
    // Additive mix with decay on previous frame
    vec3 color = current.rgb + previous.rgb * decay;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// --------------------------------------------------------
// TYPES & MOCKS
// --------------------------------------------------------

import type { SkyArticle, SkyEvent } from "./sky-canvas";

type SimAnchor = {
  id: string;
  pos: THREE.Vector3;
  title: string;
  excerpt?: string;
  energy: number; // 0 to 1 physical energy
  layoutPos: "upper-left" | "upper-right" | "lower-left" | "lower-right" | "lateral";
};

// Deterministic pseudo-random based on string seed
function seededRandom(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  const t = h + 0x6D2B79F5;
  h = Math.imul(t ^ t >>> 15, t | 1);
  h ^= h + Math.imul(h ^ h >>> 7, h | 61);
  return ((h ^ h >>> 14) >>> 0) / 4294967296;
}

// --------------------------------------------------------
// COMPONENT
// --------------------------------------------------------

interface GenerativeSkyProps {
  initialArticles?: readonly SkyArticle[];
  initialEvents?: readonly SkyEvent[];
}

export function GenerativeSky({ initialArticles = [], initialEvents = [] }: GenerativeSkyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const domRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const anchorsRef = useRef<SimAnchor[]>([]);
  const uiLayerRef = useRef<HTMLDivElement>(null);

  // Setup anchors from initialArticles
  useMemo(() => {
    anchorsRef.current = initialArticles.map((article) => {
      const r1 = seededRandom(article.id + "x") - 0.5;
      const r2 = seededRandom(article.id + "y") - 0.5;
      const r3 = seededRandom(article.id + "z") - 0.5;
      const r4 = seededRandom(article.id + "layout");

      const layoutLayouts: SimAnchor["layoutPos"][] = ["upper-left", "upper-right", "lower-left", "lower-right", "lateral"];
      const layoutPos = layoutLayouts[Math.floor(r4 * layoutLayouts.length)] || "lateral";

      return {
        id: article.id,
        // Distribute in a spherical volume
        pos: new THREE.Vector3(r1 * 1200, r2 * 800, r3 * 600),
        title: article.title,
        // We use the slug as the secondary excerpt since the list API does not return body_markdown
        excerpt: article.slug,
        energy: 0.0,
        layoutPos,
      };
    });
  }, [initialArticles]);

  const sortedEventsRef = useRef<SkyEvent[]>([]);
  useEffect(() => {
    sortedEventsRef.current = [...initialEvents].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [initialEvents]);

  useEffect(() => {
    if (!containerRef.current || !uiLayerRef.current) return;
    const container = containerRef.current;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 1.5); // Cap DPR

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
     (pane as any).addBinding(PARAMS, "innerRadius", { min: 0.05, max: 0.60, step: 0.01 });
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

    // Helper: Project 3D to 2D screen coords
    const tempVec3 = new THREE.Vector3();
    const updateTypography = () => {
      let excerptShown = false;

      anchorsRef.current.forEach(anchor => {
        const el = domRefs.current.get(anchor.id);
        if (!el) return;

        // Interpret continuous energy into typographic presence
        let visibility = 0;

        if (anchor.energy > 0) {
          visibility = Math.min(1.0, anchor.energy * 2.0);
        }

        if (anchor.energy > 0.85 && !excerptShown) {
          excerptShown = true;
        }


        // Project position
        tempVec3.copy(anchor.pos).project(camera);
        const x = (tempVec3.x * .5 + .5) * window.innerWidth;
        const y = (tempVec3.y * -.5 + .5) * window.innerHeight;

        // Offset based on preferred layout
        let offsetX = 0;
        let offsetY = 0;
        switch (anchor.layoutPos) {
          case "upper-right": offsetX = 20; offsetY = -40; break;
          case "lower-right": offsetX = 20; offsetY = 20; break;
          case "upper-left": offsetX = -300; offsetY = -40; break;
          case "lower-left": offsetX = -300; offsetY = 20; break;
          case "lateral": offsetX = 40; offsetY = 0; break;
        }

        // Clamp to screen bounds to prevent text from being cut off
        const safeX = Math.max(40, Math.min(window.innerWidth - 350, x + offsetX));
        const safeY = Math.max(40, Math.min(window.innerHeight - 100, y + offsetY));

        if (visibility > 0.01) {
          el.style.transform = `translate3d(${safeX}px, ${safeY}px, 0)`;
          el.style.opacity = visibility.toFixed(3);
        } else {
          el.style.opacity = "0";
        }
      });
    };

    // 4. Animation Loop & Event State Machine
    const clock = new THREE.Clock();

    // Engine State
    let targetEnergy = 0.1;
    let agentActive = 0.0;
    const agentPosTarget = new THREE.Vector3(0, 0, 0);
    let activePull = 0.0;
    let activeVortex = 0.0;
    const activeAnchorPosTarget = new THREE.Vector3(0, 0, 0);

    // Playback State
    let currentEventIndex = 0;
    let eventTimeAccumulator = 0;
    let idleTimeAccumulator = 0;
    let lastKnownEventsLength = 0;

    const animate = () => {
      const rawDelta = clock.getDelta();
      const delta = rawDelta * PARAMS.timeScale;
      
      const sortedEvents = sortedEventsRef.current;
      
      // Detect live incoming events
      if (sortedEvents.length > lastKnownEventsLength) {
         if (lastKnownEventsLength > 0 && currentEventIndex < lastKnownEventsLength) {
             // An agent entered while we were replaying old history! Jump to present.
             currentEventIndex = lastKnownEventsLength;
         }
         lastKnownEventsLength = sortedEvents.length;
      }

      // Event Engine Replay
      // We process events. A long gap is compressed.
      if (currentEventIndex < sortedEvents.length) {
        eventTimeAccumulator += delta;

        // Process one event every 2 seconds of simulation time (highly compressed for visual pace)
        // In a real live system, this would use the real timestamps or websocket events
        if (eventTimeAccumulator > 2.0) {
          eventTimeAccumulator = 0;
          const ev = sortedEvents[currentEventIndex];
          currentEventIndex++;

          if (ev && ev.articleId) {
            const targetAnchor = anchorsRef.current.find(a => a.id === ev.articleId);
            if (targetAnchor) {
              agentActive = 1.0;
              agentPosTarget.copy(targetAnchor.pos);

              if (ev.eventType === "article_created") {
                // Localized Condensation impulse (gentle local vortex + glow)
                targetEnergy = 0.55;
                activeAnchorPosTarget.copy(targetAnchor.pos);
                activePull = 0.45;
                activeVortex = 0.6;
                // Excite typography
                targetAnchor.energy = 0.95;
              } else if (ev.eventType === "article_opened" || ev.eventType === "article_revised") {
                // Traversal and Reading
                targetEnergy = 0.45;
                activeAnchorPosTarget.copy(targetAnchor.pos);
                activePull = 0.25;
                activeVortex = 0.4;
                targetAnchor.energy = Math.max(targetAnchor.energy, 0.8);
              }
            }
          } else if (ev && ev.eventType === "agent_session_started") {
            agentActive = 1.0;
            targetEnergy = 0.45;
            agentPosTarget.set(0, 0, 400);
          } else if (ev && ev.eventType === "agent_session_ended") {
            agentActive = 0.0;
            activePull = 0.0;
            activeVortex = 0.0;
          }
        }
      } else {
        // Reached the present. Enter an equilibrium latent state.
        idleTimeAccumulator += delta;
        
        // Wait 2 minutes (120 seconds of real simulation time).
        // If we exceed it, restart the replay to keep the system active!
        if (idleTimeAccumulator > 120.0) {
            currentEventIndex = 0;
            idleTimeAccumulator = 0;
        }
      }

      // Continuous frame-by-frame relaxation of event impulses towards homeostatic equilibrium
      activePull = THREE.MathUtils.lerp(activePull, 0.0, delta * 0.8);
      activeVortex = THREE.MathUtils.lerp(activeVortex, 0.0, delta * 0.8);
      agentActive = THREE.MathUtils.lerp(agentActive, 0.0, delta * 0.5);
      targetEnergy = THREE.MathUtils.lerp(targetEnergy, PARAMS.globalEnergy, delta * 0.5);

      // Decay typography energy over time to create residual traces
      anchorsRef.current.forEach(anchor => {
        if (anchor.energy > 0) {
          anchor.energy -= delta * 0.08; // Faster decay for smoother fadeout
          if (anchor.energy < 0) anchor.energy = 0;
        }
      });

      if (!PARAMS.manualTimeline) {
        PARAMS.globalEnergy = targetEnergy;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (pane) (pane as any).refresh();
      } else {
        targetEnergy = PARAMS.globalEnergy;
      }

      const vMat = velVariable.material.uniforms;
      vMat["globalEnergy"]!.value = THREE.MathUtils.lerp(vMat["globalEnergy"]!.value, targetEnergy, 0.05);
      vMat["flowStrength"]!.value = PARAMS.flowStrength;
      vMat["confinementStrength"]!.value = PARAMS.confinementStrength;
      vMat["innerRadius"]!.value = PARAMS.innerRadius;
      vMat["outerRadius"]!.value = PARAMS.outerRadius;
      vMat["falloff"]!.value = PARAMS.falloff;
      vMat["damping"]!.value = PARAMS.damping;
      vMat["maxSpeed"]!.value = PARAMS.maxSpeed;
      vMat["agentRadius"]!.value = PARAMS.agentRadius;
      vMat["agentEnergy"]!.value = THREE.MathUtils.lerp(vMat["agentEnergy"]!.value, agentActive * PARAMS.agentEnergyMultiplier, 0.05);

      const currentActiveAnchorPos = vMat["activeAnchorPos"]!.value as THREE.Vector3;
      currentActiveAnchorPos.lerp(activeAnchorPosTarget, 0.05);

      vMat["activeAnchorPull"]!.value = THREE.MathUtils.lerp(vMat["activeAnchorPull"]!.value, activePull, 0.05);
      vMat["activeAnchorVortex"]!.value = THREE.MathUtils.lerp(vMat["activeAnchorVortex"]!.value, activeVortex, 0.05);

      const currentAgentPos = vMat["agentPos"]!.value as THREE.Vector3;
      currentAgentPos.lerp(agentPosTarget, 0.05);

      posVariable.material.uniforms["delta"]!.value = delta;
      vMat["delta"]!.value = delta;
      // Provide an ongoing time uniform for the curl noise, independent of event loops
      vMat["time"]!.value = clock.getElapsedTime() * PARAMS.timeScale;

      gpuCompute.compute();

      particleMaterial.uniforms["texturePosition"]!.value = gpuCompute.getCurrentRenderTarget(posVariable).texture;
      particleMaterial.uniforms["textureVelocity"]!.value = gpuCompute.getCurrentRenderTarget(velVariable).texture;

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

      updateTypography();

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

        {/* Metadata Register */}
        <div className="sky-metadata-panel">
          AGENT 028<br />GEMINI 2.5<br /><br />GEN 028<br />23 AUG 2026
        </div>

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
