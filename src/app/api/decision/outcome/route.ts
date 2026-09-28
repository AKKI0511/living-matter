import { z } from "zod";
import { recordJevGameOutcome } from "@/server/jev-audit";
import { decisionAuditEnabled } from "@/game/decision-audit-mode";
import { decisionOriginAllowed } from "@/server/decision-origin";

export const runtime = "nodejs";
const schema = z.object({
  sessionId: z.uuid(),
  auditId: z.uuid(),
  status: z.enum(["applied", "retracted", "held", "discarded"]),
  reason: z.string().min(1).max(80),
  browserRoundTripMs: z.number().nonnegative().finite().optional(),
});
export async function POST(request: Request) {
  if (!decisionAuditEnabled()) return Response.json({ error: "Session audit disabled" }, { status: 409 });
  if (!decisionOriginAllowed(request)) return Response.json({ error: "Origin rejected" }, { status: 403 });
  const body = await request.text();
  if (body.length > 1000) return Response.json({ error: "Invalid outcome" }, { status: 400 });
  let parsed;
  try { parsed = schema.safeParse(JSON.parse(body)); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "Invalid outcome" }, { status: 400 });
  try {
    await recordJevGameOutcome(parsed.data.sessionId, parsed.data.auditId, parsed.data);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Outcome audit unavailable" }, { status: 503 });
  }
}
