import { z } from "zod";
import { choice, noul, type Question, type SystemOneResult } from "@typesafe-ai/sdk";
import type { Intervention } from "@/game/decisions";
import { describeCandidate } from "@/game/semantic";
import { assertSemanticPrompt, decisionState } from "@/game/decision-state";
import { deliberateHeightView } from "@/game/view-intent";

const vec = z.tuple([z.number().finite().min(-2000).max(2000), z.number().finite().min(-2000).max(2000), z.number().finite().min(-2000).max(2000)]);
const id = z.string().min(1).max(140).regex(/^[a-zA-Z0-9:._-]+$/);
const event = z.object({
  support: z.string().min(1).max(80),
  motion: z.string().min(1).max(100),
  position_on_support: z.string().max(100).optional(),
  facing_into: z.string().max(100).optional(),
  surface_beyond_facing: z.string().max(120).optional(),
  view_height: z.string().max(80).optional(),
  walkway_axis: z.string().max(80).optional(),
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
  const options = Object.fromEntries(ordered.map(group => {
    const description = { ...group.description };
    delete description.player_use; // Walking path / moving deck already conveys its use.
    if (description.path_shape.startsWith("bends")) description.path_shape = description.path_shape.includes("left") ? "left curve toward destination" : "right curve toward destination";
    if (description.formation === "turning path with arched support") description.formation = "turning path";
    if (description.formation === "side branch with a broad base") description.formation = "side path";
    // Clearance and slope safety are already checked in code. These details
    // should not discourage a useful side exit or repeat physical validation.
    delete description.surface_tilt;
    return [group.label, description];
  }));
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
    action_needed: noul("Does `player_now` request new walking space? Current intent overrides earlier behavior.", {
      true: "Approaching gap; waiting after recent attempt; sideways departure; held view across walkway toward gap or new height.",
      false: "Travel already supported; retreat; surveying; unchanged route already offered.",
    }),
    best_candidate: choice({
      question: "If new walking space is wanted, which formation best serves `player_now`?",
      direction: "Current movement; held view while stopped. Current direction and height override history; shape or slope needn't continue.",
      ...(state.player_now.view_to_walkway ? { lateral_view: "Stopped with held view across the walkway toward a gap: favor a route toward that view over following the old walkway. A brief glance is not departure." } : {}),
      spatial_meaning: "vertical_change: next surface; destination_height: eventual ground.",
      ...(Object.keys(shared).length ? { shared_option_facts: shared } : {}),
    }, { ...options, none: "No formation fits intended direction and height." }),
  };
  if (context.semantic.matter_now.player_supported_by_matter &&
    (context.semantic.player_now.position_on_support === "at an edge" ||
      (state.player_now.view_to_walkway === "across the walkway toward its side" &&
        state.player_now.motion === "standing" && state.player_now.view_attention === "view held in the same direction" &&
        context.semantic.player_now.facing_into === "open air"))) {
    questions.branch_intent = noul("Does current movement or held view in `player_now` request departure from the occupied walkway?", {
      true: "Sideways/backward departure; held view across walkway toward gap.",
      false: "Following surface; surveying; brief glance aside.",
    });
  }
  if (["near an edge", "at an edge"].includes(context.semantic.player_now.position_on_support ?? "") &&
    ["looking upward", "looking downward"].includes(context.semantic.player_now.view_height ?? "") && deliberateHeightView(context.observations))
    questions.height_intent = noul("Does `player_now` indicate intent to ascend or descend?", {
      true: "Held upward/downward view at an edge toward a new route.",
      false: "Surveying; brief glance; following a route already offered.",
    });
  // Unused support can remain until needed for a new offer. Judging cosmetic
  // withdrawal needs another question and adds no traversal capability.
  const request = { state, questions };
  assertSemanticPrompt(request);
  return request;
}

