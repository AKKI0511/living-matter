# Player–matter contract

Jev and Preview use the same [selection interface](../src/game/decisions.ts). The engine owns geometry, collision and execution.

- One matter body contains 512 pieces. A weaving route reuses its unoccupied half; occupied support never retracts.
- Candidates must fit the world, respect obstacles and remain reachable when the answer arrives.
- Rendering and collision share the same surfaces. New formations catch landings during assembly without trapping the player.
- Graphics settings change presentation, never movement or available formations.
- Physics continues while a decision is pending. Responses from an obsolete run or an unsafe attachment cannot apply.

Pause cancels pending decisions. Restart starts a fresh run. Leaving the game releases input, audio and simulation resources.

Provider failures continue through Preview, with a brief dismissible notice during play. Live production inference requires a [shared Redis reservation](deployment.md); local fallback makes no inference calls.

See [development](development.md) for verification and [How Jev works](jev.md) for the decision method.
