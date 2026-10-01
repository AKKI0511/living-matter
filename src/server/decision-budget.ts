import { createHash } from "node:crypto";

/** One atomic reservation shared by every serverless instance. No local global cap. */
export const budgetScript = `
local limits = {tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])}
for i=1,3 do if tonumber(redis.call('GET', KEYS[i]) or '0') >= limits[i] then return 0 end end
for i=1,3 do
  local value = redis.call('INCR', KEYS[i])
  if value == 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[i+3])) end
end
return 1`;

export async function reserveDecision(request: Request, sessionId: string, transport: typeof fetch = fetch) {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  // Development is bounded separately by the local concurrency/request guard.
  if (!url || !token) {
    if (process.env.NODE_ENV === "production") throw new Error("Decision budget unavailable");
    return true;
  }
  const now=Date.now(), minute=Math.floor(now/60_000), day=Math.floor(now/86_400_000);
  // Only Vercel's overwritten client-IP header is trusted in deployed mode.
  const ip=request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ?? "local";
  const identity=createHash("sha256").update(ip).digest("hex").slice(0,24);
  const daily=Math.min(100_000, Math.max(1, Number(process.env.JEV_DAILY_REQUEST_LIMIT) || 20_000));
  const result=await transport(url, { method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify(["EVAL",budgetScript,"3",`lm:day:${day}`,`lm:ip:${identity}:${minute}`,`lm:session:${sessionId}`,String(daily),"70","250","172800","120","3600"]),
    signal:AbortSignal.any([request.signal,AbortSignal.timeout(1200)]), cache:"no-store" });
  if(!result.ok) throw new Error("Decision budget unavailable");
  const body=await result.json(); if(body.error) throw new Error("Decision budget unavailable");
  return body.result===1;
}
