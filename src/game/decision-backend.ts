import {
  ScenarioDecisions,
  type DecisionContext,
  type DecisionSource,
  type Intervention,
} from "./decisions";
import { describeCandidate } from "./semantic";
import { currentDirectionServed, decisionState } from "./decision-state";
import { useGame } from "./store";
import { decisionDeadlineMs } from "./decision-audit-mode";

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
  private preview = new ScenarioDecisions();
  constructor(private timeoutMs = decisionDeadlineMs() - 250) {}
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
    // Retry quietly in the background; cooldowns never withdraw support.
    if (now < this.nextRequest) return this.failures
      ? this.preview.select(context, signal)
      : { candidateId: null, hold: true };
    this.nextRequest = now + 1500;
    const epoch = this.epoch;
    const timeout = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryAfterMs = 0;
    try {
      const started = performance.now();
      const payload = await Promise.race([fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
        signal: AbortSignal.any([signal, timeout.signal]),
      }).then(async response => {
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) retryAfterMs = Math.max(0, Number.isFinite(Number(retryAfter))
          ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now());
        if (!response.ok) throw new Error(`Decision service ${response.status}`);
        return response.json();
      }), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timeout.abort();
          reject(new Error("Decision service timed out"));
        }, this.timeoutMs);
      })]);
      if (!payload || (payload.candidateId !== null && typeof payload.candidateId !== "string") ||
        (payload.hold !== undefined && typeof payload.hold !== "boolean") ||
        (payload.recheckAfterMs !== undefined && !Number.isFinite(payload.recheckAfterMs))) throw new Error("Invalid decision");
      const result: Intervention = { ...payload, browserRoundTripMs: performance.now() - started };
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
      if (!signal.aborted && epoch === this.epoch) {
        if (!useGame.getState().providerUnavailable) useGame.setState({ providerUnavailable: true });
        this.failures++;
        this.cached = null;
        this.nextRequest =
          performance.now() + Math.max(Math.min(30000, 2000 * 2 ** Math.min(this.failures, 4)), Math.min(3600000, retryAfterMs || 0));
        return this.preview.select(context, signal);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createDecisionSource(): DecisionSource {
  return decisionBackend === "jev"
    ? new JevDecisions()
    : new ScenarioDecisions();
}
