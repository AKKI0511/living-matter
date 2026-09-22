import { z } from "zod";
import {
  noul,
  score,
  type Question,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import type { Intervention } from "@/game/decisions";

const vec = z.tuple([
  z.number().finite().min(-2000).max(2000),
  z.number().finite().min(-2000).max(2000),
  z.number().finite().min(-2000).max(2000),
]);
const id = z
  .string()
  .min(1)
  .max(140)
  .regex(/^[a-zA-Z0-9:._-]+$/);
export const decisionSchema = z.object({
  generation: z.number().int().nonnegative(),
  observations: z
    .array(
      z.object({
        time: z.number().nonnegative(),
        position: vec,
        velocity: vec,
        gaze: vec,
        grounded: z.boolean(),
        activeStructure: id.nullable(),
      }),
    )
    .min(1)
    .max(40),
  candidates: z
    .array(
      z.object({
        id,
        siteId: id,
        kind: z.enum([
          "bridge",
          "stairs",
          "platform",
          "floating-path",
          "weave",
        ]),
        route: z.array(vec).min(2).max(6).optional(),
        physical: z.object({
          from: vec,
          to: vec,
          distance: z.number().nonnegative().max(2000),
          span: z.number().nonnegative().max(2000),
          rise: z.number().min(-100).max(100),
          medium: z.enum(["air", "water"]),
        }),
      }),
    )
    .min(1)
    .max(16),
  objective: vec.optional(),
  current: z.object({ candidateId: id, phase: z.string().max(24) }).optional(),
  assistance: z
    .array(
      z.object({
        time: z.number().nonnegative(),
        candidateId: id,
        outcome: z.enum(["offered", "used", "abandoned"]),
      }),
    )
    .max(24)
    .optional(),
});

type Context = z.infer<typeof decisionSchema>;
type Answers = SystemOneResult<Record<string, Question>>["answers"];
const rounded = (v: number) => Math.round(v * 10) / 10;

function targetGroups(context: Context) {
  const points: number[][] = [];
  const indices = context.candidates.map((c) => {
    let i = points.findIndex((p) => p.every((v, a) => v === c.physical.to[a]));
    if (i < 0) {
      i = points.length;
      points.push(c.physical.to);
    }
    return i;
  });
  return { points, indices };
}

/** Independent snap judgments share one bounded state; code owns the decision. */
export function buildDecisionRequest(context: Context) {
  const latest = context.observations.at(-1)!;
  const history = context.observations
    .filter(
      (o, i, all) =>
        i % 4 === 0 ||
        i === all.length - 1 ||
        (o.velocity[1] > 2 && (all[i - 1]?.velocity[1] ?? 0) <= 2),
    )
    .slice(-14);
  const groups = targetGroups(context);
  const targets = groups.points.map((point) => ({
    relativePosition: point.map((v, a) => rounded(v - latest.position[a])),
    readings: history.map((o) => {
      const dx = point[0] - o.position[0],
        dz = point[2] - o.position[2],
        distance = Math.hypot(dx, dz) || 1;
      return {
        ago: rounded(latest.time - o.time),
        distance: rounded(distance),
        gazeAlignment: rounded((o.gaze[0] * dx + o.gaze[2] * dz) / distance),
        speedToward: rounded(
          (o.velocity[0] * dx + o.velocity[2] * dz) / distance,
        ),
      };
    }),
  }));
  const options = context.candidates.map((c, i) => ({
    target: groups.indices[i],
    kind: c.kind,
    entryRelative: c.physical.from.map((v, a) =>
      rounded(v - latest.position[a]),
    ),
    span: rounded(c.physical.span),
    rise: rounded(c.physical.rise),
    medium: c.physical.medium,
    movement:
      c.kind === "platform"
        ? "Stand or walk on a deck that carries the player between shores."
        : c.kind === "weave"
          ? "Walk a path assembled in sections; the occupied half remains solid while the other half rebuilds ahead or behind."
          : "Walk over a stationary structure.",
    steps:
      c.route?.slice(1).map((point, j) => {
        const rise = point[1] - c.route![j][1];
        return {
          form:
            Math.abs(rise) > 0.2
              ? "stairs"
              : c.physical.medium === "water"
                ? "floating walkway"
                : "bridge",
          rise: rounded(rise),
          sideways: rounded(point[0] - c.route![j][0]),
          run: rounded(
            Math.hypot(point[0] - c.route![j][0], point[2] - c.route![j][2]),
          ),
        };
      }) ?? [],
  }));
  const questions: Record<string, Question> = {
    redirect: noul(
      "Do the recent `observations` show the player changing their travel goal?",
      {
        true: "Recent movement and gaze depart from the earlier sustained direction.",
        false:
          "The same goal persists, including waiting for an unfinished crossing.",
      },
    ),
  };
  targets.forEach((_, i) => {
    questions[`target_${i}`] = noul(
      `Does the player's behavior in \`targets[${i}].readings\` and \`observations\` suggest they are trying to reach \`targets[${i}]\`?`,
      {
        true: "Sustained approach, repeated attempts, or waiting while facing this destination suggest trying to reach it. Returning is as valid as advancing.",
        false:
          "Looking past briefly, retreating, or exploring elsewhere without attempts toward this destination.",
      },
    );
  });
  options.forEach((_, i) => {
    questions[`fit_${i}`] = score(
      `How well does the mode of traversal in \`options[${i}].movement\` and \`options[${i}].steps\` match the player's movement pattern in \`observations\`?`,
      [
        "The mode contradicts the player's sustained movement pattern, such as requiring passive riding while they repeatedly try to walk onward.",
        "There is no clear behavioral evidence for this mode of traversal.",
        "The mode accommodates the player's current walking, waiting to ride, or attempts to gain height.",
        "The mode directly accommodates a repeated, sustained pattern of walking onward, waiting to ride, or climbing attempts.",
      ],
    );
  });
  if (context.current)
    questions.withdraw = noul(
      "Does `observations` show the player abandoning the offered assistance in `current`?",
      {
        true: "They consistently move away from its destination or reject it after approaching.",
        false:
          "They use it, approach it, pause on it, or wait for the next section to assemble.",
      },
    );
  return {
    state: {
      units:
        "Coordinates and distances are metres; speed is metres/second. Gaze alignment ranges from -1 (away) to 1 (toward). These are physical measurements, not inferred intent.",
      observations: history.map((o) => ({
        ago: rounded(latest.time - o.time),
        displacement: o.position.map((v, a) => rounded(v - latest.position[a])),
        velocity: o.velocity.map(rounded),
        gaze: o.gaze.map(rounded),
        grounded: o.grounded,
      })),
      targets,
      options,
      current: context.current
        ? {
            kind: context.current.candidateId.split(":")[1],
            phase: context.current.phase,
            option: context.candidates.findIndex(
              (c) => c.id === context.current!.candidateId,
            ),
          }
        : null,
      assistance:
        context.assistance
          ?.slice(-6)
          .map((a) => ({
            ago: rounded(latest.time - a.time),
            kind: a.candidateId.split(":")[1],
            outcome: a.outcome,
          })) ?? [],
    },
    questions,
  };
}

// Initial playtest policy, not calibrated model thresholds. Scores measure fit;
// Noul values measure probability. Confidence is diagnostic, not a safety certificate.
export const decisionPolicy = {
  targetMinimum: 0.6,
  fitMinimum: 0.45,
  targetWeight: 0.7,
  switchMargin: 0.1,
  withdrawalMinimum: 0.8,
};
export function composeDecision(
  context: Context,
  answers: Answers,
): Intervention {
  const probability = (key: string) => {
    const a = answers[key];
    if (a?.type !== "noul" || !Number.isFinite(a.noul))
      throw new Error("Missing probability judgment");
    return Math.max(0, Math.min(1, a.noul));
  };
  const fit = (key: string) => {
    const a = answers[key];
    if (a?.type !== "score" || !Number.isFinite(a.score))
      throw new Error("Missing fit judgment");
    return Math.max(0, Math.min(1, a.score / 3));
  };
  const { indices } = targetGroups(context);
  const ranks = context.candidates
    .map((c, i) => {
      const target = probability(`target_${indices[i]}`),
        method = fit(`fit_${i}`);
      return {
        candidate: c,
        eligible:
          target >= decisionPolicy.targetMinimum &&
          method >= decisionPolicy.fitMinimum,
        value:
          target * decisionPolicy.targetWeight +
          method * (1 - decisionPolicy.targetWeight),
      };
    })
    .filter((c) => c.eligible)
    .sort(
      (a, b) =>
        b.value - a.value ||
        Number(b.candidate.kind === "weave") -
          Number(a.candidate.kind === "weave"),
    );
  const recheckAfterMs = probability("redirect") > 0.6 ? 1500 : 6000;
  const current = ranks.find(
    (r) => r.candidate.id === context.current?.candidateId,
  );
  if (current && ranks[0].value - current.value < decisionPolicy.switchMargin)
    return { candidateId: current.candidate.id, recheckAfterMs };
  if (ranks[0]) return { candidateId: ranks[0].candidate.id, recheckAfterMs };
  if (context.current) {
    if (probability("withdraw") >= decisionPolicy.withdrawalMinimum)
      return { candidateId: null, recheckAfterMs };
    return { candidateId: null, hold: true, recheckAfterMs };
  }
  return { candidateId: null, recheckAfterMs };
}
