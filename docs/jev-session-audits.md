# Reviewing live Jev sessions

Session auditing is opt-in. In `.env.local`, set `NEXT_PUBLIC_DECISION_BACKEND=jev` and `NEXT_PUBLIC_JEV_SESSION_AUDIT=1`, then restart `pnpm dev`. Set the audit flag to `0` or remove it and restart to play without storing calls. Auditing is disabled in production even if the flag is set.

When enabled, live mode writes one local folder per play run under `jev-sessions/<session-id>/`. A restart or page reload creates a new ID. The folder is created when play begins, even if Jev is never called. `jev-sessions/` is gitignored.

Start with `pnpm jev:sessions --latest` for the newest run, or `pnpm jev:sessions` for all runs. Both commands print JSON with absolute folder paths and summaries. In development, `window.__livingMatter.snapshot().sessionId` identifies the run currently on screen. Coding agents can inspect the same files directly.

```text
jev-sessions/<session-id>/
  session.json                 Start time, Git revision, policy and pricing snapshot
  summary.json                 Auto-updated run totals
  lifecycle.json               Started, paused, resumed and completed play events
  calls/<call-id>/
    started.json               Sequence, call ID, request hash, policy and wall-clock start
    game-context.json          Raw observations and legal candidates from the game
    jev-request.json           Exact model, state, and questions sent to Jev
    jev-response.json          Complete parsed Jev response, when available
    error.json                 Sanitized failure metadata, when applicable
    audit.json                 Latency, token usage, cost estimate, composed decision
    game-outcome.json          Whether the game applied, held, retracted, or discarded it
```

The game creates `jev-request.json` before making the provider call. A failed or interrupted call can therefore leave a folder without `audit.json`; `summary.json` counts those as pending. A provider failure without usage is marked **cost unknown**, since a timeout does not prove the provider billed nothing. Calls whose model is absent from the local price table are also marked cost unknown.

Completed runs include simulation duration, completion time, active wall time and recoveries in the summary. Older recordings without lifecycle events cannot establish an exact completion duration from their final decision alone.

For Jev 1.13, the cost estimate uses the [TypeSafe model price](https://docs.typesafe.ai/models): $0.042 per million input tokens, output tokens free, checked 2026-09-27. Each call records the rate and source used. The estimate may differ from the account bill if credits or custom pricing apply. `audit.json` records provider round-trip time, server time, and model evaluation time when Jev supplies it. `game-outcome.json` records browser round-trip time and the game's final handling of the decision.

The files contain gameplay observations and model answers, but never the API key. If you set `JEV_SESSION_DIR`, sessions are written there instead; keep that directory out of git as well. Known token totals are accompanied by counts of calls with missing usage. Files are saved before returning an audited decision; disk failure prevents an unaudited decision from being applied. Browser latency includes the audit write, while provider latency measures the SDK call alone. Recorded development calls have a five-second browser deadline to allow disk writes; ordinary calls keep their two-second deadline. Stale physical decisions are still discarded.

## Replay a recorded session

```sh
pnpm jev:sessions replay <session-id>
```

This emits chronological JSON containing each original request, answer, physical context, timing, error and game outcome. It composes saved answers through today's decision code and reports `decision_changed`, `request_changed` and `replay_error`. No API key, network calls or new inference are involved. Missing recordings remain pending or invalid. Replay covers the Jev decision sequence; it does not reproduce the rendered world or rerun physics. The simulation time and observations show the physical situation at each request.

Use the recorded Git revision to check out the original code when reproducing a historical policy. A dirty worktree means that revision alone is insufficient; the exact requests and per-call policy still remain available. Changed questions require fresh model evaluation; replay can only reuse the answers to the original questions.

## Turn play into evaluation data

```sh
pnpm jev:sessions review <session-id>
```

This creates `review.json` beside the session files and refuses to overwrite existing labels. Every call starts excluded. Inspect the replay and edit only the calls you want:

```json
{
  "call_id": "the-recorded-call-uuid",
  "include": true,
  "expected_answers": { "action_needed": true, "best_candidate": "candidate_0" },
  "notes": "Repeated jump at an unsupported edge; the forward walkable section matches the attempt.",
  "tags": ["edge", "jump", "forward"]
}
```

Noul labels are human yes/no expectations, not probabilities. Choice labels must name an option in that recorded request. Label only judgments the evidence supports; omit a speculative choice when no action is needed. Add `abandoned_current` only when that question was asked. Jev's answer and the engine applying it are observations, never automatic correctness labels.

```sh
pnpm jev:sessions export <session-id> > jev-sessions/eval.jsonl
```

Export validates included labels and requires review notes. Each JSONL row includes the original input, human expectations, observed response, outcome, tags and provenance. Keep local datasets ignored until deliberately reviewed for publication. For synthetic variants, copy curated rows, change only the intended evidence, assign a new ID and retain the source ID in your notes; have a person verify the new labels. Split datasets by session to avoid near-identical moments leaking between training and evaluation.

For a coding agent: start with the summary, replay failures and low-confidence moments, then read the full call folder. Distinguish missing evidence, missing candidates, model errors, policy thresholds, stale decisions and provider failures before changing code. Compare the same recordings after a policy change, and use human labels to judge correctness.
