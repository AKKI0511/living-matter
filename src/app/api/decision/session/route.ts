import { z } from "zod";
import { recordJevSessionEvent } from "@/server/jev-audit";
import { decisionAuditEnabled } from "@/game/decision-audit-mode";
import { decisionOriginAllowed } from "@/server/decision-origin";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.uuid(), event: z.enum(["started", "paused", "resumed", "completed"]).default("started"), simulationTime: z.number().finite().nonnegative().optional(), recoveries: z.number().int().nonnegative().optional() });
export async function POST(request: Request) {
  if (!decisionAuditEnabled()) return Response.json({ error: "Session audit disabled" }, { status: 409 });
  if (!decisionOriginAllowed(request)) return Response.json({ error: "Origin rejected" }, { status: 403 });
  const body = await request.text();
  if (body.length > 500) return Response.json({ error: "Invalid session" }, { status: 400 });
  let parsed;
  try { parsed = schema.safeParse(JSON.parse(body)); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "Invalid session" }, { status: 400 });
  try {
    await recordJevSessionEvent(parsed.data.sessionId, parsed.data);
    return Response.json({ sessionId: parsed.data.sessionId });
  } catch {
    return Response.json({ error: "Session audit unavailable" }, { status: 503 });
  }
}
