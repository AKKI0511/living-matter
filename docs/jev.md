# How Jev makes matter feel alive

[Play](https://livingmatter.vercel.app) · [Local setup](development.md#choose-preview-or-jev) · [Architecture](architecture.md)

Living Matter uses **Jev as a real-time intent interpreter**. It reads where you move, where you look and what you just attempted, then judges how the companion should help. Run toward a gap, hesitate at its edge, turn on a path or look toward higher ground. Those actions become evidence for the next formation.

Jev is TypeSafe's [System One model](https://docs.typesafe.ai/concepts/system-one). It returns typed judgments and probabilities that the game can execute. Living Matter asks it to interpret behavior and select a physically available contribution. The engine builds the geometry, moves the pieces and protects the surface beneath you.

## One crossing, end to end

Suppose you run toward the water, stop near the arrival terrace's edge and keep looking across. The engine knows that there is open space ahead and separate walkable ground beyond it. Your recent run distinguishes this pause from standing on a terrace and surveying the scenery.

The examples below use the game's actual serializers and question builder with a two-option subset of arrival-crossing candidates. State and questions are generated from that physical situation. The answer values are illustrative, not a recorded provider result.

### 1. Describe the player's situation

The browser observes position, velocity, view direction, grounded state and active support. [`semantic.ts`](../src/game/semantic.ts) turns those measurements into descriptions such as `running forward`, `at an edge` and `open air`. It also records events such as turning and stopping, jumping and landing, or falling and returning.

[`decision-state.ts`](../src/game/decision-state.ts) keeps the present situation and up to four recent behavior changes. This is the state sent to Jev for our example.

```json
{
  "player_now": {
    "support": "permanent ground",
    "motion": "standing",
    "position_on_support": "near an edge",
    "facing_into": "open air",
    "surface_beyond_facing": "separate walkable ground at similar height",
    "view_height": "looking roughly level"
  },
  "recent_behavior": [
    {
      "support": "permanent ground",
      "motion": "running forward",
      "facing_into": "open air"
    }
  ],
  "matter_now": {
    "state": "idle",
    "player_supported_by_matter": false
  }
}
```

Jev receives structured descriptions, not screenshots or a stream of button presses. Precise coordinates, collider dimensions, session IDs and candidate IDs remain available to application code. Authored stage names and progression order stay out of the model's state. TypeSafe's [state guide](https://docs.typesafe.ai/concepts/state) explains the shared-state format.

### 2. Offer paths that can exist

[`affordances.ts`](../src/game/affordances.ts) and [`weave.ts`](../src/game/weave.ts) generate reachable contributions. A candidate includes its endpoints, rise, attachment and formation kind. The engine computes distances and collision clearance before asking for selection.

The server describes each option relative to the player. In this example, `candidate_0` means the first rising section of a walkable route; `candidate_1` means a moving deck to the other shore. Shared attributes are removed from the option descriptions, and indistinguishable options are deduplicated while preserving their original indices.

### 3. Ask two focused questions together

The request contains `state` and a `questions` map. [`buildDecisionRequest`](../src/server/decision-request.ts) produces these exact questions for the example.

```json
{
  "action_needed": {
    "type": "noul",
    "instructions": "Do `player_now` and `recent_behavior` show an attempt to continue beyond existing support?",
    "criteria": {
      "true": "Moving toward unsupported space, waiting there after an attempt, or turning toward it on matter.",
      "false": "Existing support serves the current direction, or the player is looking around or retreating on ground without a traversal attempt."
    }
  },
  "best_candidate": {
    "type": "choice",
    "instructions": {
      "question": "If a new section is needed, which reachable option best matches the player's current view and movement?",
      "direction": "Prefer a reachable heading close to the current view when the player turns or pauses; use motion and recent behavior to disambiguate. Consider view height and side-rim attachments."
    },
    "criteria": {
      "candidate_0": {
        "player_use": "walk",
        "vertical_change": "higher",
        "length_units": "6.1",
        "rise_units": "1.2",
        "path_shape": "straight",
        "ends_at": "open space"
      },
      "candidate_1": {
        "player_use": "ride a moving deck",
        "vertical_change": "at similar height",
        "length_units": "24.4",
        "rise_units": "0.0",
        "ends_at": "ground"
      },
      "none": "No option serves that direction from a reachable attachment."
    }
  }
}
```

**Noul** returns the probability that help is needed. **Choice** selects an option and reports its probability distribution and confidence. The `none` option allows a judgment that the available contributions do not fit. See TypeSafe's [Noul](https://docs.typesafe.ai/primitives/noul) and [Choice](https://docs.typesafe.ai/primitives/choice) references.

Both questions evaluate the same state independently in one request. The Choice explicitly assumes that a new section is needed; application code decides whether to use it after reading the Noul. This [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out) avoids a second round trip for selection.

Question IDs such as `action_needed` map answers back to code. The model sees the instructions and criteria; each question carries its own complete meaning.

The server's SDK call follows this structure.

```ts
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { buildDecisionRequest, composeDecision } from "@/server/decision-request";

const jevRequest = buildDecisionRequest(context);
const client = new TypeSafeClient({
  timeout: 1600,
  retry: { maxRetries: 0 },
  logLevel: "off",
});
const response = await client.systemOne(
  { model: "jev-1.13.0", ...jevRequest },
  { signal: request.signal },
);
const intervention = composeDecision(context, response.answers);
```

The [API route](../src/app/api/decision/route.ts) handles validation, budget reservation and the server-only credential around this call. The [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) supplies the typed interface.

### 4. Turn typed answers into an intervention

An illustrative `answers` object could look like this.

```json
{
  "action_needed": { "type": "noul", "noul": 0.9 },
  "best_candidate": {
    "type": "choice",
    "choice": "candidate_0",
    "confidence": 1,
    "probabilities": { "candidate_0": 1, "candidate_1": 0, "none": 0 }
  }
}
```

The current policy requires an action probability of at least `0.6` and Choice confidence of at least `0.3`. A valid selection maps back to the original physical candidate. For this example, composition returns the following intervention.

```json
{ "candidateId": "reach:weave:1", "recheckAfterMs": 1800 }
```

The `1800` value hints when to reconsider selection. Assembly timing is controlled by the engine.

Lower probabilities, insufficient confidence, `none` or an invalid selection produce a hold. Choice confidence describes how concentrated the option distribution is; it does not prove that the model understood the player correctly. The thresholds are application policy in [`decision-request.ts`](../src/server/decision-request.ts).

### 5. Recheck, assemble and support

The browser receives the intervention and rechecks the current situation. If you have turned away, restarted or moved beyond the candidate's valid attachment, the answer can expire before execution. The runtime also checks available halves, clearance, bounds and collision.

An accepted contribution moves the available pieces into place. On a rolling route, the occupied 256-piece half remains beneath you while the free half rebuilds. The new surface becomes usable when assembly activates its support. Animation shows that physical state, including unfinished assembly.

## Changing direction and asking for height

At a matter edge, the request adds a `branch_intent` Noul with the instruction “Is the player asking the matter to branch toward a new direction from this edge, even if the current deck continues?” Its criteria distinguish movement or view off the side from continuing along the deck or looking around.

Looking up or down at that edge also adds `height_intent`, asking “Is the player asking the matter to climb or descend from this edge?” Recent behavior and view height distinguish a height request from surveying the scene.

These focused judgments join the same request. An action, branch or height probability of at least `0.6` can enable selection, still subject to Choice confidence and physical checks.

| Player behavior | Evidence used | Possible contribution |
| --- | --- | --- |
| Run toward a gap, then wait | Open space ahead and a recent traversal attempt | A walkable section or moving deck |
| Turn toward the side while on matter | Edge position, changed view and recent motion | A branch from a reachable rim |
| Look upward at the edge after an attempt | View height and recent behavior | A rising section |
| Reverse direction | Current heading, retreating motion and available attachments | A rebuilt route back |

These are situations the policy evaluates, not a fixed mapping from gestures to formations. The offered geometry and model judgment determine the actual result.

## Real-time play without frame-by-frame inference

Movement and physics run at 60 Hz while observations are sampled at 5 Hz. Jev requests have a minimum 1.5-second application cooldown. Exact checks skip inference when continuous support already serves the current direction; unchanged decisions are cached. New behavior and options change the request signature. Jev interprets traversal intent while the engine keeps the world moving.

Pause, restart and exit cancel pending selection, and late results are ignored. Provider failures preserve safe existing support and surface an unavailable status. Live mode never silently becomes Preview. Local Preview uses rules through the same selection interface and needs no provider.

Math, collision and piece accounting stay in code. Compact state and explicit criteria keep the model's job focused, consistent with TypeSafe's [Jev 1.13 guidance](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

To examine real decisions, use the [development session recorder](jev-session-audits.md). It saves the exact request, provider answer and actual game outcome so a convincing animation can be checked against what Jev selected and what the engine applied.
