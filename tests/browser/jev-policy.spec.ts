import { expect, test } from "./fixtures";
import { assertSemanticPrompt } from "../../src/game/decision-state";
import { buildDecisionRequest, composeDecision, decisionOptions, decisionSchema } from "../../src/server/decision-request";
import { snapshot } from "./steering-helpers";

test.skip(process.env.NEXT_PUBLIC_DECISION_BACKEND === "preview", "Live browser bundle with mocked inference.");

// Detailed probability, height and direction regressions live in the unit suite.
// These two cases verify semantic answers reach the actual rendered formation.
for (const mode of ["turn", "branch"] as const) {
  test(`semantic Jev ${mode} selection forms without replacing occupied support`, async ({ page }) => {
    let offered = 0;
    await page.route("**/api/decision", async route => {
      const context = decisionSchema.parse(route.request().postDataJSON());
      const request = buildDecisionRequest(context);
      assertSemanticPrompt(request);
      const menu = decisionOptions(context);
      const group = menu.find(option => ["aligned", "close"].includes(option.description.view_alignment) &&
        option.candidates.some(candidate => mode === "branch"
          ? candidate.attachment === "middle"
          : candidate.attachment === "far end" && candidate.turnDegrees === 35 && candidate.physical.rise > .15));
      const held = mode === "turn" || request.state.player_now.view_attention === "view held in the same direction";
      const selected = !offered && group && held ? group.label : "none";
      const answers = {
        ...Object.fromEntries(Object.entries(request.questions).filter(([, q]) => q.type === "noul")
          .map(([key]) => [key, { type: "noul", noul: selected === "none" ? .1 : .9 }])),
        best_candidate: { type: "choice", choice: selected, confidence: 1,
          probabilities: Object.fromEntries(Object.keys(request.questions.best_candidate.criteria!)
            .map(label => [label, label === selected ? 1 : 0])) },
      };
      const result = composeDecision(context, answers as Parameters<typeof composeDecision>[1]);
      if (result.candidateId) offered++;
      await route.fulfill({ json: result });
    });
    await page.goto("/play");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.evaluate(() => {
      window.__livingMatter!.teleport([0, 1, -23]);
      window.__livingMatter!.formation(0, "weave");
    });
    await expect.poll(async () => (await snapshot(page)).states[0].phase).toBe("active");
    const occupied = (await snapshot(page)).weave!.banks[0];
    const dx = occupied.to[0] - occupied.from[0], dz = occupied.to[2] - occupied.from[2];
    const t = mode === "branch" ? .5 : .84;
    const p = occupied.from.map((v, axis) => v * (1 - t) + occupied.to[axis] * t);
    const view = mode === "branch" ? [-dz, dx] : [dx - dz * .7, dz + dx * .7];
    await page.evaluate(({ p, yaw, pitch }) => {
      window.__livingMatter!.teleport([p[0], p[1] + .885, p[2]]);
      window.__livingMatter!.look(yaw, pitch);
    }, { p, yaw: Math.atan2(-view[0], -view[1]), pitch: mode === "turn" ? .3 : 0 });
    await expect.poll(async () => (await snapshot(page)).weave!.revision).toBeGreaterThan(0);
    const formed = (await snapshot(page)).weave!.banks[1];
    expect((await snapshot(page)).weave!.banks[0]).toEqual(occupied);
    expect(formed.shape).toBe(mode === "branch" ? "fan" : "arch");
    if (mode === "turn") expect(formed.to[1] - formed.from[1]).toBeGreaterThan(.15);
    await expect.poll(async () => (await snapshot(page)).states[0].phase).toBe("active");
    expect(offered).toBe(1);
    expect((await snapshot(page)).recoveries).toBe(0);
  });
}
