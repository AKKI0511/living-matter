import { z } from "zod";
import { choice, noul, type Question, type SystemOneResult } from "@typesafe-ai/sdk";
import type { Intervention } from "@/game/decisions";
import { describeCandidate } from "@/game/semantic";
import { assertSemanticPrompt, decisionState } from "@/game/decision-state";

const vec = z.tuple([z.number().finite().min(-2000).max(2000), z.number().finite().min(-2000).max(2000), z.number().finite().min(-2000).max(2000)]);
const id = z.string().min(1).max(140).regex(/^[a-zA-Z0-9:._-]+$/);
const event = z.object({
  support: z.string().min(1).max(80),
  motion: z.string().min(1).max(100),
  position_on_support: z.string().max(100).optional(),
  facing_into: z.string().max(100).optional(),
  surface_beyond_facing: z.string().max(120).optional(),
  view_height: z.string().max(80).optional(),
});
export const decisionSchema = z.object({
  sessionId: z.uuid(),
  generation: z.number().int().nonnegative(),
  semantic: z.object({
    player_now: event,
    recent_behavior_oldest_to_newest: z.array(event).min(1).max(8),
    matter_now: z.object({
      state: z.enum(["idle", "forming", "active"]),
      form: z.string().max(100).optional(),
      player_supported_by_matter: z.boolean(),
      occupied_section: z.string().max(120).optional(),
      reusable_section: z.string().max(120).optional(),
      reusable_section_relative_to_player: z.string().max(40).optional(),
    }),
  }),
  observations: z.array(z.object({
    time: z.number().nonnegative(), position: vec, velocity: vec, gaze: vec,
    grounded: z.boolean(), activeStructure: id.nullable(),
  })).min(1).max(40),
  candidates: z.array(z.object({
    id, siteId: id,
    kind: z.enum(["bridge", "stairs", "platform", "floating-path", "weave"]),
    route: z.array(vec).min(2).max(6).optional(),
    weaveSegment: z.number().int().min(-10000).max(10000).optional(),
    attachment: z.enum(["near end", "far end", "middle"]).optional(),
    turnDegrees: z.number().min(-90).max(90).optional(),
    crossSlope: z.number().min(-0.5).max(0.5).optional(),
    physical: z.object({
      from: vec, to: vec,
      distance: z.number().nonnegative().max(2000),
      span: z.number().nonnegative().max(2000),
      rise: z.number().min(-100).max(100),
      medium: z.enum(["air", "water"]),
      landing: z.boolean().optional(),
    }),
  })).min(1).max(16),
  current: z.object({ candidateId: id, phase: z.string().max(24) }).optional(),
});
export type DecisionRequestContext = z.infer<typeof decisionSchema>;
type Context = DecisionRequestContext;
type Answers = SystemOneResult<Record<string, Question>>["answers"];

type Option = { label: string; description: Record<string, string>; candidates: Context["candidates"] };
function hash(text: string) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

/** Labels and ordering depend on meaning, never authored stage IDs or input order. */
export function decisionOptions(context: Context): Option[] {
  const groups = new Map<string, Option>();
  for (const candidate of context.candidates) {
    const description = describeCandidate(candidate, context.observations.at(-1)!, context.semantic.matter_now.player_supported_by_matter);
    const signature = JSON.stringify(description);
    const group = groups.get(signature);
    if (group) group.candidates.push(candidate);
    else groups.set(signature, { label: "", description, candidates: [candidate] });
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, option], index) => ({
    ...option, label: `option_${String.fromCharCode(97 + index)}`,
    // Equivalent semantic options keep their physical coverage. Code chooses
    // the nearest attachment; exact geometric tie-breaking is not Jev's job.
    candidates: option.candidates.sort((a, b) => a.physical.distance - b.physical.distance ||
      JSON.stringify([a.kind, a.physical, a.route]).localeCompare(JSON.stringify([b.kind, b.physical, b.route]))),
  }));
}

