import { decisionAuditEnabled } from "./decision-audit-mode";

export function reportDecisionOutcome(
  sessionId: string,
  auditId: string | undefined,
  browserRoundTripMs: number | undefined,
  status: "applied" | "retracted" | "held" | "discarded",
  reason: string,
) {
  if (!decisionAuditEnabled() || !auditId) return;
  void fetch("/api/decision/outcome", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, auditId, browserRoundTripMs, status, reason }),
    keepalive: true,
  }).then((response) => {
    if (!response.ok) console.warn("Live decision outcome could not be audited.");
  }).catch(() => console.warn("Live decision outcome could not be audited."));
}
