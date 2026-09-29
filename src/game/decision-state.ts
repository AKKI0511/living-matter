import type { SemanticState } from "./semantic";

/** Only evidence needed for intent and the next physical choice. */
export function decisionState(semantic: SemanticState) {
  const now = semantic.player_now;
  const history = semantic.recent_behavior_oldest_to_newest
    .filter((event, i, events) => i !== events.length - 1 || JSON.stringify(event) !== JSON.stringify(now))
    .map(({ support, motion, facing_into }) => ({ support, motion, ...(facing_into ? { facing_into } : {}) }))
    .filter((event, i, events) => !i || JSON.stringify(event) !== JSON.stringify(events[i - 1]))
    .slice(-4);
  return {
    player_now: now,
    recent_behavior: history,
    matter_now: {
      state: semantic.matter_now.state,
      player_supported_by_matter: semantic.matter_now.player_supported_by_matter,
    },
  };
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
