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
  DESTINATION,
  MATTER_COUNT,
  collisionBoxes,
  formationPose,
  platformOffset,
  sites,
  smooth,
} from "./world";
import { formMatter, type Runtime } from "./runtime";
import { availableCandidates, onPermanentGround } from "./affordances";
import { sound } from "./audio";
import { useGame } from "./store";

export function Matter({ runtime }: { runtime: Runtime }) {
  const mesh = useRef<InstancedMesh>(null),
    body = useRef<RapierRigidBody>(null);
  const colliders = useRef<(RapierCollider | null)[]>([]);
  const nextCheck = useRef(0),
    seenRevision = useRef(-1),
    transitionStart = useRef(0);
  const dummy = useMemo(() => new Object3D(), []);
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.045), []);
  const live = useMemo(() => new Float32Array(MATTER_COUNT * 6), []);
  const origin = useMemo(() => new Float32Array(MATTER_COUNT * 6), []);
  const boxes = useMemo(
    () =>
      sites.flatMap((site, index) =>
        site.candidates.flatMap((kind) =>
          collisionBoxes(site, kind).map((box) => ({ ...box, index, kind })),
        ),
      ),
    [],
  );
  const poses = useMemo(
    () =>
      sites.map((site) =>
        Object.fromEntries(
          site.candidates.map((kind) => [
            kind,
            Array.from({ length: MATTER_COUNT }, (_, i) =>
              formationPose(site, kind, i),
            ),
          ]),
        ),
      ),
    [],
  );
  useEffect(() => {
    mesh.current!.instanceMatrix.setUsage(DynamicDrawUsage);
    const color = new Color();
    for (let i = 0; i < MATTER_COUNT; i++) {
      mesh.current!.setColorAt(
        i,
        color.setHSL(
          0.092 + Math.sin(i * 23.7) * 0.012,
          0.28,
          0.48 + (i % 7) * 0.028,
        ),
      );
      live.set(
        [
          -4 + ((i % 8) - 3.5) * 0.36,
          2 + Math.floor(i / 64) * 0.36,
          -6 + ((Math.floor(i / 8) % 8) - 3.5) * 0.36,
          0.32,
          0.32,
          0.32,
        ],
        i * 6,
      );
    }
    mesh.current!.instanceColor!.needsUpdate = true;
    return () => geometry.dispose();
  }, [geometry, live]);
  useBeforePhysicsStep(() => {
    const index = runtime.activeSite,
      state = index === null ? null : runtime.states[index];
    if (
      state?.phase === "forming" &&
      runtime.time - state.since >= FORMATION_SECONDS
    ) {
      state.phase = "active";
      state.rideSince = runtime.time;
      sound.settle();
    }
    if (state) {
      state.previousOffset = [...state.offset];
      state.offset =
        state.kind === "platform"
          ? platformOffset(
              sites[index!],
              (state.phase === "active" ? runtime.time - state.rideSince : 0) +
                (state.reverse ? 9 : 0),
            )
          : [0, 0, 0];
      if (state.phase === "forming") state.previousOffset = [...state.offset];
    }
    runtime.solidColliderHandles.clear();
    colliders.current.forEach((c, i) => {
      if (!c) return;
      runtime.matterColliderHandles.add(c.handle);
      const enabled =
        state?.phase === "active" &&
        boxes[i].index === index &&
        boxes[i].kind === state.kind;
      c.setEnabled(enabled);
      if (enabled) runtime.solidColliderHandles.add(c.handle);
    });
    const offset = state?.offset ?? [0, 0, 0];
    body.current?.setNextKinematicTranslation({
      x: offset[0],
      y: offset[1],
      z: offset[2],
    });
    runtime.platformBodyHandle =
      state?.phase === "active" && state.kind === "platform"
        ? (body.current?.handle ?? null)
        : null;
  });
  useFrame((_, dt) => {
    if (!mesh.current) return;
    const index = runtime.activeSite,
      state = index === null ? null : runtime.states[index];
    if (runtime.revision !== seenRevision.current) {
      origin.set(live);
      seenRevision.current = runtime.revision;
      transitionStart.current = runtime.time;
    }
    const p = runtime.player,
      companion = runtime.companion;
    const follow = 1 - Math.exp(-Math.min(dt, 0.05) * 2);
    const gaze = runtime.history.at(-1)?.gaze ?? [0, 0, -1];
    // One visible companion follows off the player's shoulder, never respawning at obstacles.
    const desired = [p[0] + 4, p[1] + 1.8, p[2] + gaze[2] * 4];
    for (let a = 0; a < 3; a++)
      companion[a] += (desired[a] - companion[a]) * follow;
    const elapsed = runtime.time - transitionStart.current;
    const duration = state ? FORMATION_SECONDS : 1.8;
    for (let i = 0; i < MATTER_COUNT; i++) {
      const j = i * 6,
        t = smooth((elapsed - ((i % 32) / 32) * 0.35) / (duration - 0.4));
      const pose = state ? poses[index!][state.kind][i] : null;
      const wave =
        Math.sin(runtime.time * 0.8 + Math.floor(i / 64) * 0.3) * 0.055;
      const target = pose
        ? [
            pose.position[0] + state!.offset[0],
            pose.position[1] + state!.offset[1],
            pose.position[2] + state!.offset[2],
            ...pose.scale,
          ]
        : [
            companion[0] + ((i % 8) - 3.5) * 0.36,
            companion[1] + (Math.floor(i / 64) - 3.5) * 0.36 + wave,
            companion[2] + ((Math.floor(i / 8) % 8) - 3.5) * 0.36,
            0.32,
            0.32,
            0.32,
          ];
      const arc = Math.sin(t * Math.PI);
      for (let a = 0; a < 6; a++)
        live[j + a] = origin[j + a] + (target[a] - origin[j + a]) * t;
      live[j + 1] += arc * (2.5 + (i % 8) * 0.12);
      dummy.position.set(live[j], live[j + 1], live[j + 2]);
      dummy.scale.set(live[j + 3], live[j + 4], live[j + 5]);
      dummy.rotation.set(
        arc * Math.sin(i) * 0.45,
        arc * 0.8 + (!state ? Math.sin(runtime.time * 0.5 + i / 64) * 0.06 : 0),
        arc * Math.cos(i) * 0.3,
      );
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (
      useGame.getState().phase !== "playing" ||
      runtime.time < nextCheck.current
    )
      return;
    nextCheck.current = runtime.time + 0.3;
    // Only the engine's support/geometry checks constrain a decision. Behavior belongs to the source.
    if (!runtime.grounded || !onPermanentGround(p)) return;
    if (state && runtime.manualFormation) {
      const site = sites[index!];
      const reachedOtherShore = state.reverse
        ? p[2] > site.start[2] + 4
        : p[2] < site.end[2] - 4;
      if (!reachedOtherShore) return;
    }
    const candidates = availableCandidates(p),
      revision = runtime.revision;
    const requestGaze = runtime.history.at(-1)?.gaze;
    void runtime.gate
      .requestResult({
        observations: runtime.history.slice(),
        objective: DESTINATION,
        candidates,
        current: state
          ? {
              candidateId: `${sites[index!].id}:${state.kind}`,
              phase: state.phase,
            }
          : undefined,
        assistance: runtime.assistance.slice(),
      })
      .then((result) => {
        if (
          !result.valid ||
          runtime.disposed ||
          useGame.getState().phase !== "playing" ||
          runtime.revision !== revision ||
          !runtime.grounded ||
          !onPermanentGround(runtime.player)
        )
          return;
        const currentGaze = runtime.history.at(-1)?.gaze;
        // A response to an obsolete view is stale, irrespective of the selected intervention.
        if (
          requestGaze &&
          currentGaze &&
          requestGaze.reduce((dot, v, a) => dot + v * currentGaze[a], 0) < 0.5
        )
          return;
        const choice = result.candidate;
        const valid = choice
          ? availableCandidates(runtime.player).find((c) => c.id === choice.id)
          : null;
        if (choice && !valid) return;
        if (
          state &&
          choice?.siteId === sites[index!].id &&
          choice.kind === state.kind
        )
          return;
        if (state) {
          const site = sites[index!],
            goal = state.reverse ? site.start : site.end,
            origin = state.reverse ? site.end : site.start;
          const used =
            Math.hypot(p[0] - goal[0], p[2] - goal[2]) <
            Math.hypot(p[0] - origin[0], p[2] - origin[2]);
          runtime.assistance.push({
            time: runtime.time,
            candidateId: `${site.id}:${state.kind}`,
            outcome: used ? "used" : "abandoned",
          });
          if (runtime.assistance.length > 24) runtime.assistance.shift();
          state.phase = "idle";
          runtime.activeSite = null;
          runtime.revision++;
          runtime.gate.reset();
        }
        if (choice && valid) {
          const i = sites.findIndex((s) => s.id === choice.siteId);
          formMatter(
            runtime,
            i,
            choice.kind,
            valid.physical!.from === sites[i].end,
          );
          sound.transform();
        }
      });
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
          emissive="#ba8640"
          emissiveIntensity={0.08}
        />
      </instancedMesh>
      <RigidBody ref={body} type="kinematicPosition" colliders={false}>
        {boxes.map((box, i) => (
          <CuboidCollider
            key={i}
            ref={(v) => {
              colliders.current[i] = v;
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
