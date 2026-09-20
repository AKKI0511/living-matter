import {
  DecisionGate,
  ScenarioDecisions,
  type DecisionSource,
  type Observation,
} from "./decisions";
import { sites, SPAWN, type FormationKind, type Vec3 } from "./world";

export type MatterState = {
  kind: FormationKind;
  phase: "idle" | "forming" | "active" | "dissolving";
  since: number;
  rideSince: number;
  offset: Vec3;
  previousOffset: Vec3;
};
export function createRuntime(
  source: DecisionSource = new ScenarioDecisions(),
) {
  return {
    time: 0,
    player: [...SPAWN] as Vec3,
    velocity: [0, 0, 0] as Vec3,
    grounded: false,
    checkpoint: [...SPAWN] as Vec3,
    recoveries: 0,
    gate: new DecisionGate(source),
    history: [] as Observation[],
    nextObservation: 0,
    states: sites.map(
      (s) =>
        ({
          kind: s.preferred,
          phase: "idle",
          since: 0,
          rideSince: 0,
          offset: [0, 0, 0],
          previousOffset: [0, 0, 0],
        }) as MatterState,
    ),
    forcedPosition: null as Vec3 | null,
    disposed: false,
    diagnostics: {} as Record<string, unknown>,
  };
}
export type Runtime = ReturnType<typeof createRuntime>;
