import type { FormationKind, Vec3 } from "./world";

export type Observation = {
  time: number;
  position: Vec3;
  velocity: Vec3;
  gaze: Vec3;
  grounded: boolean;
  activeStructure: string | null;
};
export type Candidate = {
  id: string;
  siteId: string;
  kind: FormationKind;
  physical?: {
    from: Vec3;
    to: Vec3;
    distance: number;
    span: number;
    rise: number;
    medium: "air" | "water";
  };
};
export type DecisionContext = {
  observations: readonly Observation[];
  candidates: readonly Candidate[];
  generation: number;
  objective?: Vec3;
  current?: { candidateId: string; phase: string };
  assistance?: readonly {
    time: number;
    candidateId: string;
    outcome: "offered" | "used" | "abandoned";
  }[];
};
export type Intervention = { candidateId: string | null };
/** Selection is asynchronous; geometry, validation and execution remain in the engine. */
export interface DecisionSource {
  select(context: DecisionContext, signal: AbortSignal): Promise<Intervention>;
  reset?(): void;
}

/** Disposable behavior policy. No stage names, ordering, progression or geometry construction. */
export class ScenarioDecisions implements DecisionSource {
  async select(
    { candidates, observations }: DecisionContext,
    signal: AbortSignal,
  ): Promise<Intervention> {
    if (signal.aborted) return { candidateId: null };
    const latest = observations.at(-1);
    if (!latest || !candidates.some((c) => c.physical))
      return { candidateId: candidates[0]?.id ?? null };
    let best: Candidate | null = null,
      score = -Infinity;
    for (const candidate of candidates) {
      const p = candidate.physical;
      if (!p) continue;
      const dx = p.to[0] - latest.position[0],
        dz = p.to[2] - latest.position[2],
        length = Math.hypot(dx, dz) || 1;
      const gaze = (latest.gaze[0] * dx + latest.gaze[2] * dz) / length;
      const travel =
        (latest.velocity[0] * dx + latest.velocity[2] * dz) / length;
      // Looking away and retreating can mean no help. Waiting and looking across can mean help.
      if (gaze < 0.15 && travel < 0.3) continue;
      const jumping = observations.slice(-10).some((o) => o.velocity[1] > 2);
      const preferred =
        p.medium === "water"
          ? "floating-path"
          : Math.abs(p.rise) > 1
            ? jumping
              ? "platform"
              : "stairs"
            : p.span > 21
              ? "platform"
              : "bridge";
      const rank =
        gaze * 4 +
        Math.max(-2, travel) -
        p.distance * 0.12 +
        (candidate.kind === preferred ? 2 : 0);
      if (rank > score || (rank === score && candidate.id < (best?.id ?? ""))) {
        best = candidate;
        score = rank;
      }
    }
    return { candidateId: best?.id ?? null };
  }
}

/** Late, invalid, rejected or failed decisions never mutate the simulation. */
export class DecisionGate {
  private pending: AbortController | null = null;
  private generation = 0;
  constructor(
    private source: DecisionSource,
    private deadlineMs = 2000,
  ) {}
  reset() {
    this.generation++;
    this.pending?.abort();
    this.pending = null;
    this.source.reset?.();
  }
  async request(
    context: Omit<DecisionContext, "generation">,
  ): Promise<Candidate | null> {
    return (await this.requestResult(context)).candidate;
  }
  async requestResult(
    context: Omit<DecisionContext, "generation">,
  ): Promise<{ valid: boolean; candidate: Candidate | null }> {
    if (this.pending) return { valid: false, candidate: null };
    const controller = new AbortController(),
      generation = this.generation;
    this.pending = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const decision = await Promise.race([
        this.source.select({ ...context, generation }, controller.signal),
        new Promise<Intervention>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ candidateId: null });
          }, this.deadlineMs);
        }),
      ]);
      if (controller.signal.aborted || generation !== this.generation)
        return { valid: false, candidate: null };
      const candidate =
        context.candidates.find((c) => c.id === decision.candidateId) ?? null;
      return {
        valid: decision.candidateId === null || candidate !== null,
        candidate,
      };
    } catch {
      return { valid: false, candidate: null };
    } finally {
      clearTimeout(timer);
      if (this.pending === controller) this.pending = null;
    }
  }
}
