"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import {
  EffectComposer,
  N8AO,
  ToneMapping,
} from "@react-three/postprocessing";
import { ACESFilmicToneMapping } from "three";
import { useGame } from "./store";
import { Player } from "./Player";
import { Matter } from "./Matter";
import { Atmosphere, World } from "./EnvironmentWorld";
import { createRuntime, formMatter } from "./runtime";
import { decisionAuditEnabled } from "./decision-audit-mode";
import { input } from "./input";
import type { FormationKind, Vec3 } from "./world";
import { sites } from "./world";
import { weaveRoute } from "./weave";
import { frameSummary, renderDpr } from "./quality";

declare global {
  interface Window {
    __livingMatter?: {
      snapshot: () => unknown;
      renderInfo: () => {
        geometries: number;
        textures: number;
        calls: number;
        triangles: number;
      };
      teleport: (p: Vec3) => void;
      formation: (site: number, kind: FormationKind, bend?: number, reverse?: boolean) => void;
      look: (yaw: number, pitch: number) => void;
    };
  }
}

function Simulation() {
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
    if (useGame.getState().phase === "loading")
      useGame.getState().setPhase("ready");
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
            grounded: runtime.grounded,
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
      runtime.gate.reset();
      delete window.__livingMatter;
    };
  }, [runtime, gl, scene]);
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

function PerformanceBudget() {
  const quality = useGame(s => s.quality);
  const measurements = useRef({ elapsed: 0, samples: [] as number[], tested: false, settled: false });
  useEffect(() => { measurements.current = { elapsed: 0, samples: [], tested: false, settled: false }; }, [quality]);
  useFrame((_, dt) => {
    if (useGame.getState().phase !== "playing" || document.hidden) return;
    const m = measurements.current; if (m.settled) return;
    m.elapsed += dt;
    // Exclude startup and shader compilation, then evaluate in long windows.
    if (m.elapsed < 3) return;
    m.samples.push(Math.min(dt, 0.5) * 1000);
    if (m.elapsed < 11 || m.samples.length < 120) return;
    const { p95 } = frameSummary(m.samples);
    if (quality === "auto") {
      if (!m.tested && p95 <= 19) {
        useGame.setState({ renderQuality: "high" }); m.tested = true; m.elapsed = 0; m.samples = []; return;
      }
      if (m.tested && p95 > 24) useGame.setState({ renderQuality: "low" });
    } else if (quality === "high" && p95 > 26) useGame.setState({ slow: true });
    m.settled = true;
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

export default function Scene() {
  const run = useGame((s) => s.run),
    quality = useGame((s) => s.renderQuality);
  const phase = useGame((s) => s.phase);
  const [size, setSize] = useState(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  useEffect(() => {
    const resize = () => setSize({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio });
    addEventListener("resize", resize); return () => removeEventListener("resize", resize);
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
      <PerformanceBudget />
      <ContextLifecycle />
      <Atmosphere />
      <Simulation key={run} />
      {quality === "high" && (
        <EffectComposer multisampling={2}>
          <N8AO
            aoRadius={0.8}
            intensity={0.32}
            distanceFalloff={1}
            quality="performance"
            halfRes
          />
          {/* postprocessing ToneMappingMode.ACES_FILMIC matches the direct renderer. */}
          <ToneMapping mode={6} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
