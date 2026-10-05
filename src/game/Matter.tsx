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
  Matrix4,
  Vector3,
  Quaternion,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  FORMATION_SECONDS,
  MATTER_COUNT,
  WEAVE_END_CAP,
  collisionBoxes,
  formationPose,
  platformOffset,
  PLATFORM_HALF_CYCLE_SECONDS,
  sites,
  supportHeight,
  boxCoordinates,
  PLAYER_RADIUS,
} from "./world";
import { assemblyProgress, angleBlend, assemblySupportsPlayer, assemblyDetour, type AssemblyContact } from "./assembly";
import { formMatter, semanticSnapshot, currentObservation, decisionObservations, type Runtime } from "./runtime";
import { availableCandidates, onPermanentGround } from "./affordances";
import { sound } from "./audio";
import { reportDecisionOutcome } from "./decision-audit-client";
import { decisionMotionCurrent, samePhysicalCandidate, type DecisionMotionEvidence } from "./decision-freshness";
import { useGame } from "./store";
import {
  applyWeave,
  applySteeringCandidate,
  bankGeometry,
  bankProgress,
  weaveCandidates,
  weavePose,
  weaveServesRoute,
  WEAVE_SECONDS,
  type WeaveBank,
} from "./weave";

export function Matter({ runtime }: { runtime: Runtime }) {
  const night = useGame(s => s.night);
  const mesh = useRef<InstancedMesh>(null),
    body = useRef<RapierRigidBody>(null);
  const colliders = useRef<(RapierCollider | null)[]>([]);
  const weaveColliders = useRef<(RapierCollider | null)[]>([]);
  const colliderBanks = useRef<(WeaveBank | null)[]>([null, null]);
  const bankVersions = useRef([-1, -1]);
  const landingContacts = useRef(new Map<number, AssemblyContact & { since: number }>());
  const bankPoses = useRef<
    ({
      source: WeaveBank;
      poses: ReturnType<typeof weavePose>[];
      yaw: number;
    } | null)[]
  >([null, null]);
  const bankQuaternion = useMemo(() => new Quaternion(), []);
  const bankMatrix = useMemo(() => new Matrix4(), []);
  const bankNormal = useMemo(() => new Vector3(), []);
  const bankBack = useMemo(() => new Vector3(), []);
  const bankRight = useMemo(() => new Vector3(), []);
  const nextCheck = useRef(0),
    seenRevision = useRef(-1),
    transitionStart = useRef(0);
  const dummy = useMemo(() => new Object3D(), []);
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.045), []);
  const live = useMemo(() => new Float32Array(MATTER_COUNT * 6), []);
  const origin = useMemo(() => new Float32Array(MATTER_COUNT * 6), []);
  const rotation = useMemo(() => new Float32Array(MATTER_COUNT * 3), []);
  const originRotation = useMemo(() => new Float32Array(MATTER_COUNT * 3), []);
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
          0.105 + Math.sin(i * 23.7) * 0.004,
          0.24,
          0.62 + (i % 7) * 0.008,
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
                (state.reverse ? PLATFORM_HALF_CYCLE_SECONDS : 0),
            )
          : [0, 0, 0];
      if (state.phase === "forming") state.previousOffset = [...state.offset];
    }
    runtime.solidColliderHandles.clear();
    const admit = (c: RapierCollider, top: number, forming: boolean, since: number, within: boolean) => {
      if (!forming) { landingContacts.current.delete(c.handle); return true; }
      if (!within) return false;
      let contact = landingContacts.current.get(c.handle);
      if (!contact || contact.since !== since) {
        contact = { since, above: false, landed: false };
        landingContacts.current.set(c.handle, contact);
      }
      return assemblySupportsPlayer(top, runtime, contact);
    };
    colliders.current.forEach((c, i) => {
      if (!c) return;
      runtime.matterColliderHandles.add(c.handle);
      const point = state ? [runtime.player[0] - state.offset[0], runtime.player[1], runtime.player[2] - state.offset[2]] as const : runtime.player;
      const top = supportHeight(boxes[i], [...point]);
      const local = boxCoordinates([point[0], top, point[2]], boxes[i]);
      const enabled =
        (state?.phase === "active" || state?.phase === "forming") &&
        state.kind !== "weave" &&
        boxes[i].index === index &&
        boxes[i].kind === state.kind &&
        admit(c, top + state.offset[1], state.phase === "forming", state.since,
          Math.abs(local[0]) <= boxes[i].size[0] / 2 + PLAYER_RADIUS && Math.abs(local[2]) <= boxes[i].size[2] / 2 + PLAYER_RADIUS);
      c.setEnabled(enabled);
      if (enabled) runtime.solidColliderHandles.add(c.handle);
    });
    weaveColliders.current.forEach((c, i) => {
      if (!c) return;
      runtime.matterColliderHandles.add(c.handle);
      const bank = state?.kind === "weave" ? runtime.weave?.banks[i] : null;
      const progress = bank ? bankProgress(bank, runtime.player) : null;
      const enabled =
        !!bank &&
        (state?.phase === "active" || state?.phase === "forming") &&
        admit(c, progress!.top, state.phase === "forming" || runtime.time - bank.since < WEAVE_SECONDS, bank.since,
          progress!.across <= 2.4 + PLAYER_RADIUS && progress!.t >= -0.05 && progress!.t <= 1.05);
      c.setEnabled(enabled);
      if (bank && colliderBanks.current[i] !== bank) {
        const g = bankGeometry(bank);
        const alongSlope = g.rise / g.run, crossSlope = bank.crossSlope ?? 0;
        const ux = g.dx / g.run, uz = g.dz / g.run;
        bankNormal.set(-ux * alongSlope + uz * crossSlope, 1, -uz * alongSlope - ux * crossSlope).normalize();
        bankBack.set(-ux, -alongSlope, -uz).normalize();
        bankRight.crossVectors(bankNormal, bankBack).normalize();
        bankQuaternion.setFromRotationMatrix(bankMatrix.makeBasis(bankRight, bankNormal, bankBack));
        c.setHalfExtents({
          x: 2.4 * Math.sqrt(1 + crossSlope ** 2 / (1 + alongSlope ** 2)),
          y: 0.15,
          z: Math.hypot(g.run, g.rise) / 2 + WEAVE_END_CAP,
        });
        c.setTranslationWrtParent({
          x: (bank.from[0] + bank.to[0]) / 2 - bankNormal.x * 0.15,
          y: (bank.from[1] + bank.to[1]) / 2 + 0.06 - bankNormal.y * 0.15,
          z: (bank.from[2] + bank.to[2]) / 2 - bankNormal.z * 0.15,
        });
        c.setRotationWrtParent(bankQuaternion);
        colliderBanks.current[i] = bank;
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
      originRotation.set(rotation);
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
        originRotation.set(rotation.subarray(bankIndex * 256 * 3, (bankIndex + 1) * 256 * 3), bankIndex * 256 * 3);
        bankVersions.current[bankIndex] = bank.version;
      }
      const recycled = !!bank && bank.version > 0;
      const ready = !state || (state.phase === "active" && (!bank || runtime.time - bank.since >= WEAVE_SECONDS));
      const t = assemblyProgress(recycled ? runtime.time - bank.since : elapsed, recycled ? WEAVE_SECONDS : duration, i, ready);
      const pose = bank
        ? bankPoses.current[bankIndex]!.poses[i % 256]
        : state
          ? poses[index!][state.kind][i]
          : null;
      const wave =
        Math.sin(runtime.time * 0.8 + Math.floor(i / 64) * 0.3) * 0.055;
      const arc = Math.sin(t * Math.PI);
      for (let a = 0; a < 6; a++) {
        const target = pose ? (a < 3 ? pose.position[a] + state!.offset[a] : pose.scale[a - 3])
          : a >= 3 ? 0.32 : companion[a] + (a === 0 ? ((i % 8) - 3.5) * 0.36
            : a === 1 ? (Math.floor(i / 64) - 3.5) * 0.36 + wave
            : ((Math.floor(i / 8) % 8) - 3.5) * 0.36);
        live[j + a] = origin[j + a] + (target - origin[j + a]) * t;
      }
      live[j + 1] += arc * (2.5 + (i % 8) * 0.12);
      const detour = assemblyDetour(live[j], live[j + 1], live[j + 2], p, t, i);
      dummy.position.set(detour[0], detour[1], detour[2]);
      dummy.scale.set(live[j + 3], live[j + 4], live[j + 5]);
      const r = i * 3;
      rotation[r] = originRotation[r] * (1 - t) + arc * Math.sin(i) * 0.45;
      rotation[r + 1] = angleBlend(originRotation[r + 1], bank ? bankPoses.current[bankIndex]!.yaw : !state ? Math.sin(runtime.time * 0.5 + i / 64) * 0.06 : pose?.yaw ?? 0, t) + arc * 0.8;
      rotation[r + 2] = originRotation[r + 2] * (1 - t) + arc * Math.cos(i) * 0.3;
      dummy.rotation.set(rotation[r], rotation[r + 1], rotation[r + 2]);
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
    // No replacement can be useful while its support is still assembling.
    if (state?.phase === "forming") {
      runtime.diagnostics.decision = { reason: "matter_forming", time: runtime.time };
      return;
    }
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
      const observation = currentObservation(runtime);
      const travel = observation && Math.hypot(observation.velocity[0],observation.velocity[2]) > 0.6 ? observation.velocity : observation?.gaze;
      const options = weaveCandidates(weave, sites[index!], p, runtime.time, travel);
      runtime.diagnostics.decision = {
        reason: options ? "weave_candidates" : "no_recyclable_weave_section",
        time: runtime.time,
        candidateCount: options?.candidates.length ?? 0,
        player: [...p],
        banks: weave.banks.map(bank => ({
          segment: bank.segment,
          ready: runtime.time - bank.since >= WEAVE_SECONDS,
          ...bankProgress(bank, p),
        })),
      };
      if (!options) return;
      const revision = runtime.revision,
        bankRevision = weave.revision;
      const semantic = semanticSnapshot(runtime);
      if (!semantic) return;
      const requestObservation = currentObservation(runtime);
      const recoveries = runtime.recoveries;
      void runtime.gate
        .requestResult({
          sessionId: runtime.sessionId,
          observations: decisionObservations(runtime),
          semantic,
          candidates: options.candidates,
          current: { candidateId: runtime.activeCandidateId!, phase: "active" },
          assistance: runtime.assistance.slice(),
        })
        .then((result) => {
          let outcome: "applied" | "held" | "discarded" = result.gateStatus === "hold" ? "held" : "discarded";
          let reason = result.gateStatus ?? "state_or_geometry_changed";
          let freshness: DecisionMotionEvidence | undefined;
          try {
          if (
            !result.valid ||
            !result.candidate ||
            (!result.candidate.route && result.candidate.weaveSegment === undefined) ||
            runtime.disposed ||
            useGame.getState().phase !== "playing" ||
            !runtime.grounded ||
            runtime.revision !== revision ||
            weave.revision !== bankRevision
          ) {
            reason = !runtime.grounded ? "player_airborne" : runtime.revision !== revision ? "matter_replaced" : weave.revision !== bankRevision ? "continuation_replaced" : runtime.disposed || useGame.getState().phase !== "playing" ? "run_inactive" : result.gateStatus ?? "invalid_candidate";
            return;
          }
          const responseObservation = currentObservation(runtime);
          if (runtime.recoveries !== recoveries || !decisionMotionCurrent(requestObservation, responseObservation, result.candidate ?? undefined)) {
            reason = runtime.recoveries !== recoveries ? "player_recovered" : "behavior_changed";
            freshness = { before: requestObservation, after: responseObservation };
            return;
          }
          const fresh = weaveCandidates(
            weave,
            sites[index!],
            runtime.player,
            runtime.time,
            travel,
          );
          if (
            !fresh ||
            fresh.bank !== options.bank ||
            !fresh.candidates.some((c) => samePhysicalCandidate(result.candidate!, c))
          ) {
            reason = !fresh ? "no_recyclable_section" : fresh.bank !== options.bank ? "reusable_section_changed" : "candidate_geometry_changed";
            return;
          }
          if (result.candidate.weaveSegment !== undefined) applySteeringCandidate(weave, fresh.bank, result.candidate, runtime.time);
          else applyWeave(
            weave,
            fresh.bank,
            fresh.segment,
            result.candidate.route!,
            runtime.time,
          );
          runtime.activeCandidateId = result.candidate.id;
          runtime.gate.commit(result.candidate.id, currentObservation(runtime));
          runtime.physicalHistory.clear();
          runtime.assistance.push({
            time: runtime.time,
            candidateId: result.candidate.id,
            outcome: "used",
          });
          if (runtime.assistance.length > 24) runtime.assistance.shift();
          sound.transform();
          outcome = "applied";
          reason = "recycled_unoccupied_section";
          } finally {
            reportDecisionOutcome(runtime.sessionId, result.auditId, result.browserRoundTripMs, outcome, reason, freshness);
          }
        });
      return;
    }
    // Only the engine's support/geometry checks constrain a decision. Behavior belongs to the source.
    if (!runtime.grounded || !onPermanentGround(p)) {
      runtime.diagnostics.decision = { reason: runtime.grounded ? "not_on_ground_or_weave" : "airborne", time: runtime.time, player: [...p] };
      return;
    }
    if (state && runtime.manualFormation) {
      const site = sites[index!];
      const reachedOtherShore = state.reverse
        ? p[2] > site.start[2] + 4
        : p[2] < site.end[2] - 4;
      if (!reachedOtherShore) return;
    }
    const candidates = availableCandidates(p),
      revision = runtime.revision;
    runtime.diagnostics.decision = { reason: candidates.length ? "ground_candidates" : "no_ground_candidates", time: runtime.time, candidateCount: candidates.length, player: [...p] };
    if (!candidates.length) return;
    const semantic = semanticSnapshot(runtime);
    if (!semantic) return;
    if (state && semantic.matter_now.player_supported_by_matter) return;
    const requestObservation = currentObservation(runtime);
    const recoveries = runtime.recoveries;
    void runtime.gate
      .requestResult({
        sessionId: runtime.sessionId,
        observations: decisionObservations(runtime),
        semantic,
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
        let outcome: "applied" | "retracted" | "held" | "discarded" = result.gateStatus === "hold" ? "held" : "discarded";
        let reason = result.gateStatus ?? "state_or_geometry_changed";
        let freshness: DecisionMotionEvidence | undefined;
        try {
        if (
          !result.valid ||
          runtime.disposed ||
          useGame.getState().phase !== "playing" ||
          runtime.revision !== revision ||
          !runtime.grounded ||
          !onPermanentGround(runtime.player) ||
          (state && semanticSnapshot(runtime)?.matter_now.player_supported_by_matter)
        ) {
          reason = !runtime.grounded ? "player_airborne" : !onPermanentGround(runtime.player) ? "player_left_ground" : runtime.revision !== revision ? "matter_replaced" : runtime.disposed || useGame.getState().phase !== "playing" ? "run_inactive" : result.gateStatus ?? "player_on_matter";
          return;
        }
        const responseObservation = currentObservation(runtime);
        if (runtime.recoveries !== recoveries || !decisionMotionCurrent(requestObservation, responseObservation, result.candidate ?? undefined)) {
          reason = runtime.recoveries !== recoveries ? "player_recovered" : "behavior_changed";
          freshness = { before: requestObservation, after: responseObservation };
          return;
        }
        const choice = result.candidate;
        const valid = choice
          ? availableCandidates(runtime.player).find((c) => c.id === choice.id)
          : null;
        if (choice && (!valid || !samePhysicalCandidate(choice, valid))) { reason = "candidate_geometry_changed"; return; }
        if (
          state &&
          choice?.siteId === sites[index!].id &&
          choice.kind === state.kind &&
          (state.kind !== "weave" ||
            (runtime.weave && weaveServesRoute(runtime.weave, choice)))
        )
        {
          outcome = "held";
          reason = "existing_form_sufficient";
          if (runtime.activeCandidateId) runtime.gate.commit(runtime.activeCandidateId, currentObservation(runtime));
          return;
        }
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
          outcome = "retracted";
          reason = "assistance_retracted";
        }
        if (choice && valid) {
          const i = sites.findIndex((s) => s.id === choice.siteId);
          formMatter(
            runtime,
            i,
            choice.kind,
            valid.physical!.from[2] === sites[i].end[2],
            choice.route,
            choice.id,
          );
          sound.transform();
          outcome = "applied";
          reason = "form_created";
        }
        if (!choice && !state && result.valid) {
          outcome = "held";
          reason = "no_intervention";
        }
        } finally {
          reportDecisionOutcome(runtime.sessionId, result.auditId, result.browserRoundTripMs, outcome, reason, freshness);
        }
      });
  });
  return (
    <>
      <instancedMesh
        name="living-matter"
        ref={mesh}
        args={[geometry, undefined, MATTER_COUNT]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <meshStandardMaterial
          color="#f0ddad"
          metalness={0.48}
          roughness={0.36}
          emissive="#b29b68"
          emissiveIntensity={night ? 0.18 : 0.025}
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
