import { z } from "zod";
import { startJevSession } from "@/server/jev-audit";
import { decisionAuditEnabled } from "@/game/decision-audit-mode";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.uuid() });
export async function POST(request: Request) {
  if (!decisionAuditEnabled()) return Response.json({ error: "Session audit disabled" }, { status: 409 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Origin rejected" }, { status: 403 });
  const body = await request.text();
  if (body.length > 200) return Response.json({ error: "Invalid session" }, { status: 400 });
  let parsed;
  try { parsed = schema.safeParse(JSON.parse(body)); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "Invalid session" }, { status: 400 });
  try {
    await startJevSession(parsed.data.sessionId);
    return Response.json({ sessionId: parsed.data.sessionId });
  } catch {
    return Response.json({ error: "Session audit unavailable" }, { status: 503 });
  }
}
