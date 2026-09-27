"use client";
import { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import {
  Bloom,
  EffectComposer,
  N8AO,
  ToneMapping,
} from "@react-three/postprocessing";
import { ACESFilmicToneMapping } from "three";
import { useGame } from "./store";
import { Player } from "./Player";
import { Constellation } from "./Constellation";
import { Matter } from "./Matter";
import { Atmosphere, World } from "./EnvironmentWorld";
import { createRuntime, formMatter } from "./runtime";
import { decisionAuditEnabled } from "./decision-audit-mode";
import { input } from "./input";
import type { FormationKind, Vec3 } from "./world";
import { sites } from "./world";
import { weaveRoute } from "./weave";

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
  useEffect(() => {
    if (!decisionAuditEnabled() || phase !== "playing") return;
    void fetch("/api/decision/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: runtime.sessionId }),
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
            if ("isInstancedMesh" in o && "count" in o) {
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
            constellation: runtime.constellation.length,
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
  return (
    <Physics
      paused={phase !== "playing"}
      timeStep={1 / 60}
      interpolate
      gravity={[0, -19, 0]}
    >
      <World />
      <Matter runtime={runtime} />
      <Constellation runtime={runtime} />
      <Player runtime={runtime} />
    </Physics>
  );
}

function RenderBudget() {
  const { size, setDpr } = useThree();
  const quality = useGame((s) => s.quality);
  useEffect(() => {
    const budget = quality === "high" ? 2_000_000 : 1_000_000;
    setDpr(
      Math.max(
        0.5,
        Math.min(
          window.devicePixelRatio,
          quality === "high" ? 1.5 : 1,
          Math.sqrt(budget / Math.max(1, size.width * size.height)),
        ),
      ),
    );
  }, [size.width, size.height, quality, setDpr]);
  return null;
}

export default function Scene() {
  const run = useGame((s) => s.run),
    quality = useGame((s) => s.quality);
  const phase = useGame((s) => s.phase);
  return (
    <Canvas
      frameloop={phase === "playing" ? "always" : "demand"}
      shadows={quality === "high" ? "percentage" : false}
      dpr={quality === "high" ? [0.5, 1.5] : [0.5, 1]}
      camera={{ fov: 66, near: 0.08, far: 900, position: [0, 1.8, 1] }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          useGame.getState().setPhase("error");
        });
      }}
    >
      <RenderBudget />
      <Atmosphere />
      <Simulation key={run} />
      {quality === "high" && (
        <EffectComposer multisampling={4}>
          <N8AO
            aoRadius={0.8}
            intensity={1.1}
            distanceFalloff={1}
            quality="performance"
            halfRes
          />
          <Bloom luminanceThreshold={1.5} intensity={0.16} mipmapBlur />
          <ToneMapping />
        </EffectComposer>
      )}
    </Canvas>
  );
}
