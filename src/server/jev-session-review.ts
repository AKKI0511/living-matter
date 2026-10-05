import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { buildDecisionRequest, composeDecision, decisionSchema } from "./decision-request";

async function json(path: string) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Offline replay: original evidence is immutable; composition uses today's code. */
export async function replaySession(directory: string) {
  const session = await json(join(directory, "session.json"));
  if (!session) throw new Error("Missing session.json");
  const entries = await readdir(join(directory, "calls"), { withFileTypes: true });
  const calls = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const path = join(directory, "calls", entry.name);
    const [started, context, request, response, audit, outcome, error] = await Promise.all(
      ["started", "game-context", "jev-request", "jev-response", "audit", "game-outcome", "error"].map((name) => json(join(path, `${name}.json`))),
    );
    let decision = null, replayError = null, requestChanged = null;
    if (context && request && response?.answers) {
      try {
        const parsed = decisionSchema.parse(context);
        requestChanged = !isDeepStrictEqual(buildDecisionRequest(parsed), { state: request.state, questions: request.questions });
        if (requestChanged) replayError = "Recorded prompt differs from current prompt; its answers cannot be recomposed as current judgments.";
        else decision = composeDecision(parsed, response.answers);
      } catch (failure) { replayError = failure instanceof Error ? failure.message : "Invalid recording"; }
    }
    return {
      call_id: entry.name, sequence: started?.sequence ?? null, started_at: started?.started_at ?? null,
      simulation_time: context?.observations?.at(-1)?.time ?? null,
      request, response, context, audit, outcome, error,
      recorded_policy: started?.decision_policy ?? session.decision_policy ?? null,
      replayed_decision: decision,
      decision_changed: decision && audit?.decision ? !isDeepStrictEqual(decision, audit.decision) : null,
      request_changed: requestChanged, replay_error: replayError,
      status: requestChanged ? "prompt_changed" : replayError ? "invalid" : !audit ? "pending" : audit.status,
    };
  }));
  calls.sort((a, b) => a.sequence !== null && b.sequence !== null ? a.sequence - b.sequence : String(a.started_at).localeCompare(String(b.started_at)) || a.call_id.localeCompare(b.call_id));
  return { schema_version: 1, session, calls };
}

const labelSchema = z.object({
  call_id: z.uuid(), include: z.boolean(),
  expected_answers: z.record(z.string(), z.union([z.boolean(), z.string()])).nullable(),
  notes: z.string(), tags: z.array(z.string()),
});
const reviewSchema = z.object({ schema_version: z.literal(1), session_id: z.uuid(), calls: z.array(labelSchema) });

export async function createSessionReview(directory: string) {
  const replay = await replaySession(directory);
  const review = {
    schema_version: 1, session_id: replay.session.session_id,
    calls: replay.calls.map((call) => ({ call_id: call.call_id, include: false, expected_answers: null, notes: "", tags: [] })),
  };
  // Never overwrite a curator's labels.
  await writeFile(join(directory, "review.json"), JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
  return review;
}

export async function exportSessionDataset(directory: string) {
  const replay = await replaySession(directory);
  const review = reviewSchema.parse(await json(join(directory, "review.json")));
  if (review.session_id !== replay.session.session_id) throw new Error("Review belongs to a different session");
  const seen = new Set<string>();
  const rows = [];
  for (const label of review.calls) {
    if (seen.has(label.call_id)) throw new Error("Duplicate review call");
    seen.add(label.call_id);
    const call = replay.calls.find((item) => item.call_id === label.call_id);
    if (!call) throw new Error(`Unknown call ${label.call_id}`);
    if (!label.include) continue;
    if (!call.request || !label.expected_answers || !Object.keys(label.expected_answers).length || !label.notes.trim())
      throw new Error(`Included call ${label.call_id} needs evidence, human labels and notes`);
    for (const [key, value] of Object.entries(label.expected_answers)) {
      const question = call.request.questions[key];
      if (!question || (question.type === "noul" ? typeof value !== "boolean" : question.type !== "choice" || typeof value !== "string" || !Object.hasOwn(question.criteria, value)))
        throw new Error(`Invalid expected answer for ${key} in ${label.call_id}`);
    }
    rows.push({
      schema_version: 1, id: `${review.session_id}/${label.call_id}`,
      provenance: { session_id: review.session_id, call_id: label.call_id, revision: replay.session.revision ?? null, dirty_worktree: replay.session.dirty_worktree ?? null, recorded_policy: call.recorded_policy },
      input: call.request, expected_answers: label.expected_answers,
      observed_response: call.response, observed_decision: call.audit?.decision ?? null,
      game_outcome: call.outcome, notes: label.notes, tags: label.tags,
    });
  }
  return rows;
}
