import { TypeSafeClient, type Question, type SystemOneResult } from "@typesafe-ai/sdk";
import {
  buildDecisionRequest,
  composeDecision,
  decisionSchema,
} from "@/server/decision-request";
import { beginJevCall, completeJevCall } from "@/server/jev-audit";
import { decisionAuditEnabled } from "@/game/decision-audit-mode";
import { decisionOriginAllowed } from "@/server/decision-origin";
import { reserveDecision } from "@/server/decision-budget";
import { boundedBody, BodyError } from "@/server/bounded-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
let client: TypeSafeClient | undefined;
let inFlight = 0;
let windowStart = 0;
let requests = 0;
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_DECISION_BACKEND !== "jev")
    return reply({ error: "Live backend disabled" }, 409);
  if (!process.env.TYPESAFE_API_KEY)
    return reply({ error: "Set TYPESAFE_API_KEY on the server" }, 503);
  if (!decisionOriginAllowed(request))
    return reply({ error: "Origin rejected" }, 403);
  if (Date.now() - windowStart > 60000) {
    requests = 0;
    windowStart = Date.now();
  }
  if (inFlight >= 4 || requests >= 120)
    return reply({ error: "Decision budget reached" }, 429);
  let parsed;
  try {
    parsed = decisionSchema.safeParse(JSON.parse(await boundedBody(request)));
  } catch (error) {
    return reply({ error: "Invalid request body" }, error instanceof BodyError ? error.status : 400);
  }
  if (!parsed.success) return reply({ error: "Invalid physical state" }, 400);
  if (inFlight >= 4 || requests >= 120)
    return reply({ error: "Decision budget reached" }, 429);
  inFlight++;
  requests++;
  try {
    try {
      if (!await reserveDecision(request, parsed.data.sessionId))
        return reply({ error: "Decision budget reached" }, 429);
    } catch { return reply({ error: "Decision budget unavailable" }, 503); }
    const jevRequest = buildDecisionRequest(parsed.data);
    const requestedModel = process.env.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-latest";
    const auditEnabled = decisionAuditEnabled();
    let auditCall: Awaited<ReturnType<typeof beginJevCall>> | undefined;
    if (auditEnabled) {
      try {
        auditCall = await beginJevCall(parsed.data.sessionId, { model: requestedModel, ...jevRequest }, parsed.data);
      } catch {
        console.warn("[decisions] Audit storage unavailable; no Jev request was sent.");
        return reply({ error: "Decision audit unavailable" }, 503);
      }
    }
    let response: SystemOneResult<Record<string, Question>> | undefined;
    let decision: ReturnType<typeof composeDecision> | undefined;
    let failure: unknown;
    let providerRequestId: string | undefined;
    const providerStarted = performance.now();
    try {
      client ??= new TypeSafeClient({
        timeout: 1600,
        retry: { maxRetries: 0 },
        logLevel: "off",
      });
      const result = await client.systemOne({ model: requestedModel, ...jevRequest }, { signal: request.signal }).withResponse();
      response = result.data;
      providerRequestId = result.requestId;
      decision = composeDecision(parsed.data, response.answers);
    } catch (error) {
      failure = error;
    }
    if (auditCall) {
      await completeJevCall(auditCall, {
        providerRoundTripMs: performance.now() - providerStarted,
        providerRequestId,
        response: response as unknown as Record<string, unknown> | undefined,
        decision,
        ...(failure ? { error: {
          name: failure instanceof Error ? failure.name : "UnknownError",
          status: typeof failure === "object" && failure && "status" in failure ? failure.status : null,
          provider_request_id: providerRequestId ?? (typeof failure === "object" && failure && "requestId" in failure ? failure.requestId : null),
        } } : {}),
      }).catch(() => {
        console.warn("[decisions] Jev answered but the audit could not be completed.");
        throw new Error("Decision audit unavailable");
      });
    }
    if (failure || !response || !decision) {
      console.warn("[decisions] Provider unavailable; verify key, model, quota and connectivity.");
      return reply({ error: "Decision provider unavailable" }, 502);
    }
    if (auditCall)
      console.info("[decisions]", {
        model: response.model,
        usage: response.usage,
        decision,
        judgments: response.answers,
        auditId: auditCall.callId,
      });
    return reply(auditCall ? { ...decision, auditId: auditCall.callId } : decision);
  } catch {
    // Never return a fabricated model decision, or leak SDK request headers/errors.
    console.warn(
      "[decisions] Provider unavailable; verify key, model, quota and connectivity.",
    );
    return reply({ error: "Decision provider unavailable" }, 502);
  } finally {
    inFlight--;
  }
}
