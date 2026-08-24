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
  float life = tmpPos.w; // w can store life or other properties

  pos += vel * delta;
  
  // Bounding box reset - wrap around organically instead of collapsing to center
  if (length(pos) > 1200.0) {
      pos = -pos * 0.95; // Wrap to opposite side
  }

  gl_FragColor = vec4(pos, life);
}
`;

const velocityShader = `
uniform float time;
uniform float delta;
uniform float globalEnergy;
uniform float flowStrength;

// Agent Disturbance Field
uniform vec3 agentPos;
uniform float agentEnergy;
uniform float agentRadius;

// Article Anchors & Condensation
uniform vec3 activeAnchorPos;
uniform float activeAnchorPull;
uniform float activeAnchorVortex;

uniform vec3 persistentAnchorPos;
uniform float persistentAnchorStrength;

${snoiseGLSL}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 tmpPos = texture2D(texturePosition, uv);
  vec4 tmpVel = texture2D(textureVelocity, uv);

  vec3 pos = tmpPos.xyz;
  vec3 vel = tmpVel.xyz;

  // Multi-scale Curl Noise
  vec3 largeCurl = curlNoise(pos * 0.002 + time * 0.05) * 0.55;
  vec3 mediumCurl = curlNoise(pos * 0.01 + time * 0.1) * 0.30;
  vec3 fineCurl = curlNoise(pos * 0.05 + time * 0.3) * 0.15;
  
  vec3 flow = (largeCurl + mediumCurl + fineCurl) * globalEnergy * flowStrength;

  // Cosmic Breathing - organic radial expansion to compensate for orbital decay
  // Uses a very slow sine wave (period ~ 60s) to gently push particles outward
  float breathing = sin(time * 0.1) * 0.5 + 0.5; // range 0.0 to 1.0
  vec3 radialOut = normalize(pos) * breathing * 25.0 * globalEnergy;
  flow += radialOut;

  // Agent Disturbance
  vec3 toAgent = agentPos - pos;
  float distToAgent = length(toAgent);
  
  if (distToAgent < agentRadius) {
     float influence = smoothstep(agentRadius, 0.0, distToAgent);
     vec3 agentTurbulence = curlNoise(pos * 0.1 + time * 1.5);
     flow += agentTurbulence * influence * agentEnergy * 300.0;
     
     // Pull slightly towards agent to create a wake
     flow += normalize(toAgent) * influence * agentEnergy * 50.0;
  }

  // Active Anchor (Condensation & Reading)
  vec3 toActive = activeAnchorPos - pos;
  float distToActive = length(toActive);
  if (distToActive < 400.0 && activeAnchorPull > 0.0) {
      float influence = smoothstep(400.0, 0.0, distToActive);
      // Convergence (Pull)
      flow += normalize(toActive) * influence * activeAnchorPull * 150.0;
      // Vortex (Cross product with Up vector)
      vec3 vortexDir = cross(normalize(toActive), vec3(0.0, 1.0, 0.0));
      flow += vortexDir * influence * activeAnchorVortex * 150.0;
  }

  // Persistent Anchor (Long-term memory)
  vec3 toPersistent = persistentAnchorPos - pos;
  float distToPersistent = length(toPersistent);
  if (distToPersistent < 250.0 && persistentAnchorStrength > 0.0) {
      float influence = smoothstep(250.0, 0.0, distToPersistent);
      // Persistent structural change: slight vortex and density modulation
      vec3 pVortexDir = cross(normalize(toPersistent), vec3(0.0, 1.0, 0.0));
      flow += pVortexDir * influence * persistentAnchorStrength * 40.0;
      // Slight inward pull to keep density
      flow += normalize(toPersistent) * influence * persistentAnchorStrength * 20.0;
  }

  vel += flow * delta;
  vel *= 0.94; // Damping

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

