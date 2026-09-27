# Living Matter with Jev

[Setup](../README.md#play-with-jev) · [Architecture](architecture.md) · [Record, replay and curate](jev-session-audits.md)

The game records a short history of physical events: movement, jumps, landings, support, edges, and what lies in the player's current facing direction. The directions Jev sees are relative to the player. Candidate matter actions are generated and checked by the game.

When a legal action exists, one server request asks Jev whether matter should change and which candidate best fits the recent behavior. If the player is off existing matter, it also asks whether that help has been abandoned. Code applies thresholds, checks that the answer is fresh and legal, and protects any section supporting the player. Uncertain answers hold the current form.

The API key stays on the server. Set `NEXT_PUBLIC_DECISION_BACKEND=jev` and `TYPESAFE_API_KEY` in `.env.local`, then restart the game. Preview mode uses the local selection policy. Development-only [session auditing](jev-session-audits.md) is off by default and can be enabled with `NEXT_PUBLIC_JEV_SESSION_AUDIT=1`. The Jev transport is tested with mocked responses; the initial thresholds still need real playtesting.

## What Jev receives

Jev supplies typed judgments, not geometry or generated instructions. The server uses the [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) to send one batch. `action_needed` is a Noul (probability of yes); `best_candidate` is a Choice (selected option, distribution and confidence). If unoccupied matter already exists, `abandoned_current` asks whether the player has stopped trying to use it. These questions share state and cannot see each other's answers.

Here is an illustrative input for a player trying to cross open air. The exact gameplay payload includes the recent event history and every legal candidate; copy a recorded `jev-request.json` to try it in the TypeSafe playground.

```json
{
  "model": "jev-1.13.0",
  "state": {
    "player_now": { "support": "permanent ground", "motion": "standing", "position_on_support": "near an edge", "facing_into": "open air" },
    "recent_behavior_oldest_to_newest": [
      { "support": "permanent ground", "motion": "walking forward", "facing_into": "open air" },
      { "support": "airborne", "motion": "jumping forward" },
      { "support": "permanent ground", "motion": "landed back on the same support" }
    ],
    "matter_now": { "state": "idle", "player_supported_by_matter": false }
  },
  "questions": {
    "action_needed": {
      "type": "noul",
      "instructions": "Does the recent physical behavior suggest that living matter should change now to support the direction the player is trying to continue?",
      "criteria": { "true": "Repeated traversal attempts into unsupported space.", "false": "Normal movement on sufficient support or only looking around." }
    },
    "best_candidate": {
      "type": "choice",
      "instructions": "Assuming living matter should change now, which candidate best matches the player's recent direction and manner of movement?",
      "criteria": {
        "candidate_0": { "matter_change": "form a walkable section", "extends": "ahead of the player's current facing", "environment": "over open air" },
        "candidate_1": { "matter_change": "form a moving deck", "player_use": "stand on it while it carries the player" }
      }
    }
  }
}
```

An illustrative response (these numbers are examples, not a measured run):

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "action_needed": { "type": "noul", "noul": 0.91 },
    "best_candidate": { "type": "choice", "choice": "candidate_0", "confidence": 0.8, "probabilities": { "candidate_0": 0.9, "candidate_1": 0.1 } }
  },
  "usage": { "input_tokens": 300, "output_tokens": 40 }
}
```

Code maps `candidate_0` back to the first candidate's physical ID. With action probability at least `0.6` and choice confidence at least `0.3`, it requests that formation and checks again after `1800 ms`. Lower values hold the current form. An abandonment probability at least `0.8` permits retraction only after the engine verifies that nobody occupies the support. These thresholds are initial policy choices to evaluate using curated sessions.

The browser rejects obsolete answers and rechecks physical eligibility. Jev never sees stage IDs or progression order. Physics, collision admission, recovery, and the rule that occupied support must remain all belong to code. Requests are throttled and identical contexts can reuse a recent answer; the game does not call Jev on every simulation frame. If the provider fails, existing support is held.

For useful recordings, try an unsupported edge after a jump, then a reversal while standing on living matter. Review whether the input describes the attempt clearly, whether the candidate covers it, whether Jev chooses it, and whether the engine applies it.