/** Build exactly the state and independent questions sent to Jev. */
export function buildDecisionRequest(context: Context) {
  const state = decisionState(context.semantic, context.observations);
  const groups = decisionOptions(context);
  // Rotate the canonical menu across sessions and changed behavior to avoid
  // presenting the easiest form first every time. Unchanged scenes stay stable.
  const offset = hash(context.sessionId + JSON.stringify(state)) % groups.length;
  const ordered = [...groups.slice(offset), ...groups.slice(0, offset)];
  const options = Object.fromEntries(ordered.map(group => [group.label, { ...group.description }]));
  const values = Object.values(options);
  const shared: Record<string, string> = {};
  // Shared facts still matter against `none`. Preserve them once in this
  // question rather than deleting the context or repeating it for every option.
  if (values.length > 1) for (const [key, value] of Object.entries(values[0])) {
    if (values.every(candidate => candidate[key] === value)) {
      shared[key] = value;
      for (const candidate of values) delete candidate[key];
    }
  }
  const questions: Record<string, Question> = {
    action_needed: noul("Do `player_now` and `recent_behavior_oldest_to_newest` indicate an attempt to continue across a gap beyond the current walking surface?", {
      true: "Moving or jumping toward a gap; waiting there after an unsuccessful attempt; or turning toward a gap on formed material and then holding that view.",
      false: "Movement stays on a continuous walking surface; retreating from the gap; or surveying with a changing view and no traversal attempt.",
    }),
    best_candidate: choice({
      question: "Assuming the person wants a new way onward, which reachable formation best serves the direction and height indicated by their behavior?",
      direction: "Follow attempted movement while moving, including sideways or backward. When waiting, use recent attempts and a held view. Match higher or lower ground and changes in view height. Walking paths and moving decks are valid alternatives; straight and level paths have no default preference.",
      spatial_meaning: "starts_from locates the attachment relative to the person; heading describes travel from that attachment. Alignment compares the next surface with current view or movement. eventual_destination is reached after further continuation; vertical_change describes the next surface.",
      ...(Object.keys(shared).length ? { shared_option_facts: shared } : {}),
    }, { ...options, none: "The available formations do not serve the indicated direction or height." }),
  };
  if (context.semantic.matter_now.player_supported_by_matter &&
    context.semantic.player_now.position_on_support === "at an edge") {
    questions.branch_intent = noul("At this edge of formed material, does the person's behavior indicate a new walking direction instead of following the existing surface?", {
      true: "Movement leaves the existing surface sideways or backward, or a turn toward a gap followed by a held view indicates a new direction.",
      false: "Following the existing surface, sweeping the view around, or glancing aside without matching movement or a held view after turning.",
    });
    if (["looking upward", "looking downward"].includes(context.semantic.player_now.view_height ?? "")) {
      questions.height_intent = noul("At this edge of formed material, does the person's behavior indicate wanting a higher or lower walking surface?", {
        true: "Movement or a jump toward different-height ground; or arriving at the edge, changing view upward or downward, and then holding that view.",
        false: "A brief vertical glance, a changing survey of the scene, or continuing on the existing surface without evidence of a height-change attempt.",
      });
    }
  }
  // Unused support can remain until needed for a new offer. Judging cosmetic
  // withdrawal needs another question and adds no traversal capability.
  const request = { state, questions };
  assertSemanticPrompt(request);
  return request;
}

export const decisionPolicy = {
  actionThreshold: 0.6,
  choiceConfidenceThreshold: 0.3,
  acceptableCandidateMass: 0.85,
  preferenceTieRatio: 0.85,
  recheckAfterMs: 1800,
};
export function composeDecision(context: Context, answers: Answers): Intervention {
  const request = buildDecisionRequest(context);
  const hold = { candidateId: null, hold: true, recheckAfterMs: decisionPolicy.recheckAfterMs };
  if (context.current?.phase === "forming" || context.semantic.matter_now.state === "forming") return hold;
  const probability = (key: string) => {
    const answer = answers[key];
    if (answer?.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)
      throw new Error(`Missing ${key} judgment`);
    return answer.noul;
  };
  const branch = request.questions.branch_intent ? probability("branch_intent") : 0;
  const height = request.questions.height_intent ? probability("height_intent") : 0;
  if (probability("action_needed") < decisionPolicy.actionThreshold &&
    branch < decisionPolicy.actionThreshold && height < decisionPolicy.actionThreshold) return hold;
  const answer = answers.best_candidate;
  if (answer?.type !== "choice" || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
    throw new Error("Invalid formation judgment");
  const options = decisionOptions(context);
  const selected = options.find(option => option.label === answer.choice);
  if (!selected) return hold;
  const distribution = answer.probabilities;
  const labels = [...options.map(option => option.label), "none"];
  if (!distribution || Object.keys(distribution).some(label => !labels.includes(label)) ||
    labels.some(label => !Number.isFinite(distribution[label]) || distribution[label] < 0 || distribution[label] > 1) ||
    Math.abs(labels.reduce((sum, label) => sum + distribution[label], 0) - 1) > 0.01)
    throw new Error("Invalid formation probabilities");
  let chosen = selected;
  if (answer.confidence < decisionPolicy.choiceConfidenceThreshold) {
    if (1 - distribution.none < decisionPolicy.acceptableCandidateMass) return hold;
    const latest = context.observations.at(-1)!;
    const moving = Math.hypot(latest.velocity[0], latest.velocity[2]) > 0.6;
    const travelFollowsView = !moving || (latest.velocity[0] * latest.gaze[0] + latest.velocity[2] * latest.gaze[2]) /
      (Math.hypot(latest.velocity[0], latest.velocity[2]) * (Math.hypot(latest.gaze[0], latest.gaze[2]) || 1)) > 0.75;
    const ground = travelFollowsView ? context.semantic.player_now.surface_beyond_facing : undefined;
    const desiredHeight = height >= decisionPolicy.actionThreshold
      ? context.semantic.player_now.view_height === "looking upward" ? "higher" : "lower"
      : ground?.endsWith(" higher") ? "higher" : ground?.endsWith(" lower") ? "lower" : undefined;
    const top = Math.max(...options.map(option => distribution[option.label]));
    const suitable = options.filter(option => distribution[option.label] >= top * decisionPolicy.preferenceTieRatio &&
      ["aligned", "close"].includes(option.description[moving ? "movement_alignment" : "view_alignment"]) &&
      (!desiredHeight || (height >= decisionPolicy.actionThreshold ? option.description.vertical_change :
        option.description.destination_height ?? option.description.vertical_change) === desiredHeight));
    if (!suitable.length) return hold;
    // Low concentration can mean several useful alternatives. Preserve current
    // commitment, otherwise use stable session diversity among comparable fits.
    chosen = suitable.find(option => option.candidates.some(candidate => candidate.id === context.current?.candidateId)) ??
      suitable[hash(context.sessionId + JSON.stringify(request.state)) % suitable.length];
  }
  const candidate = chosen.candidates.find(candidate => candidate.id === context.current?.candidateId) ?? chosen.candidates[0];
  return { candidateId: candidate.id, recheckAfterMs: decisionPolicy.recheckAfterMs };
}
