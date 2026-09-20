"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  type RapierCollider,
  type RapierRigidBody,
} from "@react-three/rapier";
import { Color, DynamicDrawUsage, InstancedMesh, Object3D } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  FORMATION_SECONDS,
  MATTER_COUNT,
  collisionBoxes,
  formationPose,
  platformOffset,
  restingPose,
  sites,
  smooth,
  type Site,
} from "./world";
import type { Runtime } from "./runtime";
import { sound } from "./audio";
import { useGame } from "./store";

function MatterPool({
  site,
  index,
  runtime,
}: {
  site: Site;
  index: number;
  runtime: Runtime;
}) {
  const mesh = useRef<InstancedMesh>(null),
    body = useRef<RapierRigidBody>(null);
  const colliders = useRef<(RapierCollider | null)[]>([]);
  const idleCollider = useRef<RapierCollider>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.045), []);
  const rest = useMemo(
    () => Array.from({ length: MATTER_COUNT }, (_, i) => restingPose(site, i)),
    [site],
  );
  // All candidates have collision proxies ready; only the selected settled structure is enabled.
  const allBoxes = useMemo(
    () =>
      site.candidates.flatMap((kind) =>
        collisionBoxes(site, kind).map((box) => ({ ...box, kind })),
      ),
    [site],
  );
  const poses = useMemo(
    () =>
      Object.fromEntries(
        site.candidates.map((kind) => [
          kind,
          Array.from({ length: MATTER_COUNT }, (_, i) =>
            formationPose(site, kind, i),
          ),
        ]),
      ),
    [site],
  );
  useEffect(() => {
    const instance = mesh.current!;
    instance.instanceMatrix.setUsage(DynamicDrawUsage);
    const color = new Color();
    for (let i = 0; i < MATTER_COUNT; i++)
      instance.setColorAt(
        i,
        color.setHSL(
          0.092 + Math.sin(i * 23.7) * 0.012,
          0.28,
          0.48 + (i % 7) * 0.028,
        ),
      );
    if (instance.instanceColor) instance.instanceColor.needsUpdate = true;
    return () => geometry.dispose();
  }, [geometry]);
  useBeforePhysicsStep(() => {
    const s = runtime.states[index];
    if (s.phase === "forming" && runtime.time - s.since >= FORMATION_SECONDS) {
      s.phase = "active";
      s.since = runtime.time;
      s.rideSince = runtime.time;
      sound.settle();
    }
    if (
      s.phase === "dissolving" &&
      runtime.time - s.since >= FORMATION_SECONDS
    ) {
      s.phase = "idle";
      s.since = runtime.time;
    }
    colliders.current.forEach((collider, i) =>
      collider?.setEnabled(s.phase === "active" && allBoxes[i].kind === s.kind),
    );
    idleCollider.current?.setEnabled(s.phase === "idle");
    s.previousOffset[0] = s.offset[0];
    s.previousOffset[1] = s.offset[1];
    s.previousOffset[2] = s.offset[2];
    if (s.phase === "active" && s.kind === "platform")
      s.offset = platformOffset(site, runtime.time - s.rideSince);
    else if (s.phase === "forming" || s.phase === "idle") s.offset = [0, 0, 0];
    body.current?.setNextKinematicTranslation({
      x: s.offset[0],
      y: s.offset[1],
      z: s.offset[2],
    });
  });
  useFrame(() => {
    if (!mesh.current) return;
    const s = runtime.states[index],
      elapsed = runtime.time - s.since,
      target = poses[s.kind];
    for (let i = 0; i < MATTER_COUNT; i++) {
      const delay = ((i % 32) / 32) * 0.6;
      let t =
        s.phase === "active"
          ? 1
          : s.phase === "idle"
            ? 0
            : smooth((elapsed - delay) / (FORMATION_SECONDS - 0.65));
      if (s.phase === "dissolving") t = 1 - t;
      const a = rest[i],
        b = target[i],
        arc = Math.sin(t * Math.PI);
      const idleMotion =
        (1 - t) *
        Math.sin(runtime.time * 0.8 + Math.floor(i / 64) * 0.3) *
        0.065;
      const twist =
        Math.sin(runtime.time * 0.45 + Math.floor(i / 64) * 0.16) *
        0.09 *
        (1 - t);
      const localX = a.position[0] - site.idle[0],
        localZ = a.position[2] - site.idle[2];
      dummy.position.set(
        a.position[0] +
          (b.position[0] + s.offset[0] - a.position[0]) * t +
          arc * Math.sin(i * 0.4) * 0.9 +
          localZ * twist,
        a.position[1] +
          (b.position[1] + s.offset[1] - a.position[1]) * t +
          arc * (3 + (i % 8) * 0.18) +
          idleMotion,
        a.position[2] +
          (b.position[2] + s.offset[2] - a.position[2]) * t +
          arc * Math.cos(i * 0.4) * 0.6 -
          localX * twist,
      );
      dummy.scale.set(
        a.scale[0] + (b.scale[0] - a.scale[0]) * t,
        a.scale[1] + (b.scale[1] - a.scale[1]) * t,
        a.scale[2] + (b.scale[2] - a.scale[2]) * t,
      );
      dummy.rotation.set(
        arc * Math.sin(i) * 0.45,
        arc * 0.8 + twist,
        arc * Math.cos(i) * 0.3,
      );
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[geometry, undefined, MATTER_COUNT]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <meshStandardMaterial
          color="#d4b980"
          metalness={0.58}
          roughness={0.3}
        />
      </instancedMesh>
      <RigidBody ref={body} type="kinematicPosition" colliders={false}>
        <CuboidCollider
          ref={idleCollider}
          args={[1.94, 1.9, 1.94]}
          position={[site.idle[0], site.idle[1] + 1.68, site.idle[2]]}
        />
        {allBoxes.map((box, i) => (
          <CuboidCollider
            key={i}
            ref={(value) => {
              colliders.current[i] = value;
            }}
            args={[box.size[0] / 2, box.size[1] / 2, box.size[2] / 2]}
            position={box.position}
            rotation={box.rotation}
          />
        ))}
      </RigidBody>
    </>
  );
}

export function Matter({ runtime }: { runtime: Runtime }) {
  const nextCheck = useRef(0);
  useFrame(() => {
    if (
      useGame.getState().phase !== "playing" ||
      runtime.time < nextCheck.current
    )
      return;
    nextCheck.current = runtime.time + 0.35;
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i],
        state = runtime.states[i],
        p = runtime.player;
      const nearStart =
        Math.abs(p[2] - site.start[2]) < 22 && Math.abs(p[0]) < 9;
      const nearEnd = Math.abs(p[2] - site.end[2]) < 9 && Math.abs(p[0]) < 9;
      if (state.phase === "idle" && (nearStart || nearEnd)) {
        const candidates = site.candidates.map((kind) => ({
          id: `${site.id}:${kind}`,
          siteId: site.id,
          kind,
        }));
        void runtime.gate
          .request({ observations: runtime.history.slice(), candidates })
          .then((choice) => {
            if (!choice || runtime.disposed || state.phase !== "idle") return;
            const current = runtime.player;
            if (
              Math.abs(current[0]) >= 9 ||
              Math.min(
                Math.abs(current[2] - site.start[2]),
                Math.abs(current[2] - site.end[2]),
              ) >= 22
            )
              return;
            state.kind = choice.kind;
            state.phase = "forming";
            state.since = runtime.time;
            sound.transform();
          });
      }
      if (
        state.phase === "active" &&
        runtime.grounded &&
        (p[2] < site.end[2] - 10 || p[2] > site.start[2] + 32)
      ) {
        state.phase = "dissolving";
        state.since = runtime.time;
      }
    }
  });
  return sites.map((site, i) => (
    <MatterPool key={site.id} site={site} index={i} runtime={runtime} />
  ));
}