export const decisionPolicy = {
  actionThreshold: 0.6,
  choiceConfidenceThreshold: 0.3,
  acceptableCandidateMass: 0.75,
  movingCandidateMass: 0.65,
  waitingCandidateMass: 0.6,
  waitingActionThreshold: 0.8,
  heightThreshold: 0.55,
  heightAgreementThreshold: 0.5,
  varietyTieRatio: 0.65,
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
  const answer = answers.best_candidate;
  const options = decisionOptions(context);
  const selected = answer?.type === "choice" ? options.find(option => option.label === answer.choice) : undefined;
  // A positive height judgment plus a credible matching Choice can establish
  // a climb/descent even when walking straight ahead is already supported.
  // This never substitutes a height option for Jev's actual selection.
  const intendedHeight = deliberateHeightView(context.observations);
  const agreedHeight = intendedHeight && selected && height > decisionPolicy.heightAgreementThreshold &&
    answer?.type === "choice" && Number.isFinite(answer.confidence) &&
    answer.confidence >= decisionPolicy.choiceConfidenceThreshold && answer.confidence <= 1 &&
    selected.description.vertical_change === intendedHeight;
  if (probability("action_needed") < decisionPolicy.actionThreshold &&
    branch < decisionPolicy.actionThreshold && height < decisionPolicy.heightThreshold && !agreedHeight) return hold;
  if (answer?.type !== "choice" || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
    throw new Error("Invalid formation judgment");
  if (!selected) return hold;
  const raw = answer.probabilities;
  const labels = [...options.map(option => option.label), "none"];
  if (!raw || Object.keys(raw).some(label => !labels.includes(label)) ||
    labels.some(label => !Number.isFinite(raw[label]) || raw[label] < 0 || raw[label] > 1))
    throw new Error("Invalid formation probabilities");
  const total = labels.reduce((sum, label) => sum + raw[label], 0);
  // Rounded replies can sum to 0.99 or 1.01. Include floating-point slack,
  // then normalize before interpreting the candidate probabilities.
  if (Math.abs(total - 1) > 0.01 + 1e-10)
    throw new Error("Invalid formation probabilities");
  const distribution = Object.fromEntries(labels.map(label => [label, raw[label] / total]));
  let chosen = selected;
  if (answer.confidence < decisionPolicy.choiceConfidenceThreshold) {
    const now = context.semantic.player_now;
    const waitingAtGap = now.motion === "standing" && now.support !== "unsupported" && now.facing_into === "open air" &&
      request.state.player_now.view_attention === "view held in the same direction" &&
      probability("action_needed") >= decisionPolicy.waitingActionThreshold;
    const latest = context.observations.at(-1)!;
    const moving = Math.hypot(latest.velocity[0], latest.velocity[2]) > 0.6;
    if (1 - distribution.none < (waitingAtGap ? decisionPolicy.waitingCandidateMass : moving ? decisionPolicy.movingCandidateMass : decisionPolicy.acceptableCandidateMass)) return hold;
    // The Choice already judges direction and height together. Separate Nouls
    // establish intent, not a second geometry/shape/height veto. Only avoid
    // blindly choosing an opposed route when Jev itself is uncertain.
    const compatible = options.filter(option => distribution[option.label] > 0 &&
      option.description[moving ? "movement_alignment" : "view_alignment"] !== "opposed");
    const top = Math.max(...compatible.map(option => distribution[option.label]));
    if (top < distribution.none) return hold;
    let suitable = compatible.filter(option => distribution[option.label] >= top * decisionPolicy.varietyTieRatio);
    // While already walking, vary walking shapes without turning Jev's walking
    // choice into a wait for a ride. An actual Jev ride choice stays available.
    if (moving && selected.description.player_use === "walk" && suitable.some(option => option.label === selected.label))
      suitable = suitable.filter(option => option.description.player_use === "walk");
    if (!suitable.length) return hold;
    // Keep a credible expressive Jev choice; resolve vague ordinary choices
    // through stable probability-weighted variety, including mixed heights.
    chosen = suitable.find(option => option.candidates.some(candidate => candidate.id === context.current?.candidateId)) ??
      (selected.description.path_shape !== "straight" && suitable.some(option => option.label === selected.label) ? selected : undefined) ??
      (() => {
        const total = suitable.reduce((sum,o) => sum + distribution[o.label],0);
        let draw = hash(context.sessionId + JSON.stringify(context.current ?? {}) + JSON.stringify(request.state.player_now)) / 0x100000000 * total;
        for (const option of suitable) { draw -= distribution[option.label]; if (draw <= 0) return option; }
        return suitable.at(-1)!;
      })();
  }
  const candidate = chosen.candidates.find(candidate => candidate.id === context.current?.candidateId) ?? chosen.candidates[0];
  return { candidateId: candidate.id, recheckAfterMs: decisionPolicy.recheckAfterMs };
}
