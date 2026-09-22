import {
  ScenarioDecisions,
  type DecisionContext,
  type DecisionSource,
  type Intervention,
} from "./decisions";

export const decisionBackend =
  process.env.NEXT_PUBLIC_DECISION_BACKEND === "jev" ? "jev" : "preview";

/** Browser transport only. The SDK and credentials stay on the server. */
export class JevDecisions implements DecisionSource {
  private nextRequest = 0;
  private signature = "";
  private cached: Intervention | null = null;
  private expires = 0;
  private failures = 0;
  private epoch = 0;
  reset() {
    this.epoch++;
    this.cached = null;
    this.signature = "";
  }
  async select(
    context: DecisionContext,
    signal: AbortSignal,
  ): Promise<Intervention> {
    if (!context.candidates.length) return { candidateId: null };
    const latest = context.observations.at(-1);
    if (!latest) return { candidateId: null };
    const signature = JSON.stringify({
      candidates: context.candidates.map((c) => ({
        id: c.id,
        route: c.route,
        from: c.physical?.from,
        to: c.physical?.to,
      })),
      p: latest?.position.map((v) => Math.round(v / 2)),
      v: latest?.velocity.map((v) => Math.round(v)),
      g: latest?.gaze.map((v) => Math.round(v * 3)),
      grounded: latest?.grounded,
      recentlyAirborne: context.observations
        .slice(-10)
        .some((o) => !o.grounded),
      current: context.current,
    });
    const now = performance.now();
    if (signature === this.signature && this.cached && now < this.expires)
      return this.cached;
    // A cooldown is unavailable, never an instruction to withdraw support.
    if (now < this.nextRequest) throw new Error("Decision cooldown");
    this.nextRequest = now + 1500;
    const epoch = this.epoch;
    try {
      const response = await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
        signal,
      });
      if (!response.ok) throw new Error(`Decision service ${response.status}`);
      const result: Intervention = await response.json();
      signal.throwIfAborted();
      if (epoch !== this.epoch) throw new Error("Obsolete decision");
      if (
        result.candidateId !== null &&
        !context.candidates.some((c) => c.id === result.candidateId)
      )
        throw new Error("Invalid decision");
      this.cached = result;
      this.signature = signature;
      this.expires =
        performance.now() +
        Math.min(6000, Math.max(1500, result.recheckAfterMs ?? 2000));
      this.failures = 0;
      return result;
    } catch (error) {
      if (!signal.aborted) {
        this.failures++;
        this.nextRequest =
          performance.now() + Math.min(30000, 2000 * 2 ** this.failures);
        console.warn(
          "Live decisions unavailable; existing support is held. Check the server configuration.",
        );
      }
      throw error;
    }
  }
}

export function createDecisionSource(): DecisionSource {
  return decisionBackend === "jev"
    ? new JevDecisions()
    : new ScenarioDecisions();
}
