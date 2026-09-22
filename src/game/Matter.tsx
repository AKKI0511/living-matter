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
import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Object3D,
  Euler,
  Quaternion,
} from "three";
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
import {
  applyWeave,
  bankGeometry,
  weaveBlend,
  weaveCandidates,
  weavePose,
  WEAVE_SECONDS,
  type WeaveBank,
} from "./weave";

export function Matter({ runtime }: { runtime: Runtime }) {
  const mesh = useRef<InstancedMesh>(null),
    body = useRef<RapierRigidBody>(null);
  const colliders = useRef<(RapierCollider | null)[]>([]);
  const weaveColliders = useRef<(RapierCollider | null)[]>([]);
  const bankVersions = useRef([-1, -1]);
  const bankPoses = useRef<
    ({
      source: WeaveBank;
      poses: ReturnType<typeof weavePose>[];
      yaw: number;
    } | null)[]
  >([null, null]);
  const bankQuaternion = useMemo(() => new Quaternion(), []);
  const bankEuler = useMemo(() => new Euler(0, 0, 0, "YXZ"), []);
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
        site.candidates
          .filter((kind) => kind !== "weave")
          .flatMap((kind) =>
            collisionBoxes(site, kind).map((box) => ({ ...box, index, kind })),
          ),
      ),
    [],
  );
  const poses = useMemo(
    () =>
      sites.map((site) =>
        Object.fromEntries(
          site.candidates
            .filter((kind) => kind !== "weave")
            .map((kind) => [
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
        state.kind !== "weave" &&
        boxes[i].index === index &&
        boxes[i].kind === state.kind;
      c.setEnabled(enabled);
      if (enabled) runtime.solidColliderHandles.add(c.handle);
    });
    weaveColliders.current.forEach((c, i) => {
      if (!c) return;
      runtime.matterColliderHandles.add(c.handle);
      const bank = state?.kind === "weave" ? runtime.weave?.banks[i] : null;
      const enabled =
        !!bank &&
        state?.phase === "active" &&
        runtime.time - bank.since >= WEAVE_SECONDS;
      c.setEnabled(enabled);
      if (bank) {
        const g = bankGeometry(bank);
        bankQuaternion.setFromEuler(bankEuler.set(g.slope, g.yaw, 0, "YXZ"));
        c.setHalfExtents({
          x: 2.4,
          y: 0.15,
          z: Math.hypot(g.run, g.rise) / 2 + 0.15,
        });
        c.setTranslationWrtParent({
          x: (bank.from[0] + bank.to[0]) / 2,
          y: (bank.from[1] + bank.to[1]) / 2 + 0.06 - Math.cos(g.slope) * 0.15,
          z: (bank.from[2] + bank.to[2]) / 2,
        });
        c.setRotationWrtParent(bankQuaternion);
      }
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
      bankVersions.current = [-1, -1];
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
    if (state?.kind === "weave")
      runtime.weave?.banks.forEach((bank, i) => {
        if (bankPoses.current[i]?.source !== bank)
          bankPoses.current[i] = {
            source: bank,
            poses: Array.from({ length: 256 }, (_, index) =>
              weavePose(bank, index),
            ),
            yaw: bankGeometry(bank).yaw,
          };
      });
    for (let i = 0; i < MATTER_COUNT; i++) {
      const j = i * 6;
      const bankIndex = Math.floor(i / 256);
      const bank =
        state?.kind === "weave" ? runtime.weave?.banks[bankIndex] : null;
      if (bank && bankVersions.current[bankIndex] !== bank.version) {
        origin.set(
          live.subarray(bankIndex * 256 * 6, (bankIndex + 1) * 256 * 6),
          bankIndex * 256 * 6,
        );
        bankVersions.current[bankIndex] = bank.version;
      }
      const t =
        bank && bank.version > 0
          ? weaveBlend(runtime.time, bank.since)
          : smooth((elapsed - ((i % 32) / 32) * 0.35) / (duration - 0.4));
      const pose = bank
        ? bankPoses.current[bankIndex]!.poses[i % 256]
        : state
          ? poses[index!][state.kind][i]
          : null;
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
        arc * 0.8 +
          (bank
            ? bankPoses.current[bankIndex]!.yaw * t
            : !state
              ? Math.sin(runtime.time * 0.5 + i / 64) * 0.06
              : 0),
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
    // While crossing, only an unoccupied half may be reallocated. No shore trigger or
    // inferred intent here: every continuation is passed through the selected source.
    if (
      state?.kind === "weave" &&
      state.phase === "active" &&
      runtime.weave &&
      runtime.grounded &&
      !onPermanentGround(p)
    ) {
      const weave = runtime.weave;
      const options = weaveCandidates(weave, sites[index!], p, runtime.time);
      if (!options) return;
      const revision = runtime.revision,
        bankRevision = weave.revision;
      const requestGaze = runtime.history.at(-1)?.gaze;
      void runtime.gate
        .requestResult({
          observations: runtime.history.slice(),
          objective: DESTINATION,
          candidates: options.candidates,
          current: { candidateId: runtime.activeCandidateId!, phase: "active" },
          assistance: runtime.assistance.slice(),
        })
        .then((result) => {
          if (
            !result.valid ||
            !result.candidate?.route ||
            runtime.disposed ||
            useGame.getState().phase !== "playing" ||
            !runtime.grounded ||
            runtime.revision !== revision ||
            weave.revision !== bankRevision
          )
            return;
          const fresh = weaveCandidates(
            weave,
            sites[index!],
            runtime.player,
            runtime.time,
          );
          if (
            !fresh ||
            fresh.bank !== options.bank ||
            fresh.segment !== options.segment ||
            !fresh.candidates.some((c) => c.id === result.candidate!.id)
          )
            return;
          const gaze = runtime.history.at(-1)?.gaze;
          if (
            requestGaze &&
            gaze &&
            requestGaze.reduce((dot, v, a) => dot + v * gaze[a], 0) < 0.5
          )
            return;
          applyWeave(
            weave,
            fresh.bank,
            fresh.segment,
            result.candidate.route,
            runtime.time,
          );
          runtime.activeCandidateId = result.candidate.id;
          runtime.assistance.push({
            time: runtime.time,
            candidateId: result.candidate.id,
            outcome: "used",
          });
          if (runtime.assistance.length > 24) runtime.assistance.shift();
          sound.transform();
        });
      return;
    }
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
              candidateId:
                runtime.activeCandidateId ??
                `${sites[index!].id}:${state.kind}`,
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
          choice.kind === state.kind &&
          (state.kind !== "weave" ||
            runtime.weave?.banks.some(
              (b) =>
                b.segment ===
                (Math.hypot(
                  p[0] - runtime.weave!.route[0][0],
                  p[2] - runtime.weave!.route[0][2],
                ) <
                Math.hypot(
                  p[0] - runtime.weave!.route[4][0],
                  p[2] - runtime.weave!.route[4][2],
                )
                  ? 0
                  : 3),
            ))
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
          runtime.weave = null;
          runtime.activeCandidateId = null;
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
            choice.route,
            choice.id,
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
        {[0, 1].map((i) => (
          <CuboidCollider
            key={`weave-${i}`}
            ref={(c) => {
              weaveColliders.current[i] = c;
            }}
            args={[2.4, 0.15, 3]}
          />
        ))}
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