import { SkyArticle, SkyEvent } from "./sky-canvas";

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
  const t = h += 0x6D2B79F5;
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
      const layoutPos = layoutLayouts[Math.floor(r4 * layoutLayouts.length)];

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
    const uiLayer = uiLayerRef.current;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 1.5); // Cap DPR

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(dpr);
    container.appendChild(renderer.domElement);

    const PARAMS = {
      globalEnergy: 0.1,
      flowStrength: 100.0,
      agentEnergyMultiplier: 1.5,
      agentRadius: 200.0,
      decayPerSecond: 0.046,
      timeScale: 1.0,
      manualTimeline: false,
      seqTimeOverride: 0
    };

    let pane: Pane | null = null;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("debug") === "1") {
      pane = new Pane({ title: 'Generative Sky Params' });
      pane.addBinding(PARAMS, 'globalEnergy', { min: 0.0, max: 2.0 });
      pane.addBinding(PARAMS, 'manualTimeline');
      pane.addBinding(PARAMS, 'seqTimeOverride', { min: 0, max: 80 });
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

    const posArray = dtPosition.image.data;
    const velArray = dtVelocity.image.data;
    for (let k = 0, kl = posArray.length; k < kl; k += 4) {
      posArray[k + 0] = (Math.random() - 0.5) * 1200;
      posArray[k + 1] = (Math.random() - 0.5) * 800;
      posArray[k + 2] = (Math.random() - 0.5) * 800;
      posArray[k + 3] = Math.random();
      velArray[k + 0] = 0; velArray[k + 1] = 0; velArray[k + 2] = 0; velArray[k + 3] = 1;
    }

    const posVariable = gpuCompute.addVariable("texturePosition", positionShader, dtPosition);
    const velVariable = gpuCompute.addVariable("textureVelocity", velocityShader, dtVelocity);
    gpuCompute.setVariableDependencies(posVariable, [posVariable, velVariable]);
    gpuCompute.setVariableDependencies(velVariable, [posVariable, velVariable]);

    posVariable.material.uniforms["delta"] = { value: 0.0 };
    velVariable.material.uniforms["time"] = { value: 0.0 };
    velVariable.material.uniforms["delta"] = { value: 0.0 };
    velVariable.material.uniforms["globalEnergy"] = { value: PARAMS.globalEnergy };
    velVariable.material.uniforms["flowStrength"] = { value: PARAMS.flowStrength };
    velVariable.material.uniforms["agentPos"] = { value: new THREE.Vector3(0, 0, 0) };
    velVariable.material.uniforms["agentEnergy"] = { value: 0.0 };
    velVariable.material.uniforms["agentRadius"] = { value: PARAMS.agentRadius };
    velVariable.material.uniforms["activeAnchorPos"] = { value: new THREE.Vector3(0, 0, 0) };
    velVariable.material.uniforms["activeAnchorPull"] = { value: 0.0 };
    velVariable.material.uniforms["activeAnchorVortex"] = { value: 0.0 };
    velVariable.material.uniforms["persistentAnchorPos"] = { value: new THREE.Vector3(300, 150, 0) };
    velVariable.material.uniforms["persistentAnchorStrength"] = { value: 0.0 };

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
    const rtOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType };
    let rtCurrent = new THREE.WebGLRenderTarget(width * dpr, height * dpr, rtOptions);
    let rtPrevious = new THREE.WebGLRenderTarget(width * dpr, height * dpr, rtOptions);
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
      // Very basic collision avoidance state
      const visibleRects: DOMRect[] = [];
      let excitedCount = 0;
      let traceCount = 0;
      let excerptShown = false;

      anchorsRef.current.forEach(anchor => {
        const el = domRefs.current.get(anchor.id);
        if (!el) return;

        // Interpret continuous energy into typographic presence
        // 0.00-0.08: invisible
        // 0.08-0.25: trace
        // 0.25-0.60: emerging
        // 0.60-1.00: readable
        let visibility = 0;
        let showExcerpt = false;

        if (anchor.energy > 0.08) {
          visibility = THREE.MathUtils.smoothstep(anchor.energy, 0.08, 0.60) * 0.75; // max 0.75 opacity
        }
        if (anchor.energy > 0.85 && !excerptShown) {
          showExcerpt = true;
          excerptShown = true;
        }

        // Budgeting
        if (anchor.energy > 0.6) excitedCount++;
        else if (anchor.energy > 0.08) traceCount++;

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
    let agentPosTarget = new THREE.Vector3(0, 0, 0);
    let activePull = 0.0;
    let activeVortex = 0.0;
    let pAnchorStrength = 0.0;
    let activeAnchorPosTarget = new THREE.Vector3(0, 0, 0);

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

          if (ev.articleId) {
            const targetAnchor = anchorsRef.current.find(a => a.id === ev.articleId);
            if (targetAnchor) {
              agentActive = 1.0;
              agentPosTarget.copy(targetAnchor.pos);

              if (ev.eventType === "article_created") {
                // Condensation Sequence
                targetEnergy = 1.4;
                activeAnchorPosTarget.copy(targetAnchor.pos);
                activePull = 1.5;
                activeVortex = 1.0;
                pAnchorStrength = 1.0;
                // Excite typography
                targetAnchor.energy = 0.95;
              } else if (ev.eventType === "article_opened" || ev.eventType === "article_revised") {
                // Traversal and Reading
                targetEnergy = 0.7;
                activePull = 0.2;
                activeVortex = 0.5;
                targetAnchor.energy = Math.max(targetAnchor.energy, 0.8);
              }
            }
          } else if (ev.eventType === "agent_session_started") {
            agentActive = 1.0;
            targetEnergy = 0.45;
            agentPosTarget.set(0, 0, 400); // Start far away
          } else if (ev.eventType === "agent_session_ended") {
            agentActive = 0.0;
            targetEnergy = 0.1;
            activePull = 0.0;
            activeVortex = 0.0;
          }
        }
      } else {
        // Reached the present. Enter a breathing latent state.
        idleTimeAccumulator += delta;
        
        // Wait 2 minutes (120 seconds of real simulation time).
        // If we exceed it, restart the replay to keep the system active!
        if (idleTimeAccumulator > 120.0) {
            currentEventIndex = 0;
            idleTimeAccumulator = 0;
        }

        // Keep energy high enough so particles continue to explore the whole screen.
        targetEnergy = THREE.MathUtils.lerp(targetEnergy, 0.35, 0.005);

        // Gently disperse them from the last active anchor
        activePull = THREE.MathUtils.lerp(activePull, -0.15, 0.01);
        activeVortex = THREE.MathUtils.lerp(activeVortex, 0.4, 0.01);

        agentActive = THREE.MathUtils.lerp(agentActive, 0.0, 0.01);
      }

      // Decay typography energy over time to create residual traces
      anchorsRef.current.forEach(anchor => {
        if (anchor.energy > 0) {
          anchor.energy -= delta * 0.08; // Faster decay for smoother fadeout
          if (anchor.energy < 0) anchor.energy = 0;
        }
      });

      if (!PARAMS.manualTimeline) {
        PARAMS.globalEnergy = targetEnergy;
        if (pane) pane.refresh();
      } else {
        targetEnergy = PARAMS.globalEnergy;
      }

      const vMat = velVariable.material.uniforms;
      vMat["globalEnergy"].value = THREE.MathUtils.lerp(vMat["globalEnergy"].value, targetEnergy, 0.05);
      vMat["flowStrength"].value = PARAMS.flowStrength;
      vMat["agentRadius"].value = PARAMS.agentRadius;
      vMat["agentEnergy"].value = THREE.MathUtils.lerp(vMat["agentEnergy"].value, agentActive * PARAMS.agentEnergyMultiplier, 0.05);

      const currentActiveAnchorPos = vMat["activeAnchorPos"].value as THREE.Vector3;
      currentActiveAnchorPos.lerp(activeAnchorPosTarget, 0.05);

      vMat["activeAnchorPull"].value = THREE.MathUtils.lerp(vMat["activeAnchorPull"].value, activePull, 0.05);
      vMat["activeAnchorVortex"].value = THREE.MathUtils.lerp(vMat["activeAnchorVortex"].value, activeVortex, 0.05);
      vMat["persistentAnchorStrength"].value = THREE.MathUtils.lerp(vMat["persistentAnchorStrength"].value, pAnchorStrength, 0.02);

      const currentAgentPos = vMat["agentPos"].value as THREE.Vector3;
      currentAgentPos.lerp(agentPosTarget, 0.05);

      posVariable.material.uniforms["delta"].value = delta;
      vMat["delta"].value = delta;
      // Provide an ongoing time uniform for the curl noise, independent of event loops
      vMat["time"].value = clock.getElapsedTime() * PARAMS.timeScale;

      gpuCompute.compute();

      particleMaterial.uniforms["texturePosition"].value = gpuCompute.getCurrentRenderTarget(posVariable).texture;
      particleMaterial.uniforms["textureVelocity"].value = gpuCompute.getCurrentRenderTarget(velVariable).texture;

      renderer.setRenderTarget(rtCurrent);
      renderer.clear();
      renderer.render(scene, camera);

      renderer.setRenderTarget(null);
      trailMaterial.uniforms["decay"].value = Math.pow(PARAMS.decayPerSecond, rawDelta);
      trailMaterial.uniforms["tCurrent"].value = rtCurrent.texture;
      trailMaterial.uniforms["tPrevious"].value = rtPrevious.texture;
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
      if (pane) pane.dispose();
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
