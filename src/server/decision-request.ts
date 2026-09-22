import { z } from "zod";
import { choice, noul } from "@typesafe-ai/sdk";

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

/** Shared state is sent once for three independent, consumed judgments. */
export function buildDecisionRequest(context: z.infer<typeof decisionSchema>) {
  const last = context.observations.at(-1)!;
  const rounded = (v: number) => Math.round(v * 10) / 10;
  const observations = context.observations
    .filter(
      (o, i, all) =>
        i % 4 === 0 ||
        i === all.length - 1 ||
        (o.velocity[1] > 2 && (all[i - 1]?.velocity[1] ?? 0) <= 2),
    )
    .slice(-14)
    .map((o) => ({
      ago: rounded(last.time - o.time),
      position: o.position.map(rounded),
      velocity: o.velocity.map(rounded),
      gaze: o.gaze.map(rounded),
      grounded: o.grounded,
    }));
  const candidates = context.candidates.map((c, i) => ({
    option: `c${i}`,
    kind: c.kind,
    ...c.physical,
    route: c.route ?? null,
  }));
  return {
    state: {
      observations,
      candidates,
      objective: context.objective ?? null,
      current: context.current
        ? {
            option: context.candidates.findIndex(
              (c) => c.id === context.current!.candidateId,
            ),
            kind: context.current.candidateId.split(":")[1],
            phase: context.current.phase,
          }
        : null,
      assistance:
        context.assistance
          ?.slice(-6)
          .map((a) => ({
            ago: rounded(last.time - a.time),
            kind: a.candidateId.split(":")[1],
            outcome: a.outcome,
          })) ?? [],
      matter: {
        units: 512,
        weave:
          "Two 256-unit sections; retain occupied support and recycle the unoccupied section ahead. Route points describe a multi-step path, not teleportation. Choices may also rebuild behind the player.",
      },
    },
    questions: {
      action: choice(
        "Which physical candidate best serves the player's recent embodied behavior? Use gaze, travel, jumps, hesitation and rejected assistance, not stage identity or a compulsory forward route. The objective is optional guidance: exploration and returning are valid. Choose a multi-step weave route when it better matches exploration, elevation or changing direction. Keep useful assistance stable. none means no new intervention; occupied support is always retained.",
        Object.fromEntries([
          ["none", "No new intervention"],
          ...candidates.map((c) => [
            c.option,
            `Execute candidates[${Number(c.option.slice(1))}]`,
          ]),
        ]),
      ),
      assistance: noul(
        "Does the recent behavior indicate that physical help is useful now, including continued support or a new section while traversing? Looking around on safe ground without trying to cross may need no help. Do not treat waiting on matter for an onward path as disinterest.",
      ),
      changing: noul(
        "Is the player changing direction, ignoring offered help, repeatedly jumping, or exploring alternatives such that the choice should be reconsidered soon?",
      ),
    },
  };
}
