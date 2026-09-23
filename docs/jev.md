# Living Matter with Jev

[Setup](../README.md#play-with-jev) · [Architecture](architecture.md) · [Playground reference runs](jev-playground-runs.md) · [Live session audits](jev-session-audits.md)

The game records a short history of physical events: movement, jumps, landings, support, edges, and what lies in the player's current facing direction. The directions Jev sees are relative to the player. Candidate matter actions are generated and checked by the game.

When a legal action exists, one server request asks Jev whether matter should change and which candidate best fits the recent behavior. If the player is off existing matter, it also asks whether that help has been abandoned. Code applies thresholds, checks that the answer is fresh and legal, and protects any section supporting the player. Uncertain answers hold the current form.

The API key stays on the server. Set `NEXT_PUBLIC_DECISION_BACKEND=jev` and `TYPESAFE_API_KEY` in `.env.local`, then restart the game. Preview mode uses the local selection policy. Development-only [session auditing](jev-session-audits.md) is off by default and can be enabled with `NEXT_PUBLIC_JEV_SESSION_AUDIT=1`. The Jev transport is tested with mocked responses; the initial thresholds still need real playtesting.
