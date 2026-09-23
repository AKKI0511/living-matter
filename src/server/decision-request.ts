import { z } from "zod";
import { choice, noul, type Question, type SystemOneResult } from "@typesafe-ai/sdk";
import type { Intervention } from "@/game/decisions";
import { describeCandidate } from "@/game/semantic";

const vec = z.tuple([z.number().finite().min(-2000).max(2000), z.number().finite().min(-2000).max(2000), z.number().finite().min(-2000).max(2000)]);
const id = z.string().min(1).max(140).regex(/^[a-zA-Z0-9:._-]+$/);
const event = z.object({
  support: z.string().min(1).max(80),
  motion: z.string().min(1).max(100),
  position_on_support: z.string().max(100).optional(),
  facing_into: z.string().max(100).optional(),
  surface_beyond_facing: z.string().max(120).optional(),
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
    physical: z.object({
      from: vec, to: vec,
      distance: z.number().nonnegative().max(2000),
      span: z.number().nonnegative().max(2000),
      rise: z.number().min(-100).max(100),
      medium: z.enum(["air", "water"]),
    }),
  })).min(1).max(16),
  current: z.object({ candidateId: id, phase: z.string().max(24) }).optional(),
});
type Context = z.infer<typeof decisionSchema>;
type Answers = SystemOneResult<Record<string, Question>>["answers"];

/** Build exactly the state and independent questions sent to Jev. */
export function buildDecisionRequest(context: Context) {
  const questions: Record<string, Question> = {
    action_needed: noul({
      question: "Does the recent physical behavior suggest that living matter should change now to support the direction the player is trying to continue?",
      inspect: ["`player_now`", "`recent_behavior_oldest_to_newest`", "`matter_now`"],
    }, {
      true: "The recent behavior repeatedly presses into unsupported space, repeats a traversal attempt, waits at an unsupported edge after such behavior, or changes direction while on living matter toward space the current matter does not serve.",
      false: "The player is moving normally on sufficient support, is only looking around, has settled into going elsewhere, or the current matter already supports the direction they are continuing.",
    }),
    best_candidate: choice({
      question: "Assuming living matter should change now, which candidate best matches the player's recent direction and manner of movement?",
      inspect: ["`player_now`", "`recent_behavior_oldest_to_newest`", "`matter_now`"],
      focus: "Choose among the supplied physical actions.",
    }, Object.fromEntries(context.candidates.map((candidate, i) => [
      `candidate_${i}`,
      describeCandidate(candidate, context.observations.at(-1)!, context.semantic.matter_now.player_supported_by_matter),
    ]))),
  };
  if (context.current && !context.semantic.matter_now.player_supported_by_matter)
    questions.abandoned_current = noul({
      question: "Has the player abandoned the currently offered living matter?",
      inspect: ["`player_now`", "`recent_behavior_oldest_to_newest`", "`matter_now`"],
    }, {
      true: "The player is off the offered matter and the recent behavior continues away from using it.",
      false: "The player is approaching it, returning to it, waiting for it, or otherwise still behaving as if they may use it.",
    });
  return { state: context.semantic, questions };
}

export const decisionPolicy = {
  actionThreshold: 0.6,
  choiceConfidenceThreshold: 0.3,
  abandonThreshold: 0.8,
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
  if (request.questions.abandoned_current && probability("abandoned_current") >= decisionPolicy.abandonThreshold)
    return { candidateId: null, recheckAfterMs: decisionPolicy.recheckAfterMs };
  if (probability("action_needed") < decisionPolicy.actionThreshold) return hold;
  const answer = answers.best_candidate;
  if (answer?.type !== "choice" || !Number.isFinite(answer.confidence) || answer.confidence < decisionPolicy.choiceConfidenceThreshold)
    return hold;
  const match = /^candidate_(\d+)$/.exec(answer.choice);
  const index = match ? Number(match[1]) : -1;
  if (index < 0 || index >= context.candidates.length) return hold;
  return { candidateId: context.candidates[index].id, recheckAfterMs: decisionPolicy.recheckAfterMs };
}
