# Reviewing live Jev sessions

Session auditing is opt-in. In `.env.local`, set `NEXT_PUBLIC_DECISION_BACKEND=jev` and `NEXT_PUBLIC_JEV_SESSION_AUDIT=1`, then restart `pnpm dev`. Set the audit flag to `0` or remove it and restart to play without storing calls. Auditing is disabled in production even if the flag is set.

When enabled, live mode writes one local folder per play run under `jev-sessions/<session-id>/`. A restart or page reload creates a new ID. The folder is created when play begins, even if Jev is never called. `jev-sessions/` is gitignored.

Start with `pnpm jev:sessions --latest` for the newest run, or `pnpm jev:sessions` for all runs. Both commands print JSON with absolute folder paths and summaries. In development, `window.__livingMatter.snapshot().sessionId` identifies the run currently on screen. Coding agents can inspect the same files directly.

```text
jev-sessions/<session-id>/
  session.json                 Start time and pricing snapshot
  summary.json                 Auto-updated run totals
  calls/<call-id>/
    started.json               Call ID and wall-clock start
    game-context.json          Raw observations and legal candidates from the game
    jev-request.json           Exact model, state, and questions sent to Jev
    jev-response.json          Complete parsed Jev response, when available
    error.json                 Sanitized failure metadata, when applicable
    audit.json                 Latency, token usage, cost estimate, composed decision
    game-outcome.json          Whether the game applied, held, retracted, or discarded it
```

The game creates `jev-request.json` before making the provider call. A failed or interrupted call can therefore leave a folder without `audit.json`; `summary.json` counts those as pending. A provider failure without usage is marked **cost unknown**, since a timeout does not prove the provider billed nothing. Calls whose model is absent from the local price table are also marked cost unknown.

For Jev 1.13, the cost estimate uses the [TypeSafe model price](https://docs.typesafe.ai/models): $0.042 per million input tokens, output tokens free, checked 2026-09-23. Each call records the rate and source used. The estimate may differ from the account bill if credits or custom pricing apply. `audit.json` records provider round-trip time, server time, and model evaluation time when Jev supplies it. `game-outcome.json` records browser round-trip time and the game's final handling of the decision.

The files contain gameplay observations and model answers, but never the API key. If you set `JEV_SESSION_DIR`, sessions are written there instead; keep that directory private and out of git as well. Local files may be ephemeral on some production hosts, so use a persistent Node.js filesystem for a retained audit.
