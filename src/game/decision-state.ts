import type { PhysicalEvent, SemanticState } from "./semantic";
import type { Observation } from "./decisions";

const directions = ["forward", "ahead", "ahead-right", "right", "behind-right", "behind", "behind-left", "left", "ahead-left"];
const summaries = ["jumping", "falling", "standing", "turned toward unsupported space and stopped", "turned on the support and stopped",
  "jumped and landed back on the same support", "jumped and landed on another support", "fell off the support and returned"];
const motions = new Set([...summaries, ...["walking", "running"].flatMap(speed => directions.map(direction => `${speed} ${direction}`))]);
const heights = new Set(["looking upward", "looking downward", "looking roughly level"]);

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
  };
}

/** View persistence is measured in code, described without a time or angle. */
function viewAttention(observations: readonly Observation[]) {
  const latest = observations.at(-1);
  if (!latest) return "view persistence not observed";
  const recent = observations.filter(o => latest.time >= o.time && latest.time - o.time <= 0.9);
  if (recent.length < 2 || latest.time - recent[0].time < 0.6) return "view persistence not observed";
  const pitch = (o: Observation) => o.gaze[1] > 0.15 ? "up" : o.gaze[1] < -0.15 ? "down" : "level";
  const stable = recent.every(o => pitch(o) === pitch(latest) &&
    (o.gaze[0] * latest.gaze[0] + o.gaze[2] * latest.gaze[2]) /
    ((Math.hypot(o.gaze[0], o.gaze[2]) || 1) * (Math.hypot(latest.gaze[0], latest.gaze[2]) || 1)) > 0.93);
  return stable ? "view held in the same direction" : "view is changing direction";
}

/** Self-contained scene facts; no identifiers, measurements or hidden game lore. */
export function decisionState(semantic: SemanticState, observations: readonly Observation[] = []) {
  const now = sceneEvent(semantic.player_now);
  const history = semantic.recent_behavior_oldest_to_newest.map(sceneEvent)
    .filter((event, i, events) => !i || JSON.stringify(event) !== JSON.stringify(events[i - 1]));
  if (JSON.stringify(history.at(-1)) === JSON.stringify(now)) history.pop();
  const recent = history.slice(-4);
  const attempt = history.findLast(event => ["jumped and landed back on the same support", "fell off the support and returned"].includes(event.motion));
  if (attempt && !recent.includes(attempt)) recent.splice(0, 1, attempt);
  return {
    scene: "A person explores separated walking surfaces above water. Living matter is material that can reshape into walking surfaces or a moving deck. A gap has no continuous surface to walk on.",
    directions: "Ahead, behind, left and right follow the person's view at the described moment. Candidate directions use their current view. Higher and lower compare walking surfaces.",
    player_now: { ...now, view_attention: viewAttention(observations) },
    recent_behavior_oldest_to_newest: recent,
    material_now: {
      state: semantic.matter_now.state === "idle" ? "not formed" : semantic.matter_now.state === "forming" ? "reshaping" : "ready to walk on or ride",
      ...(semantic.matter_now.player_supported_by_matter ? { available_change: "Material beneath the person stays in place; unused material can reshape." } : {}),
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
export function currentDirectionServed(semantic: SemanticState | undefined) {
  if (!semantic) return false;
  const now = semantic.player_now;
  // At a matter rim the next step is a player choice even if the centre of the
  // current deck continues ahead. Suppressing the request here stranded players
  // who approached the right edge of a sloping continuation.
  if (semantic.matter_now.player_supported_by_matter &&
    now.position_on_support === "at an edge") return false;
  if (now.support === "unsupported" ||
    !["living matter", "walkable ground"].includes(now.facing_into ?? "") ||
    (now.view_height && now.view_height !== "looking roughly level")) return false;
  if (["walking forward", "running forward"].includes(now.motion)) return true;
  if (now.motion !== "standing") return false;
  const previous = semantic.recent_behavior_oldest_to_newest.findLast(event => event.motion !== "standing");
  return !previous || ["walking forward", "running forward", "turned on the support and stopped"].includes(previous.motion);
}
