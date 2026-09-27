import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decisionPolicy } from "./decision-request";

const PRICE_SOURCE = "https://docs.typesafe.ai/models";
const PRICE_CHECKED_AT = "2026-09-27";
const PRICE_PER_MILLION_INPUT_USD: Record<string, number> = {
  "jev-1.13.0": 0.042,
};
const queues = new Map<string, Promise<unknown>>();

type JsonRecord = Record<string, unknown>;
export type AuditCall = {
  sessionId: string;
  callId: string;
  startedAt: string;
  startedMs: number;
  directory: string;
};

function root() {
  // Session files are created at runtime and must not be bundled into the server build.
  return resolve(/* turbopackIgnore: true */ process.env.JEV_SESSION_DIR || join(process.cwd(), "jev-sessions"));
}
function sessionDirectory(sessionId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId))
    throw new Error("Invalid audit session ID");
  return join(/* turbopackIgnore: true */ root(), sessionId);
}
function callDirectory(sessionId: string, callId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callId))
    throw new Error("Invalid audit call ID");
  return join(sessionDirectory(sessionId), "calls", callId);
}
async function withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(task);
  queues.set(sessionId, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(sessionId) === pending) queues.delete(sessionId);
  }
}
async function writeJson(path: string, value: unknown, exclusive = false) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    ...(exclusive ? { flag: "wx" } : {}),
  });
}
async function readJson(path: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as JsonRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function ensureSession(sessionId: string) {
  const directory = sessionDirectory(sessionId);
  await mkdir(join(directory, "calls"), { recursive: true });
  if (await readJson(join(directory, "session.json"))) return directory;
  try {
    // Record provenance without credentials or environment dumps.
    let revision: string | null = null;
    let dirty: boolean | null = null;
    try {
      revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      dirty = !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { /* Git is optional for local runs. */ }
    await writeJson(join(directory, "session.json"), {
      schema_version: 1,
      session_id: sessionId,
      started_at: new Date().toISOString(),
      revision,
      dirty_worktree: dirty,
      decision_policy: decisionPolicy,
      replay: "Recorded decision contexts and answers; no provider calls or physics resimulation.",
      pricing: {
        source: PRICE_SOURCE,
        checked_at: PRICE_CHECKED_AT,
        currency: "USD",
        models: { "jev-1.13.0": { input_usd_per_million_tokens: 0.042, output_usd_per_million_tokens: 0 } },
        note: "List price estimate. Account credits or custom pricing may change the bill.",
      },
    }, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return directory;
}
function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function estimatedCost(model: unknown, inputTokens: number | null) {
  if (typeof model !== "string" || inputTokens === null || !(model in PRICE_PER_MILLION_INPUT_USD)) return null;
  return Math.round(inputTokens * PRICE_PER_MILLION_INPUT_USD[model] / 1_000_000 * 1e12) / 1e12;
}
function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
async function refreshSummary(sessionId: string) {
  const directory = sessionDirectory(sessionId);
  const names = await readdir(join(directory, "calls"), { withFileTypes: true });
  const attempted = names.filter((entry) => entry.isDirectory()).length;
  const audits: JsonRecord[] = [];
  const outcomes: JsonRecord[] = [];
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    const call = callDirectory(sessionId, entry.name);
    const audit = await readJson(join(call, "audit.json"));
    if (audit) audits.push(audit);
    const outcome = await readJson(join(call, "game-outcome.json"));
    if (outcome) outcomes.push(outcome);
  }
  const successful = audits.filter((audit) => audit.status === "success");
  const failed = audits.filter((audit) => audit.status === "error");
  const costs = audits.map((audit) => numberOrNull((audit.cost as JsonRecord | undefined)?.estimated_usd));
  const unknownCosts = costs.filter((cost) => cost === null).length;
  const timings = audits.map((audit) => numberOrNull((audit.timing as JsonRecord | undefined)?.provider_round_trip_ms)).filter((value): value is number => value !== null);
  const browserTimings = outcomes.map((outcome) => numberOrNull(outcome.browser_round_trip_ms)).filter((value): value is number => value !== null);
  const tokens = (key: string) => audits.reduce((sum, audit) => sum + (numberOrNull((audit.tokens as JsonRecord | undefined)?.[key]) ?? 0), 0);
  const modelCounts: Record<string, number> = {};
  for (const audit of audits) {
    if (typeof audit.model === "string") modelCounts[audit.model] = (modelCounts[audit.model] ?? 0) + 1;
  }
  const outcomeCounts: Record<string, number> = {};
  for (const outcome of outcomes) {
    if (typeof outcome.status === "string") outcomeCounts[outcome.status] = (outcomeCounts[outcome.status] ?? 0) + 1;
  }
  const summary = {
    schema_version: 1,
    session_id: sessionId,
    updated_at: new Date().toISOString(),
    attempted_calls: attempted,
    completed_calls: audits.length,
    pending_calls: attempted - audits.length,
    successful_calls: successful.length,
    failed_calls: failed.length,
    first_call_at: audits.length ? audits.map((audit) => String(audit.started_at)).sort()[0] : null,
    last_call_at: audits.length ? audits.map((audit) => String(audit.completed_at)).sort().at(-1) : null,
    model_counts: modelCounts,
    total_input_tokens: tokens("input"),
    total_output_tokens: tokens("output"),
    unknown_input_token_calls: audits.filter((audit) => numberOrNull((audit.tokens as JsonRecord | undefined)?.input) === null).length,
    unknown_output_token_calls: audits.filter((audit) => numberOrNull((audit.tokens as JsonRecord | undefined)?.output) === null).length,
    cost: {
      currency: "USD",
      known_estimated_usd: Math.round(costs.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 1e12) / 1e12,
      estimated_total_usd: unknownCosts || attempted > audits.length ? null : Math.round(costs.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 1e12) / 1e12,
      unknown_cost_calls: unknownCosts,
      source: PRICE_SOURCE,
      checked_at: PRICE_CHECKED_AT,
    },
    provider_latency_ms: {
      total: timings.reduce((sum, value) => sum + value, 0),
      average: timings.length ? timings.reduce((sum, value) => sum + value, 0) / timings.length : null,
      p50: percentile(timings, 0.5),
      p95: percentile(timings, 0.95),
      max: timings.length ? Math.max(...timings) : null,
    },
    browser_round_trip_ms: {
      average: browserTimings.length ? browserTimings.reduce((sum, value) => sum + value, 0) / browserTimings.length : null,
      p50: percentile(browserTimings, 0.5),
      p95: percentile(browserTimings, 0.95),
      max: browserTimings.length ? Math.max(...browserTimings) : null,
    },
    confirmed_game_outcomes: outcomeCounts,
    unconfirmed_game_outcomes: audits.length - outcomes.length,
  };
  const temporary = join(directory, `summary.${randomUUID()}.tmp`);
  await writeJson(temporary, summary, true);
  await rename(temporary, join(directory, "summary.json"));
  return summary;
}

export async function beginJevCall(sessionId: string, request: JsonRecord, gameContext: unknown): Promise<AuditCall> {
  const startedMs = performance.now();
  return withSessionLock(sessionId, async () => {
    await ensureSession(sessionId);
    const callId = randomUUID();
    const directory = callDirectory(sessionId, callId);
    const startedAt = new Date().toISOString();
    const sequence = (await readdir(join(sessionDirectory(sessionId), "calls"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
    await mkdir(directory);
    await writeJson(join(directory, "jev-request.json"), request, true);
    await writeJson(join(directory, "game-context.json"), gameContext, true);
    await writeJson(join(directory, "started.json"), {
      schema_version: 1, session_id: sessionId, call_id: callId, started_at: startedAt, sequence,
      request_sha256: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
      decision_policy: decisionPolicy,
    }, true);
    await refreshSummary(sessionId);
    return { sessionId, callId, startedAt, startedMs, directory };
  });
}

export async function startJevSession(sessionId: string) {
  return withSessionLock(sessionId, async () => {
    await ensureSession(sessionId);
    return refreshSummary(sessionId);
  });
}

export async function completeJevCall(call: AuditCall, detail: {
  providerRoundTripMs: number;
  providerRequestId?: string;
  response?: JsonRecord;
  decision?: unknown;
  error?: JsonRecord;
}) {
  return withSessionLock(call.sessionId, async () => {
    const completedAt = new Date().toISOString();
    if (detail.response) await writeJson(join(call.directory, "jev-response.json"), detail.response, true);
    if (detail.error) await writeJson(join(call.directory, "error.json"), detail.error, true);
    const response = detail.response;
    const usage = response?.usage as JsonRecord | undefined;
    const input = numberOrNull(usage?.input_tokens);
    const output = numberOrNull(usage?.output_tokens);
    const model = response?.model ?? null;
    const rate = typeof model === "string" ? PRICE_PER_MILLION_INPUT_USD[model] ?? null : null;
    const audit = {
      schema_version: 1,
      session_id: call.sessionId,
      call_id: call.callId,
      started_at: call.startedAt,
      completed_at: completedAt,
      status: detail.error ? "error" : "success",
      model,
      provider_request_id: detail.providerRequestId ?? response?.request_id ?? null,
      timing: {
        provider_round_trip_ms: detail.providerRoundTripMs,
        server_total_ms: performance.now() - call.startedMs,
        model_evaluation_ms: numberOrNull(response?.evaluation_time_ms),
      },
      tokens: { input, output },
      cost: {
        currency: "USD",
        input_usd_per_million_tokens: rate,
        output_usd_per_million_tokens: rate === null ? null : 0,
        estimated_usd: estimatedCost(model, input),
        source: PRICE_SOURCE,
        checked_at: PRICE_CHECKED_AT,
      },
      decision: detail.decision ?? null,
    };
    await writeJson(join(call.directory, "audit.json"), audit, true);
    await refreshSummary(call.sessionId);
    return audit;
  });
}

export async function recordJevGameOutcome(sessionId: string, callId: string, outcome: {
  status: "applied" | "retracted" | "held" | "discarded";
  reason: string;
  browserRoundTripMs?: number;
}) {
  return withSessionLock(sessionId, async () => {
    const directory = callDirectory(sessionId, callId);
    const audit = await readJson(join(directory, "audit.json"));
    if (!audit) throw new Error("Unknown audit call");
    await writeJson(join(directory, "game-outcome.json"), {
      schema_version: 1,
      session_id: sessionId,
      call_id: callId,
      recorded_at: new Date().toISOString(),
      status: outcome.status,
      reason: outcome.reason,
      browser_round_trip_ms: numberOrNull(outcome.browserRoundTripMs),
    });
    await refreshSummary(sessionId);
  });
}
