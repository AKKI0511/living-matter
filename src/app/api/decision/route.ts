import { TypeSafeClient, type Question, type SystemOneResult } from "@typesafe-ai/sdk";
import {
  buildDecisionRequest,
  composeDecision,
  decisionSchema,
} from "@/server/decision-request";
import { beginJevCall, completeJevCall } from "@/server/jev-audit";
import { decisionAuditEnabled } from "@/game/decision-audit-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return reply({ error: "Origin rejected" }, 403);
  if (Date.now() - windowStart > 60000) {
    requests = 0;
    windowStart = Date.now();
  }
  if (inFlight >= 4 || requests >= 120)
    return reply({ error: "Decision budget reached" }, 429);
  // Bound bytes before parsing, including chunked requests.
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "Missing state" }, 400);
  let body = "",
    bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 24000) {
      await reader.cancel();
      return reply({ error: "State too large" }, 413);
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  let parsed;
  try {
    parsed = decisionSchema.safeParse(JSON.parse(body + decoder.decode()));
  } catch {
    return reply({ error: "Invalid JSON" }, 400);
  }
  if (!parsed.success) return reply({ error: "Invalid physical state" }, 400);
  if (inFlight >= 4 || requests >= 120)
    return reply({ error: "Decision budget reached" }, 429);
  inFlight++;
  requests++;
  try {
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
