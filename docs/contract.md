# The player–matter contract

[Architecture](architecture.md) · [How Jev works](jev.md) · [Docs](README.md)

Every backend selects through [`DecisionSource`](../src/game/decisions.ts). The engine owns the physical consequences of that selection.

| Step | Contract |
| --- | --- |
| Observe | Record movement, gaze, support, recent behavior and current matter state. |
| Generate | Code supplies contributions that fit the physical world and available matter. |
| Select | Jev or Preview returns a candidate ID or a hold through the same interface. |
| Execute | Recheck freshness, support, available halves, bounds, route clearance and collision before applying the choice. |
| Present | Animate the actual execution state and show availability only when support is active. |

## Physical guarantees

- Exactly one body contains **512 pieces**, split into two reusable **256-piece halves**.
- Occupied support cannot retract or recycle. Only a free half can rebuild.
- A formation's visible surface and collision agree. An assembling path is not presented as completed support.
- Graphics settings cannot change movement, geometry, physical availability or decision policy.
- Preview preserves a usable next half through small glances while allowing deliberate turns and departures.

## Decisions and lifecycle

Physics and rendering continue independently of provider timing. The decision gate uses cancellation and a generation counter; execution also checks physical freshness. A delayed answer cannot apply to an obsolete situation or a different run.

Pause aborts pending selection. Resume gathers fresh observations. Restart creates a new runtime and session. Exit aborts selection, stops simulation and audio, clears held input, releases pointer lock and disposes the run.

Uncertainty, timeouts and provider failures retain safe existing support. Live mode reports unavailability and never silently substitutes Preview. Jev judges intent and candidate fit; geometry, collision, timing and resource accounting remain in code.

Focused tests cover [decision cancellation](../tests/decisions.test.ts), [freshness](../tests/decision-freshness.test.ts), [occupied support](../tests/steering.test.ts), [typed judgments](../tests/live-decisions.test.ts) and [browser lifecycle](../tests/browser/lifecycle.spec.ts). See [development](development.md) for the complete verification commands.
