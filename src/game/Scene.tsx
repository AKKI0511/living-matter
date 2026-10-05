"use client";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import {
  EffectComposer,
  N8AO,
  ToneMapping,
} from "@react-three/postprocessing";
import { ACESFilmicToneMapping, Vector2, type WebGLRenderer } from "three";
import { useGame } from "./store";
import { Player } from "./Player";
import { Matter } from "./Matter";
import { Atmosphere, World } from "./EnvironmentWorld";
import { createRuntime, formMatter, type Runtime } from "./runtime";
import { decisionAuditEnabled } from "./decision-audit-mode";
import { input } from "./input";
import type { FormationKind, Vec3 } from "./world";
import { sites } from "./world";
import { weaveRoute } from "./weave";
import { QualityMonitor, renderDpr } from "./quality";

type PipelineInfo = { buffer: number[]; aoBuffer: number[]; gammaCorrection: boolean };
const pipelineInfo = new WeakMap<WebGLRenderer, () => PipelineInfo | null>();

declare global {
  interface Window {
    __livingMatter?: {
      snapshot: () => unknown;
      renderInfo: () => {
        geometries: number;
        textures: number;
        calls: number;
        triangles: number;
        pipeline: PipelineInfo | null;
      };
      teleport: (p: Vec3) => void;
      formation: (site: number, kind: FormationKind, bend?: number, reverse?: boolean) => void;
      look: (yaw: number, pitch: number) => void;
    };
  }
}

function Simulation({ runtimeRef }: { runtimeRef: RefObject<Runtime | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const runtime = useMemo(() => createRuntime(), []);
  const phase = useGame((s) => s.phase);
  const auditStarted = useRef(false);
  useEffect(() => {
    if (!decisionAuditEnabled()) return;
    const event = phase === "playing" ? auditStarted.current ? "resumed" : "started" : phase === "paused" ? "paused" : phase === "complete" ? "completed" : null;
    if (!event || (!auditStarted.current && phase !== "playing")) return;
    auditStarted.current = true;
    void fetch("/api/decision/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: runtime.sessionId, event, simulationTime: runtime.time, recoveries: runtime.recoveries }),
      keepalive: true,
    }).then((response) => {
      if (!response.ok) console.warn("Live session audit could not start.");
    }).catch(() => console.warn("Live session audit could not start."));
  }, [phase, runtime]);
  useEffect(() => {
    runtime.disposed = false;
    runtimeRef.current = runtime;
    if (process.env.NODE_ENV === "development")
      window.__livingMatter = {
        snapshot: () => {
          let matterMeshes = 0,
            matterUnits = 0;
          scene.traverse((o) => {
            if (o.name === "living-matter" && "count" in o) {
              matterMeshes++;
              matterUnits += o.count as number;
            }
          });
          return {
            ...(decisionAuditEnabled() ? { sessionId: runtime.sessionId } : {}),
            matterMeshes,
            matterUnits,
            time: runtime.time,
            player: runtime.player,
            velocity: runtime.velocity,
            grounded: runtime.grounded,
            solidMatterColliders: runtime.solidColliderHandles.size,
            recoveries: runtime.recoveries,
            states: runtime.states,
            phase: useGame.getState().phase,
            diagnostics: runtime.diagnostics,
            activeSite: runtime.activeSite,
            matterCount: 512,
            companion: runtime.companion,
            assistance: runtime.assistance,
            weave: runtime.weave,
          };
        },
        renderInfo: () => ({
          ...gl.info.memory,
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          pipeline: pipelineInfo.get(gl)?.() ?? null,
        }),
        teleport: (p) => {
          runtime.forcedPosition = p;
        },
        formation: (i, kind, bend = 0, reverse = false) => {
          if (sites[i]?.candidates.includes(kind)) {
            formMatter(
              runtime,
              i,
              kind,
              reverse,
              kind === "weave"
                ? weaveRoute(sites[i], Math.max(-1, Math.min(1, bend)), reverse)
                : undefined,
            );
            runtime.manualFormation = true;
          }
        },
        look: (yaw, pitch) => {
          input.yaw = yaw;
          input.pitch = pitch;
        },
      };
    return () => {
      runtime.disposed = true;
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      runtime.gate.reset();
      delete window.__livingMatter;
    };
  }, [runtime, gl, scene, runtimeRef]);
  useEffect(() => {
    if (phase !== "playing") runtime.gate.reset();
  }, [phase, runtime]);
  return (
    <Physics
      paused={phase !== "playing"}
      timeStep={1 / 60}
      interpolate
      gravity={[0, -19, 0]}
    >
      <World />
      <Matter runtime={runtime} />
      <Player runtime={runtime} />
    </Physics>
  );
}

