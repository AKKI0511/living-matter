import type { FormationKind, Vec3 } from "./world";

export type Observation = {
  time: number;
  position: Vec3;
  velocity: Vec3;
  gaze: Vec3;
  grounded: boolean;
  activeStructure: string | null;
};
export type Candidate = { id: string; siteId: string; kind: FormationKind };
export type DecisionContext = {
  observations: readonly Observation[];
  candidates: readonly Candidate[];
  generation: number;
};
export type Intervention = { candidateId: string | null };
/** Selection is asynchronous; geometry, validation and execution remain in the engine. */
export interface DecisionSource {
  select(context: DecisionContext, signal: AbortSignal): Promise<Intervention>;
  reset?(): void;
}

/** Disposable scenario selector. Candidate ordering is supplied by the scenario. */
export class ScenarioDecisions implements DecisionSource {
  async select(
    { candidates }: DecisionContext,
    signal: AbortSignal,
  ): Promise<Intervention> {
    return { candidateId: signal.aborted ? null : (candidates[0]?.id ?? null) };
  }
}

/** Late, invalid, rejected or failed decisions never mutate the simulation. */
export class DecisionGate {
  private pending: AbortController | null = null;
  private generation = 0;
  constructor(private source: DecisionSource) {}
  reset() {
    this.generation++;
    this.pending?.abort();
    this.pending = null;
    this.source.reset?.();
  }
  async request(
    context: Omit<DecisionContext, "generation">,
  ): Promise<Candidate | null> {
    if (this.pending) return null;
    const controller = new AbortController(),
      generation = this.generation;
    this.pending = controller;
    try {
      const decision = await this.source.select(
        { ...context, generation },
        controller.signal,
      );
      if (controller.signal.aborted || generation !== this.generation)
        return null;
      return (
        context.candidates.find((c) => c.id === decision.candidateId) ?? null
      );
    } catch {
      return null;
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }
}
