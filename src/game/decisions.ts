import type { FormationKind, Vec3 } from "./world";
import type { SemanticState } from "./semantic";

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
  route?: Vec3[];
  weaveSegment?: number;
  attachment?: "near end" | "far end" | "middle";
  turnDegrees?: number;
  crossSlope?: number;
  physical?: {
    from: Vec3;
    to: Vec3;
    distance: number;
    span: number;
    rise: number;
    medium: "air" | "water";
    landing?: boolean;
  };
};
export type DecisionContext = {
  sessionId?: string;
  observations: readonly Observation[];
  semantic?: SemanticState;
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
export type Intervention = {
  candidateId: string | null;
  hold?: boolean;
  recheckAfterMs?: number;
  auditId?: string;
  browserRoundTripMs?: number;
};
/** Selection is asynchronous; geometry, validation and execution remain in the engine. */
export interface DecisionSource {
  select(context: DecisionContext, signal: AbortSignal): Promise<Intervention>;
  reset?(): void;
}

/** Disposable behavior policy. No stage names, ordering, progression or geometry construction. */
export class ScenarioDecisions implements DecisionSource {
  async select(
    { candidates, observations, semantic, current }: DecisionContext,
    signal: AbortSignal,
  ): Promise<Intervention> {
    if (signal.aborted) return { candidateId: null };
    if (current?.phase === "forming") return { candidateId: null, hold: true };
    const latest = observations.at(-1);
    if (semantic?.player_now.support === "permanent ground" &&
      ["walkable ground", "living matter"].includes(semantic.player_now.facing_into ?? "") &&
      !semantic.player_now.motion.includes("behind"))
      return { candidateId: null, hold: true };
    if (semantic?.matter_now.player_supported_by_matter) {
      const now = semantic.player_now;
      const continuing = now.motion === "standing" || ["walking forward", "running forward"].includes(now.motion);
      // A usable next half is a commitment, including at the occupied half's tip.
      // Glancing up/down or a few degrees aside must not pull it out from under
      // the approaching player. Sideways/backward motion and a deliberate turn
      // toward open space can still ask for a different contribution.
      if (continuing && (["living matter", "walkable ground"].includes(now.facing_into ?? "") ||
        semantic.matter_now.reusable_section_relative_to_player === "ahead"))
        return { candidateId: null, hold: true };
    }
    if (!latest || !candidates.some((c) => c.physical))
      return { candidateId: candidates[0]?.id ?? null };
    let best: Candidate | null = null,
      score = -Infinity;
    const recent = observations.filter(o => latest.time - o.time >= 0 && latest.time - o.time <= 0.6);
    const jumping = recent.some(o => o.velocity[1] > 2);
    const gazeLength = Math.hypot(latest.gaze[0], latest.gaze[2]) || 1;
    const speed = Math.hypot(latest.velocity[0], latest.velocity[2]);
    const moving = speed > 0.6;
    const surface = semantic?.player_now.surface_beyond_facing ?? "";
    const desiredRise = surface.endsWith("higher") || latest.gaze[1] > 0.15 ? 1.5 :
      surface.endsWith("lower") || latest.gaze[1] < -0.15 ? -1.5 : 0;
    for (const candidate of candidates) {
      const p = candidate.physical;
      if (!p) continue;
      const aim = candidate.route && p.span > 14 ? candidate.route[1] : p.to;
      const dx = aim[0] - latest.position[0],
        dz = aim[2] - latest.position[2],
        length = Math.hypot(dx, dz) || 1;
      const gaze = (latest.gaze[0] * dx + latest.gaze[2] * dz) / (length * gazeLength);
      const travel =
        (latest.velocity[0] * dx + latest.velocity[2] * dz) / (length * Math.max(speed, 0.6));
      // Looking away and retreating can mean no help. Waiting and looking across can mean help.
      if (moving ? travel < 0.25 : gaze < 0.4) continue;
      // Walking follows travel, waiting follows gaze, and a recent jump can ask
      // for a ride across a rise. Physical slope/bank/attachment options supply
      // variety without a random reroll or knowledge of authored stage order.
      const preferred = jumping && Math.abs(p.rise) > 1 ? "platform" : "weave";
      const rank =
        gaze * (moving ? 1.5 : 4) +
        travel * (moving ? 4 : 0.5) -
        p.distance * 0.12 +
        (candidate.kind === preferred ? 3 : 0) -
        (candidate.weaveSegment !== undefined ? Math.abs(p.rise - desiredRise) * 0.4 : 0) +
        (p.landing ? 1.2 : 0) +
        (candidate.id === current?.candidateId ? 0.45 : 0);
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
  ): Promise<{ valid: boolean; candidate: Candidate | null; auditId?: string; browserRoundTripMs?: number; gateStatus?: "hold" | "stale" | "invalid" }> {
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
      const audit = {
        ...(decision.auditId ? { auditId: decision.auditId } : {}),
        ...(decision.browserRoundTripMs !== undefined ? { browserRoundTripMs: decision.browserRoundTripMs } : {}),
      };
      if (controller.signal.aborted || generation !== this.generation)
        return { valid: false, candidate: null, ...audit, gateStatus: "stale" };
      if (decision.hold) return { valid: false, candidate: null, ...audit, gateStatus: "hold" };
      const candidate =
        context.candidates.find((c) => c.id === decision.candidateId) ?? null;
      return {
        valid: decision.candidateId === null || candidate !== null,
        candidate,
        ...audit,
        ...(decision.candidateId !== null && candidate === null ? { gateStatus: "invalid" as const } : {}),
      };
    } catch {
      return { valid: false, candidate: null };
    } finally {
      clearTimeout(timer);
      if (this.pending === controller) this.pending = null;
    }
  }
}