function PerformanceBudget({ runtimeRef }: { runtimeRef: RefObject<Runtime | null> }) {
  const gl = useThree(s => s.gl), invalidate = useThree(s => s.invalidate);
  const quality = useGame(s => s.quality);
  const measurements = useRef({ monitor: new QualityMonitor(), prepared: false, trial: false, frames: 0 });
  useEffect(() => {
    measurements.current = { monitor: new QualityMonitor(), prepared: false, trial: false, frames: 0 };
    // Compile and trial High behind the menu, before movement starts. Auto
    // never introduces a cold effects/shadow pipeline in the middle of play.
    useGame.setState({ renderQuality: quality === "high" ? "high" : "low", graphicsReady: false });
    invalidate();
  }, [quality, invalidate]);
  useFrame((_, dt) => {
    const state = useGame.getState(), m = measurements.current;
    if (document.hidden || state.phase === "error") return;
    if (!m.prepared) {
      invalidate();
      if (!runtimeRef.current || (state.renderQuality === "high" && !pipelineInfo.get(gl)?.())) return;
      if (++m.frames < 3) return;
      if (quality === "auto" && !m.trial) {
        // Warm the fallback too, so a later downgrade uses cached shaders.
        m.trial = true; m.frames = 0;
        useGame.setState({ renderQuality: "high" });
        return;
      }
      if (quality === "auto" && state.renderQuality === "high") {
        const result = m.monitor.sample(dt);
        if (!result) return;
        if (result === "low") { useGame.setState({ renderQuality: "low" }); m.frames = 0; return; }
      }
      m.prepared = true;
      useGame.setState({ graphicsReady: true, ...(state.phase === "loading" ? { phase: "ready" as const } : {}) });
      return;
    }
    if (state.phase !== "playing" || state.renderQuality !== "high") return;
    const result = m.monitor.sample(dt);
    if (result === "low") {
      if (quality === "auto") useGame.setState({ renderQuality: "low" });
      else if (quality === "high") useGame.setState({ slow: true });
    }
  });
  return null;
}

function ContextLifecycle() {
  const gl = useThree(s => s.gl);
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); useGame.getState().setPhase("error"); };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [gl]);
  return null;
}

function HighEffects() {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene), camera = useThree(s => s.camera);
  const composer = useRef<ComponentRef<typeof EffectComposer>>(null);
  const ao = useRef<ComponentRef<typeof N8AO>>(null);
  const buffer = useMemo(() => new Vector2(), []);
  // The wrapper tracks CSS size, but DPR can change without a CSS resize.
  // A single owner draws every frame, including pass construction and resize.
  // Do not hand render ownership across React commits: a partial chain can
  // clear the screen without presenting the world.
  useFrame((_, dt) => {
    const effect = composer.current;
    const toneMapping = gl.toneMapping, autoClear = gl.autoClear;
    const complete = effect && ao.current && effect.passes.includes(ao.current) &&
      effect.passes.length >= 4 && effect.passes.at(-1)?.enabled && effect.passes.at(-1)?.renderToScreen;
    try {
      gl.autoClear = true;
      if (complete) {
        gl.getDrawingBufferSize(buffer);
        if (effect.inputBuffer.width !== buffer.x || effect.inputBuffer.height !== buffer.y) {
          gl.getSize(buffer);
          effect.setSize(buffer.x, buffer.y);
        }
        effect.render(dt);
      } else {
        gl.setRenderTarget(null);
        gl.toneMapping = ACESFilmicToneMapping;
        gl.render(scene, camera);
      }
    } finally {
      gl.toneMapping = toneMapping;
      gl.autoClear = autoClear;
    }
  }, 1);
  useEffect(() => {
    // Preparation needs the same readiness signal in production.
    pipelineInfo.set(gl, () => composer.current && ao.current && composer.current.passes.length >= 4 &&
      composer.current.passes.at(-1)?.renderToScreen ? {
      buffer: [composer.current.inputBuffer.width, composer.current.inputBuffer.height],
      aoBuffer: [ao.current.width, ao.current.height],
      gammaCorrection: ao.current.configuration.gammaCorrection,
    } : null);
    return () => { pipelineInfo.delete(gl); };
  }, [gl]);
  // High already supersamples. Multisampled half-float/depth targets add
  // expensive resolves (especially on integrated GPUs) before every AO pass.
  return <EffectComposer ref={composer} enabled={false} multisampling={0}>
    <N8AO ref={pass => {
      ao.current = pass;
      // N8AO 2's post pass defaults to sRGB output. Keep intermediate color
      // linear; the final ACES/output pass performs the only display conversion.
      if (pass) pass.configuration.gammaCorrection = false;
    }} aoRadius={0.65} intensity={0.28} distanceFalloff={1} quality="performance" halfRes />
    <ToneMapping mode={6} />
  </EffectComposer>;
}

export default function Scene() {
  const runtimeRef = useRef<Runtime | null>(null);
  const run = useGame((s) => s.run),
    quality = useGame((s) => s.renderQuality);
  const phase = useGame((s) => s.phase);
  const [size, setSize] = useState(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  useEffect(() => {
    const resize = () => setSize({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio });
    addEventListener("resize", resize); visualViewport?.addEventListener("resize", resize);
    return () => { removeEventListener("resize", resize); visualViewport?.removeEventListener("resize", resize); };
  }, []);
  return (
    <Canvas
      frameloop={phase === "playing" ? "always" : "demand"}
      shadows={quality === "high" ? "percentage" : false}
      dpr={renderDpr(quality, size.width, size.height, size.dpr)}
      camera={{ fov: 66, near: 0.08, far: 900, position: [0, 1.8, 1] }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
    >
      <PerformanceBudget runtimeRef={runtimeRef} />
      <ContextLifecycle />
      <Atmosphere />
      <Simulation key={run} runtimeRef={runtimeRef} />
      {quality === "high" && <HighEffects />}
    </Canvas>
  );
}
