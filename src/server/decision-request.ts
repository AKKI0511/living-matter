import { z } from "zod";
import { choice, noul, type Question, type SystemOneResult } from "@typesafe-ai/sdk";
import type { Intervention } from "@/game/decisions";
import { describeCandidate } from "@/game/semantic";
import { decisionState } from "@/game/decision-state";

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
type Context = z.infer<typeof decisionSchema>;
type Answers = SystemOneResult<Record<string, Question>>["answers"];

/** Build exactly the state and independent questions sent to Jev. */
export function buildDecisionRequest(context: Context) {
  const descriptions = new Set<string>();
  const options: Record<string, Record<string, string>> = Object.fromEntries(context.candidates.flatMap((candidate, i) => {
    const description = describeCandidate(candidate, context.observations.at(-1)!, context.semantic.matter_now.player_supported_by_matter);
    const signature = JSON.stringify(description);
    // Indistinguishable choices split probability without providing a useful
    // distinction. Keep the original index so composition maps it exactly.
    if (descriptions.has(signature)) return [];
    descriptions.add(signature);
    return [[`candidate_${i}`, description]];
  }));
  const values = Object.values(options);
  // A fact shared by every option cannot distinguish a Choice. Omitting it
  // once per option saves input without narrowing the physical candidate set.
  if (values.length > 1) for (const [key, value] of Object.entries(values[0])) {
    if (values.every(candidate => candidate[key] === value)) {
      for (const candidate of values) delete candidate[key];
    }
  }
  const questions: Record<string, Question> = {
    action_needed: noul("Do `player_now` and `recent_behavior` show an attempt to continue beyond existing support?", {
      true: "Moving toward unsupported space, waiting there after an attempt, or turning toward it on matter.",
      false: "Existing support serves the current direction, or the player is looking around or retreating on ground without a traversal attempt.",
    }),
    best_candidate: choice({
      question: "If a new section is needed, which reachable option best matches the player's current view and movement?",
      direction: "Prefer a reachable heading close to the current view when the player turns or pauses; use motion and recent behavior to disambiguate. Consider view height and side-rim attachments.",
    }, { ...options, none: "No option serves that direction from a reachable attachment." }),
  };
  if (context.semantic.matter_now.player_supported_by_matter &&
    context.semantic.player_now.position_on_support === "at an edge") {
    questions.branch_intent = noul("Is the player asking the matter to branch toward a new direction from this edge, even if the current deck continues?", {
      true: "Current view or recent movement points off the side of the existing support.",
      false: "The player is continuing along the existing support or looking around without a directional attempt.",
    });
    if (context.semantic.player_now.view_height !== "looking roughly level") {
      questions.height_intent = noul("Is the player asking the matter to climb or descend from this edge?", {
        true: "The upward or downward view and recent behavior indicate a height change from the current support.",
        false: "The player is only surveying above or below while continuing on the current support.",
      });
    }
  }
  // Unused support can remain until needed for a new offer. Judging cosmetic
  // withdrawal needs another question and adds no traversal capability.
  return { state: decisionState(context.semantic), questions };
}

export const decisionPolicy = {
  actionThreshold: 0.6,
  choiceConfidenceThreshold: 0.3,
  recheckAfterMs: 1800,
};
export function composeDecision(context: Context, answers: Answers): Intervention {
  const request = buildDecisionRequest(context);
  const probability = (key: string) => {
    const answer = answers[key];
    if (answer?.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)
      throw new Error(`Missing ${key} judgment`);
    return answer.noul;
  };
  const hold = { candidateId: null, hold: true, recheckAfterMs: decisionPolicy.recheckAfterMs };
  const branch = answers.branch_intent?.type === "noul" && Number.isFinite(answers.branch_intent.noul)
    ? answers.branch_intent.noul : 0;
  const height = answers.height_intent?.type === "noul" && Number.isFinite(answers.height_intent.noul)
    ? answers.height_intent.noul : 0;
  if (probability("action_needed") < decisionPolicy.actionThreshold &&
    branch < decisionPolicy.actionThreshold && height < decisionPolicy.actionThreshold) return hold;
  const answer = answers.best_candidate;
  if (answer?.type !== "choice" || !Number.isFinite(answer.confidence) || answer.confidence < decisionPolicy.choiceConfidenceThreshold)
    return hold;
  const match = /^candidate_(\d+)$/.exec(answer.choice);
  const index = match ? Number(match[1]) : -1;
  if (index < 0 || index >= context.candidates.length ||
    !(answer.choice in (request.questions.best_candidate.criteria ?? {}))) return hold;
  return { candidateId: context.candidates[index].id, recheckAfterMs: decisionPolicy.recheckAfterMs };
}
