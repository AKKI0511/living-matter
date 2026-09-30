# Living Matter with Jev

[Setup](../README.md#decision-modes) · [Architecture](architecture.md) · [Session audits](jev-session-audits.md)

Set `NEXT_PUBLIC_DECISION_BACKEND=jev` and `TYPESAFE_API_KEY` in `.env.local`, then restart the server. Add `NEXT_PUBLIC_JEV_SESSION_AUDIT=1` for development recordings. Preview uses the local policy.

The game computes legal physical sections. Jev receives current support, movement, gaze height and up to four recent behavior changes. A successful reconstruction clears the attempts that it already served. Each option describes walking or riding, its attachment, view alignment, turn, length and rise, and whether it reaches ground.

One batch asks two independent questions, plus focused questions when you stand at a matter edge:

- A Noul: does the behavior show an attempt to continue beyond existing support?
- A speculative Choice: if a new section is needed, which reachable option fits the current view and movement? No-match remains available.
- At a matter edge, a Noul: are you asking for a side branch even though the old deck still continues?
- When looking up or down at that edge, a Noul: are you asking to climb or descend?

Questions contain the judgment and its boundaries. Geometry construction, protected support and response composition stay in code. Unused matter remains available until another offer needs it; cosmetic withdrawal consumes no inference.

The browser holds without a request when continuous support already serves forward movement, or a pause after that movement, at a level gaze away from a matter edge. Gaps, edge turns, sideways/backward intent and height changes still reach Jev. Other unchanged holds use a short cache.

Action probability at least `0.6` and Choice confidence at least `0.3` allow a candidate to pass to the engine. The engine then verifies freshness, physical eligibility and occupied support. Uncertainty or service failures preserve the current body. These thresholds require evaluation on real play; Choice confidence measures distribution concentration, not correctness.

Audits save the exact provider request, response and actual usage. Compare new live runs to confirm savings and decision quality; rebuilding old requests measures payload size, but cannot predict the revised model answers. Older recordings can include an abandonment question that is no longer sent.

The integration follows TypeSafe's [state guidance](https://docs.typesafe.ai/concepts/state), [Choice](https://docs.typesafe.ai/primitives/choice), [Noul](https://docs.typesafe.ai/primitives/noul) and [System One](https://docs.typesafe.ai/concepts/system-one) documentation. The API key stays on the server. No stage IDs or progression order enter model state.
