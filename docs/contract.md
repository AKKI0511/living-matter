# Player and matter

Observation records movement, gaze, support, recent physical behavior and matter state. Code generates legal candidates; Jev or deterministic preview selects through `DecisionSource`. Jev returns typed judgments, never geometry.

Before execution, the engine rechecks movement freshness, candidate identity, grounded support, free halves, bounds, clearance and collision. Rendering depicts the resulting execution state. Assembly remains visibly unfinished until support is active.

- One body has exactly 512 pieces. Rolling routes recycle two 256-piece halves.
- Occupied support stays put. Failure, uncertainty and outdated responses retain safe support.
- Preview also retains an approaching usable half through small glances, including at a junction. Looking around must not bait the next step; deliberate side departures remain possible.
- Physics runs at 60 Hz independently of asynchronous selection. Graphics never enter physical or provider state.
- Pause resets the decision gate and aborts transport. Resume observes fresh behavior. Restart creates a new runtime and session. Exit disposes the runtime, aborts selection, closes audio, clears input and releases pointer lock.
- Generation and physical freshness reject responses from an old run or changed intent. There is no silent deterministic fallback in live mode.

Regression coverage includes occupied halves, stale responses, provider deadlines, shore seams, all retained formations, turning, reversing, recovery, restart, home transitions and production without debug hooks.
