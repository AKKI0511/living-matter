import { expect, test, type Page } from "./fixtures";
import { assertSemanticPrompt } from "../../src/game/decision-state";
import { buildDecisionRequest, composeDecision, decisionOptions, decisionSchema } from "../../src/server/decision-request";
import { snapshot } from "./steering-helpers";

test.skip(process.env.NEXT_PUBLIC_DECISION_BACKEND === "preview", "Requires the live browser bundle; all model transport is mocked.");

async function verifyMappedFormation(page: Page, mode: "turn" | "branch") {
  let applied = false;
  let offered = 0;
  await page.route("**/api/decision", async route => {
    const context = decisionSchema.parse(route.request().postDataJSON());
    const request = buildDecisionRequest(context);
    assertSemanticPrompt(request);
    const group = decisionOptions(context).find(option => option.candidates.some(candidate => mode === "branch"
      ? candidate.attachment === "middle"
      : candidate.attachment === "far end" && candidate.turnDegrees === 35 && candidate.physical.rise > .15));
    const selected = !applied && group ? group.label : "none";
    const answers = {
      ...Object.fromEntries(Object.entries(request.questions).filter(([, question]) => question.type === "noul")
        .map(([key]) => [key, { type: "noul", noul: selected === "none" ? .1 : .9 }])),
      best_candidate: { type: "choice" as const, choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(request.questions.best_candidate.criteria!).map(label => [label, label === selected ? 1 : 0])),
      },
    };
    const result = composeDecision(context, answers as Parameters<typeof composeDecision>[1]);
    if (result.candidateId) { applied = true; offered++; }
    await route.fulfill({ json: result });
  });
  await page.evaluate(() => { window.__livingMatter!.teleport([0,1,-23]); window.__livingMatter!.formation(0,"weave"); });
  await expect.poll(async () => (await snapshot(page)).states[0].phase).toBe("active");
  const occupied = (await snapshot(page)).weave!.banks[0];
  const dx = occupied.to[0] - occupied.from[0], dz = occupied.to[2] - occupied.from[2];
  const run = Math.hypot(dx,dz), t = mode === "branch" ? .5 : .84;
  const p = occupied.from.map((value, axis) => value * (1-t) + occupied.to[axis] * t);
  const across = mode === "branch" ? 1.9 : 0;
  p[0] -= dz / run * across;
  p[2] += dx / run * across;
  p[1] += .885 + across * (occupied.crossSlope ?? 0);
  const view = mode === "branch" ? [-dz, dx] : [dx - dz*.7, dz + dx*.7];
  await page.evaluate(({ p,yaw,pitch }) => { window.__livingMatter!.teleport(p as [number,number,number]); window.__livingMatter!.look(yaw,pitch); },
    { p, yaw: Math.atan2(-view[0],-view[1]), pitch: mode === "turn" ? .3 : 0 });
  await expect.poll(async () => (await snapshot(page)).weave!.revision).toBeGreaterThan(0);
  const formed = (await snapshot(page)).weave!.banks[1] as typeof occupied & { shape?: string; since: number };
  expect((await snapshot(page)).weave!.banks[0]).toEqual(occupied);
  expect(formed.shape).toBe(mode === "branch" ? "fan" : "arch");
  if (mode === "turn") expect(formed.to[1] - formed.from[1]).toBeGreaterThan(.15);
  const revision = (await snapshot(page)).weave!.revision;
  await page.waitForTimeout(800);
  expect((await snapshot(page)).weave!.revision).toBe(revision);
  expect(offered).toBe(1);
  expect((await snapshot(page)).recoveries).toBe(0);
}

for (const mode of ["turn", "branch"] as const) {
  test(`semantic Jev ${mode} selection maps into the actual formation without replacing occupied support`, async ({ page }) => {
    await page.goto("/play");
    await page.getByRole("button",{name:"Play",exact:true}).click();
    await verifyMappedFormation(page,mode);
  });
}
