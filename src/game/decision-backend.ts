import {
  ScenarioDecisions,
  type DecisionContext,
  type DecisionSource,
  type Intervention,
} from "./decisions";
import { describeCandidate } from "./semantic";
import { currentDirectionServed, decisionState } from "./decision-state";
import { useGame } from "./store";

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
    if (currentDirectionServed(context.semantic)) return { candidateId: null, hold: true };
    const signature = JSON.stringify({
      semantic: context.semantic ? decisionState(context.semantic) : undefined,
      candidates: context.candidates.map((c) => ({
        id: c.id, route: c.route, from: c.physical?.from, to: c.physical?.to,
        meaning: c.physical ? describeCandidate(c, latest, !!context.semantic?.matter_now.player_supported_by_matter) : undefined,
      })),
      current: context.current,
    });
    const now = performance.now();
    if (signature === this.signature && this.cached && now < this.expires)
      return { ...this.cached, auditId: undefined };
    // A cooldown is unavailable, never an instruction to withdraw support.
    if (now < this.nextRequest) throw new Error("Decision cooldown");
    this.nextRequest = now + 1500;
    const epoch = this.epoch;
    try {
      const started = performance.now();
      const response = await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
        signal,
      });
      if (!response.ok) throw new Error(`Decision service ${response.status}`);
      const result: Intervention = { ...(await response.json()), browserRoundTripMs: performance.now() - started };
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
        // An unchanged hold needs less polling; new behavior or options changes the signature.
        (result.hold ? 8000 : Math.min(6000, Math.max(1500, result.recheckAfterMs ?? 2000)));
      this.failures = 0;
      if (useGame.getState().providerUnavailable) useGame.setState({ providerUnavailable: false });
      return result;
    } catch (error) {
      if (!signal.aborted) {
        if (!useGame.getState().providerUnavailable) useGame.setState({ providerUnavailable: true });
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
