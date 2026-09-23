import {
  DecisionGate,
  type DecisionSource,
  type Observation,
} from "./decisions";
import { createDecisionSource } from "./decision-backend";
import { createWeave, weaveRoute, type Weave } from "./weave";
import { sites, SPAWN, type FormationKind, type Vec3 } from "./world";
import { PhysicalHistory, describeMatter, describePhysical, type PhysicalScene } from "./semantic";

export type MatterState = {
  kind: FormationKind;
  phase: "idle" | "forming" | "active" | "dissolving";
  since: number;
  rideSince: number;
  offset: Vec3;
  previousOffset: Vec3;
  reverse: boolean;
};
export function createRuntime(source: DecisionSource = createDecisionSource()) {
  return {
    sessionId: crypto.randomUUID(),
    time: 0,
    player: [...SPAWN] as Vec3,
    velocity: [0, 0, 0] as Vec3,
    grounded: false,
    checkpoint: [...SPAWN] as Vec3,
    recoveries: 0,
    recordedRecoveries: 0,
    gate: new DecisionGate(source),
    history: [] as Observation[],
    physicalHistory: new PhysicalHistory(),
    nextObservation: 0,
    activeSite: null as number | null,
    activeCandidateId: null as string | null,
    weave: null as Weave | null,
    revision: 0,
    manualFormation: false,
    companion: [-4, 2, -6] as Vec3,
    platformBodyHandle: null as number | null,
    matterColliderHandles: new Set<number>(),
    solidColliderHandles: new Set<number>(),
    assistance: [] as {
      time: number;
      candidateId: string;
      outcome: "offered" | "used" | "abandoned";
    }[],
    constellation: [] as Vec3[],
    states: sites.map(
      (s) =>
        ({
          kind: s.candidates[0],
          phase: "idle",
          since: 0,
          rideSince: 0,
          offset: [0, 0, 0],
          previousOffset: [0, 0, 0],
          reverse: false,
        }) as MatterState,
    ),
    forcedPosition: null as Vec3 | null,
    disposed: false,
    diagnostics: {} as Record<string, unknown>,
  };
}
export type Runtime = ReturnType<typeof createRuntime>;

export function physicalScene(runtime: Runtime): PhysicalScene {
  const activeSite = runtime.activeSite;
  const state = activeSite === null ? null : runtime.states[activeSite];
  return {
    time: runtime.time,
    activeSite,
    phase: state?.phase ?? "idle",
    kind: state?.kind,
    offset: state?.offset,
    weave: runtime.weave,
  };
}

export function semanticSnapshot(runtime: Runtime) {
  const current = runtime.history.at(-1);
  if (!current) return undefined;
  const scene = physicalScene(runtime);
  const player_now = describePhysical(current, scene);
  return {
    player_now,
    recent_behavior_oldest_to_newest: runtime.physicalHistory.snapshot(player_now),
    matter_now: describeMatter(current, scene),
  };
}

export function formMatter(
  runtime: Runtime,
  index: number,
  kind: FormationKind,
  reverse = false,
  route?: Vec3[],
  candidateId?: string,
) {
  runtime.gate.reset();
  runtime.states.forEach((s) => {
    s.phase = "idle";
  });
  const state = runtime.states[index];
  Object.assign(state, {
    kind,
    phase: "forming",
    since: runtime.time,
    reverse,
    offset: [0, 0, 0],
    previousOffset: [0, 0, 0],
  });
  runtime.manualFormation = false;
  runtime.activeSite = index;
  runtime.activeCandidateId = candidateId ?? `${sites[index].id}:${kind}`;
  runtime.weave =
    kind === "weave"
      ? createWeave(route ?? weaveRoute(sites[index], 0, reverse), runtime.time)
      : null;
  runtime.revision++;
  runtime.assistance.push({
    time: runtime.time,
    candidateId: `${sites[index].id}:${kind}`,
    outcome: "offered",
  });
  if (runtime.assistance.length > 24) runtime.assistance.shift();
}
