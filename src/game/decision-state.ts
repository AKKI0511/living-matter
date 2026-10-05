import type { PhysicalEvent, SemanticState } from "./semantic";
import type { Observation } from "./decisions";
import { deliberateHeightView, heldView } from "./view-intent";

const directions = ["forward", "ahead", "ahead-right", "right", "behind-right", "behind", "behind-left", "left", "ahead-left"];
const summaries = ["jumping", "falling", "standing", "turned toward unsupported space and stopped", "turned on the support and stopped",
  "jumped and landed back on the same support", "jumped and landed on another support", "fell off the support and returned"];
const motions = new Set([...summaries, ...["walking", "running"].flatMap(speed => directions.map(direction => `${speed} ${direction}`))]);
const heights = new Set(["looking upward", "looking downward", "looking roughly level"]);
const walkwayAxes = new Set(["ahead to behind", "left to right across view", "ahead-left to behind-right", "ahead-right to behind-left"]);

/** Translate engine vocabulary, never forward arbitrary client text to the model. */
function sceneEvent(event: PhysicalEvent) {
  return {
    support: event.support === "permanent ground" ? "solid ground" : event.support === "living matter" ? "formed material" : event.support === "unsupported" ? "not standing on a surface" : "support not observed",
    motion: motions.has(event.motion) ? event.motion : "movement not observed",
    ...(event.position_on_support ? { position_on_support: event.position_on_support === "at an edge" ? "at the surface edge" :
      event.position_on_support === "near an edge" ? "near the surface edge" : event.position_on_support === "inside the support" ? "inside the walking surface" : "edge position not observed" } : {}),
    ...(event.facing_into ? { facing_into: event.facing_into === "living matter" ? "continuous formed walking surface" :
      event.facing_into === "walkable ground" ? "continuous solid ground" : event.facing_into === "open air" ? "gap without a continuous walking surface" : "walking surface ahead not observed" } : {}),
    ...(event.surface_beyond_facing ? { ground_across_gap: event.surface_beyond_facing === "separate walkable ground higher" ? "higher solid ground" :
      event.surface_beyond_facing === "separate walkable ground lower" ? "lower solid ground" : event.surface_beyond_facing === "separate walkable ground at similar height" ? "solid ground at similar height" : "ground across the gap not observed" } : {}),
    ...(event.view_height && heights.has(event.view_height) ? { view_height: event.view_height } : {}),
    ...(event.support === "living matter" && event.walkway_axis && walkwayAxes.has(event.walkway_axis) ? {
      view_to_walkway: event.walkway_axis === "ahead to behind" ? "along the walkway" :
        event.walkway_axis === "left to right across view" ? "across the walkway toward its side" : "diagonally across the walkway",
    } : {}),
  };
}

/** View persistence is measured in code, described without a time or angle. */
function viewAttention(observations: readonly Observation[]) {
  const latest = observations.at(-1);
  if (!latest) return "view persistence not observed";
  const recent = observations.filter(o => latest.time >= o.time && latest.time - o.time <= 0.9);
  if (recent.length < 2 || latest.time - recent[0].time < 0.6) return "view persistence not observed";
  const stable = heldView(observations);
  return stable ? "view held in the same direction" : "view is changing direction";
}

/** Self-contained scene facts; no identifiers, measurements or hidden game lore. */
export function decisionState(semantic: SemanticState, observations: readonly Observation[] = []) {
  const now = sceneEvent(semantic.player_now);
  // Landing back on continuous ground closes the preceding attempt. Do not
  // reinsert an old jump/fall into a later, unrelated crossing request.
  const resolved = semantic.recent_behavior_oldest_to_newest.findLastIndex(event =>
    event.support === "permanent ground" && event.facing_into === "walkable ground" &&
    ["jumped and landed back on the same support", "jumped and landed on another support", "fell off the support and returned"].includes(event.motion));
  const history = semantic.recent_behavior_oldest_to_newest.slice(resolved + 1).map(sceneEvent)
    .filter((event, i, events) => !i || JSON.stringify(event) !== JSON.stringify(events[i - 1]));
  if (JSON.stringify(history.at(-1)) === JSON.stringify(now)) history.pop();
  // Current direction/height live in player_now. Old camera-relative directions
  // and old height looks must not masquerade as current instructions. Keep only
  // the latest transitions; do not resurrect an older failed attempt.
  const recent = history.slice(-2).map(event => {
    const { view_height: _height, view_to_walkway: _view, ground_across_gap: _ground, ...earlier } = event;
    return earlier;
  });
  return {
    scene: "Separated ground above water; living matter reshapes into walkways or a moving deck.",
    directions: "Current directions use current view; history uses earlier views. Heights compare walking surfaces.",
    player_now: { ...now, view_attention: viewAttention(observations) },
    recent_behavior_oldest_to_newest: recent,
    material_now: {
      state: semantic.matter_now.state === "idle" ? "not formed" : semantic.matter_now.state === "forming" ? "reshaping" : "ready to walk on or ride",
      ...(semantic.matter_now.player_supported_by_matter ? {
        available_change: "Occupied support stays; unused material can reshape.",
        continuation: semantic.matter_now.reusable_section_relative_to_player === "ahead" ? "Existing continuation ahead" : "Continuation elsewhere or unobserved",
      } : {}),
    },
  };
}

/** Reject numeric leaks in keys as well as values before any provider call. */
export function assertSemanticPrompt(value: unknown): void {
  if (typeof value === "string") {
    if (/\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|half|quarter|first|second|third|degrees?|units?|seconds?|milliseconds?)\b/i.test(value))
      throw new Error("Numeric detail in semantic prompt");
    return;
  }
  if (Array.isArray(value)) { value.forEach(assertSemanticPrompt); return; }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) { assertSemanticPrompt(key); assertSemanticPrompt(entry); }
    return;
  }
  throw new Error("Non-semantic value in prompt");
}

/** Continuous support in the current travel direction is an exact physical fact. */
export function currentDirectionServed(semantic: SemanticState | undefined, observations: readonly Observation[] = []) {
  if (!semantic) return false;
  const now = semantic.player_now;
  // At a matter rim the next step is a player choice even if the centre of the
  // current deck continues ahead. Suppressing the request here stranded players
  // who approached the right edge of a sloping continuation.
  if (semantic.matter_now.player_supported_by_matter &&
    now.position_on_support === "at an edge") return false;
  if (now.support === "unsupported" ||
    !["living matter", "walkable ground"].includes(now.facing_into ?? "")) return false;
  if (["near an edge", "at an edge"].includes(now.position_on_support ?? "") && deliberateHeightView(observations)) return false;
  if (["walking forward", "running forward"].includes(now.motion)) return true;
  if (now.motion !== "standing") return false;
  const previous = semantic.recent_behavior_oldest_to_newest.findLast(event => event.motion !== "standing");
  return !previous || ["walking forward", "running forward", "turned on the support and stopped"].includes(previous.motion);
}
