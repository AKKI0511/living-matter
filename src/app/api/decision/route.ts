import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  buildDecisionRequest,
  decisionSchema,
} from "@/server/decision-request";

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
    client ??= new TypeSafeClient({
      timeout: 1600,
      retry: { maxRetries: 0 },
      logLevel: "off",
    });
    const response = await client.systemOne(buildDecisionRequest(parsed.data), {
      signal: request.signal,
    });
    const selected = response.answers.action.choice;
    const index = /^c\d+$/.test(selected) ? Number(selected.slice(1)) : -1;
    const candidate = parsed.data.candidates[index];
    const candidateId =
      response.answers.assistance.noul >= 0.5 && candidate
        ? candidate.id
        : null;
    if (process.env.NODE_ENV === "development")
      console.info("[decisions]", {
        model: response.model,
        usage: response.usage,
        candidateId,
        confidence: response.answers.action.confidence,
      });
    return reply({
      candidateId,
      recheckAfterMs: response.answers.changing.noul > 0.5 ? 1500 : 6000,
    });
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
