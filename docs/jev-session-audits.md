# Inspecting Jev decisions

[How Jev works](jev.md) · [Development](development.md) · [Docs](README.md)

The development recorder lets you trace a decision from player behavior through Jev's answer to the game's actual response. Use it to check whether the companion understood an attempted crossing, a turn or a climb.

## Record a run

In `.env.local`, enable Jev and set `NEXT_PUBLIC_JEV_SESSION_AUDIT=1`, then restart `pnpm dev`. Play normally. Each run writes to `jev-sessions/<session-id>/`; restart creates a new session. Set the audit flag back to `0` and restart to stop recording. Production never writes these files.

```sh
pnpm jev:sessions --latest
pnpm jev:sessions replay <session-id>
```

The first command summarizes the newest run. Replay shows the recorded sequence and recomposes saved answers through the current decision policy without network calls or new inference.

| File | What to inspect |
| --- | --- |
| `session.json`, `summary.json`, `lifecycle.json` | Revision, run totals, pause, restart and completion |
| `calls/<call-id>/game-context.json` | Observations and physical candidates before selection |
| `calls/<call-id>/jev-request.json` | Exact model, state and questions |
| `calls/<call-id>/jev-response.json` | Provider answers and usage, when available |
| `calls/<call-id>/audit.json`, `error.json` | Composed decision, latency and sanitized failure data |
| `calls/<call-id>/game-outcome.json` | Whether the engine applied, held or discarded the result |

Read the request, answer and outcome together. A selected candidate may be discarded because the player moved before the answer arrived. An applied formation proves execution, but does not establish that the choice matched the player's intent.

Replay reports changes to requests or composed decisions. It reuses historical answers and cannot predict how Jev will answer revised questions. It also does not rerun physics or reproduce the rendered world. Interrupted recordings may lack a response; missing usage remains unknown. Recorded cost estimates use the saved rate and are not an account bill.

Audit writing extends the development browser deadline to five seconds; ordinary play keeps the two-second deadline. Freshness checks still apply.

## Review intent and export examples

```sh
pnpm jev:sessions review <session-id>
```

This creates `review.json` without overwriting existing labels. Calls begin excluded. Inspect a call, then label the judgments supported by its evidence.

```json
{
  "call_id": "the-recorded-call-uuid",
  "include": true,
  "expected_answers": {
    "action_needed": true,
    "best_candidate": "candidate_0"
  },
  "notes": "The player waited at unsupported space after attempting a crossing; this walkable section matches the intended direction.",
  "tags": ["edge", "crossing"]
}
```

Noul labels are human yes/no expectations. Choice labels must name an option in the recorded request. Label only questions that were asked and whose meaning is supported by the evidence.

```sh
pnpm jev:sessions export <session-id> > jev-sessions/eval.jsonl
```

Export validates included labels and review notes. Compare missing evidence, missing candidates, model judgments, policy thresholds, stale responses and transport failures separately. Split evaluation data by session so adjacent moments do not leak between datasets.

Session files contain gameplay observations and model answers, never API keys. Keep recordings and exported datasets ignored unless deliberately reviewed for publication.
