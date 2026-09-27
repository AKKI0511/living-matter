export function decisionAuditEnabled() {
  return process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DECISION_BACKEND === "jev" &&
    process.env.NEXT_PUBLIC_JEV_SESSION_AUDIT === "1";
}

/** Recorded development calls also persist their evidence before replying. */
export function decisionDeadlineMs() {
  return decisionAuditEnabled() ? 5000 : 2000;
}
