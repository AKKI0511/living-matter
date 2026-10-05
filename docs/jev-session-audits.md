# Inspect Jev decisions

The development recorder follows each decision from player behavior through Jev's answer to the actual formation. It records exact inputs, typed answers, token usage, latency and whether the game applied, held or discarded the result.

## Record and replay

Enable live Jev and `NEXT_PUBLIC_JEV_SESSION_AUDIT=1` in `.env.local`, then restart `pnpm dev`. Each run writes to the ignored `jev-sessions/` directory. Production never records these files.

```sh
pnpm jev:sessions --latest
pnpm jev:sessions replay <session-id>
```

Inspect `jev-request.json`, `jev-response.json` and `game-outcome.json` together. A model choice can be discarded if the player loses support before it arrives; successful execution alone does not prove the intent was understood.

Replay uses saved answers without calling Jev. It checks that the original state and questions still match; changed prompts are marked `prompt_changed`. It does not rerun physics or predict answers to new questions. Audit recording allows extra time for file writing; ordinary gameplay retains its shorter response deadline.

## Evaluate intent

```sh
pnpm jev:sessions review <session-id>
pnpm jev:sessions export <session-id>
```

Review creates `review.json` without overwriting labels. Mark a call included, add `expected_answers` for the recorded question names, and explain the evidence in `notes`. Noul expectations are booleans; Choice expectations name an offered option. Export emits validated JSONL examples.

Keep recordings local unless reviewed for publication. Compare model judgments, missing candidates, policy holds and stale responses separately. Split evaluation examples by session rather than adjacent moments.

See [How Jev works](jev.md) for the state and question design.
