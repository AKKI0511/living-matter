# How Jev reads movement

Jev reads a short description of your surroundings, movement and recent attempts. It judges whether you want a way onward and chooses a reachable formation. The engine builds it and protects the surface beneath you.

## A scene described in words

Every request explains that a person explores separated walking surfaces above water, and that living matter is material that can become a walking surface or a moving deck. Directions follow the person's view. The model receives no screenshots or prior knowledge of the game.

The current scene describes solid ground or formed material underfoot, movement, proximity to an edge, the gap or walking surface ahead, separate ground beyond a gap, and whether the view is held or changing. Recent events retain edge and view-height changes, turns, jumps and unsuccessful attempts. Repeated descriptions are removed; a recent failed traversal is retained when history is shortened.

All model-facing state, instructions and options contain semantic text. Coordinates, clocks, distances, angles, identifiers and quantities stay in code. Digit-free option labels map back to physical candidates on the server. A recursive guard rejects numeric values, digits, number words and measurement text before calling Jev. The API's model selector and returned probabilities remain transport metadata and outputs.

## What Jev is asked

The independent questions share the scene and run together:

| Question | What it judges |
| --- | --- |
| action_needed | Whether movement or a recent attempt asks to continue across a gap. |
| best_candidate | Assuming a way onward is wanted, which formation serves the attempted direction and height. |
| branch_intent | At an edge of formed material, whether behavior asks for a new direction. |
| height_intent | At that edge, whether behavior asks for a higher or lower surface. Included only when an upward or downward view is observed. |

An isolated glance is different from turning at an edge and holding the new view. Walking sideways or backward can indicate a direction different from where you look. Each question states its own meaning and evidence; it cannot see another question's answer.

## Keeping useful formations available

Options describe walking or riding, their attachment, travel direction, alignment with movement and view, rising or falling, bends or turns, surface tilt, and where the surface leads. A short rising section remains a rise even when collision clearance shortens it.

Straight paths, climbs, descents, turning paths with arched support, broad side branches, tilted surfaces and moving decks remain distinguishable when physically available. The prompt gives straight or level paths no automatic preference. Whole-form families also remain distinct when supplied by the physical menu; this change does not add new geometry.

Shared facts are preserved once in the Choice instruction. Semantically equivalent options are grouped while retaining their physical candidates; code selects the nearest equivalent attachment. The semantic labels survive input reordering and stage renaming. Presentation order rotates across sessions and changed scenes, staying stable for an unchanged scene.

## Acting on the answer

An uncertain request or an explicit no-match holds the current support. If intent is clear but probability is spread over comparable, aligned alternatives, code can choose among those alternatives rather than stall solely on low Choice concentration. It preserves an existing commitment when available and uses stable session variation among comparable fits otherwise. Directions opposed to the attempt and malformed probabilities are rejected.

These are application policy choices, with thresholds kept in code. They are starting values for gameplay evaluation, not accuracy guarantees. Forming material is held; the engine never retracts occupied support. Provider failures continue through preview automatically.

## Inspecting decisions

The [development session recorder](jev-session-audits.md) saves exact inputs, answers and outcomes. An older recording with different questions or option meanings is marked `prompt_changed`; its answer is not silently recomposed against the new prompt. Human-labeled historical inputs remain exportable.

Implementation: [`decision-state.ts`](../src/game/decision-state.ts), [`semantic.ts`](../src/game/semantic.ts), [`decision-request.ts`](../src/server/decision-request.ts).

Official guidance: [state](https://docs.typesafe.ai/concepts/state), [Noul](https://docs.typesafe.ai/primitives/noul), [Choice](https://docs.typesafe.ai/primitives/choice), [independent speculative questions](https://docs.typesafe.ai/patterns/fan-out), [confidence](https://docs.typesafe.ai/confidence), and [Jev's semantic representations and option-order guidance](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
