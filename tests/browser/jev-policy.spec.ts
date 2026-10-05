import { expect, test, type Page } from "./fixtures";
import { assertSemanticPrompt } from "../../src/game/decision-state";
import { buildDecisionRequest, composeDecision, decisionOptions, decisionSchema } from "../../src/server/decision-request";
import { snapshot,go } from "./steering-helpers";

test.skip(process.env.NEXT_PUBLIC_DECISION_BACKEND === "preview", "Requires the live browser bundle; all model transport is mocked.");

async function verifyMappedFormation(page: Page, mode: "turn" | "branch", regression?: "curve" | "waiting" | "variety" | "height" | "axis", side = 1) {
  let applied = false;
  let offered = 0;
  await page.route("**/api/decision", async route => {
    const context = decisionSchema.parse(route.request().postDataJSON());
    const request = buildDecisionRequest(context);
    assertSemanticPrompt(request);
    const menu=decisionOptions(context);
    const group = menu.find(option => (!regression || ["aligned","close"].includes(option.description.view_alignment)) && option.candidates.some(candidate => mode === "branch"
      ? candidate.attachment === "middle"
      : candidate.attachment === "far end" && candidate.turnDegrees === 35 && candidate.physical.rise > .15));
    if (regression === "axis" && context.semantic.matter_now.player_supported_by_matter) {
      expect(request.state.player_now.view_to_walkway).toBe("across the walkway toward its side");
      expect(request.state.player_now.position_on_support).toBe("near the surface edge");
    }
    const selected = !applied && group && (regression!=="height"||request.questions.height_intent) &&
      (regression!=="axis"||request.state.player_now.view_attention==="view held in the same direction") ? group.label : "none";
    const answers = {
      ...Object.fromEntries(Object.entries(request.questions).filter(([, question]) => question.type === "noul")
        .map(([key]) => [key, { type: "noul", noul: selected === "none" ? .1 : .9 }])),
      best_candidate: { type: "choice" as const, choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(request.questions.best_candidate.criteria!).map(label => [label, label === selected ? 1 : 0])),
      },
    };
    if (selected!=="none"&&group&&regression&&regression!=="height"&&regression!=="axis") {
      const alternate=menu.find(o=>o.label!==group.label&&(regression!=="waiting"
        ? o.description.path_shape==="straight"&&o.description.vertical_change===group.description.vertical_change&&["aligned","close"].includes(o.description.view_alignment)
        : !["aligned","close"].includes(o.description.view_alignment)));
      expect(alternate).toBeDefined();
      answers.best_candidate.choice=regression==="curve"?group.label:alternate!.label;
      answers.best_candidate.confidence=.25;
      const labels=Object.keys(request.questions.best_candidate.criteria!);
      const remainder=(regression==="curve" ? .4 : .37)/(labels.length-3);
      answers.best_candidate.probabilities=Object.fromEntries(labels.map(label=>[label,regression==="variety"
        ? label===group.label?.42:label===alternate!.label?.57:label==="none"?.01:0
        : label===group.label ? regression==="curve" ? .31 : .17 : label===alternate!.label ? regression==="curve" ? .28 : .32 : label==="none" ? regression==="curve" ? .01 : .14 : remainder]));
      if (regression==="variety") {
        for(let i=0;i<40;i++) {
          context.sessionId=`00000000-0000-4000-8000-${i.toString(16).padStart(12,"0")}`;
          if(group.candidates.some(c=>c.id===composeDecision(context,answers as Parameters<typeof composeDecision>[1]).candidateId)) break;
        }
      }
    }
    if(selected!=="none"&&regression==="height") {
      expect(request.questions.height_intent).toBeDefined();
      for(const key of Object.keys(answers)) if(key!=="best_candidate") Object.assign(answers[key as keyof typeof answers],{noul:key==="height_intent"?.56:.1});
    }
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
  const across = mode === "branch" && regression !== "axis" ? 1.9 : 0;
  p[0] -= dz / run * across;
  p[2] += dx / run * across;
  p[1] += .885 + across * (occupied.crossSlope ?? 0);
  const view = mode === "branch" ? [-dz * side, dx * side] : [dx - dz*.7, dz + dx*.7];
  await page.evaluate(({ p,yaw,pitch }) => { window.__livingMatter!.teleport(p as [number,number,number]); window.__livingMatter!.look(yaw,pitch); },
    { p, yaw: Math.atan2(-view[0],-view[1]), pitch: mode === "turn" ? regression==="height"?.24:.3 : 0 });
  await expect.poll(async () => (await snapshot(page)).weave!.revision).toBeGreaterThan(0);
  const formed = (await snapshot(page)).weave!.banks[1] as typeof occupied & { shape?: string; since: number };
  expect((await snapshot(page)).weave!.banks[0]).toEqual(occupied);
  expect(formed.shape).toBe(mode === "branch" ? "fan" : "arch");
  if (mode === "turn") expect(formed.to[1] - formed.from[1]).toBeGreaterThan(.15);
  const revision = (await snapshot(page)).weave!.revision;
  await page.waitForTimeout(4000);
  expect((await snapshot(page)).weave!.revision).toBe(revision);
  expect(offered).toBe(1);
  expect((await snapshot(page)).recoveries).toBe(0);
}

for (const side of [-1,1]) {
  test(`a held view across the walkway builds the ${side < 0 ? "left" : "right"} exit from its centre`, async ({ page }) => {
    await page.goto("/play");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await verifyMappedFormation(page, "branch", "axis", side);
  });
}

for (const mode of ["turn", "branch"] as const) {
  test(`semantic Jev ${mode} selection maps into the actual formation without replacing occupied support`, async ({ page }) => {
    await page.goto("/play");
    await page.getByRole("button",{name:"Play",exact:true}).click();
    await verifyMappedFormation(page,mode);
  });
}

for (const regression of ["curve","waiting","variety","height"] as const) {
  test(`restored Jev policy fixes ${regression} selection in the actual game`,async({page})=>{
    await page.goto("/play");
    await page.getByRole("button",{name:"Play",exact:true}).click();
    await verifyMappedFormation(page,regression==="waiting"?"branch":"turn",regression);
  });
}

test("a side shore ignores mild downward view then forms a deliberate descent despite moderate no-match uncertainty",async({page})=>{
  let offered=false;
  const heightQuestions: boolean[]=[];
  await page.route("**/api/decision",async route=>{
    const context=decisionSchema.parse(route.request().postDataJSON());
    const request=buildDecisionRequest(context),menu=decisionOptions(context);
    heightQuestions.push(!!request.questions.height_intent);
    const group=menu.find(o=>o.description.vertical_change==="lower"&&["aligned","close"].includes(o.description.view_alignment));
    const ready=!offered&&group&&request.questions.height_intent&&request.state.player_now.view_attention==="view held in the same direction";
    const labels=Object.keys(request.questions.best_candidate.criteria!);
    const selected=ready?group!.label:"none";
    const answers={...Object.fromEntries(Object.keys(request.questions).filter(key=>key!=="best_candidate").map(key=>[key,{type:"noul",noul:ready?.9:.1}])),
      best_candidate:{type:"choice",choice:selected,confidence:ready?.25:1,probabilities:Object.fromEntries(labels.map(label=>[label,ready?label===selected?.5:label==="none"?.4:.1/(labels.length-2):label==="none"?1:0]))}} as Parameters<typeof composeDecision>[1];
    const result=composeDecision(context,answers);
    if(result.candidateId)offered=true;
    await route.fulfill({json:result});
  });
  await page.goto("/play");await page.getByRole("button",{name:"Play",exact:true}).click();
  await page.evaluate(()=>{window.__livingMatter!.teleport([3.903,6.832,-101.365]);window.__livingMatter!.look(Math.PI/2,-.24);});
  await expect.poll(()=>heightQuestions.length).toBeGreaterThan(0);
  await page.waitForTimeout(900);
  expect(offered).toBe(false);
  expect(heightQuestions.some(Boolean)).toBe(false);
  await page.evaluate(()=>window.__livingMatter!.look(Math.PI/2,-.31));
  await expect.poll(()=>offered).toBe(true);
  const state=await snapshot(page);
  expect(state.weave!.banks[0].to[1]).toBeLessThan(state.weave!.banks[0].from[1]);
  expect(state.recoveries).toBe(0);
});


test("a credible Jev climb with mildly positive height intent replaces an unused level route",async({page})=>{
  let wantRise=false,levelOffered=false,riseOffered=false;
  await page.route("**/api/decision",async route=>{
    const context=decisionSchema.parse(route.request().postDataJSON()),request=buildDecisionRequest(context),menu=decisionOptions(context);
    const target=menu.find(o=>o.description.player_use==="walk"&&o.description.path_shape==="straight"&&o.description.view_alignment==="aligned"&&o.description.vertical_change===(wantRise?"higher":"at similar height"));
    const ready=target&&(!levelOffered||wantRise&&!riseOffered&&request.questions.height_intent);
    const selected=ready?target!.label:"none";
    const answers={...Object.fromEntries(Object.keys(request.questions).filter(k=>k!=="best_candidate").map(k=>[k,{type:"noul",noul:ready?wantRise? k==="height_intent"?.52:.18:.9:.1}])),
      best_candidate:{type:"choice",choice:selected,confidence:ready&&wantRise?.36:1,probabilities:Object.fromEntries(Object.keys(request.questions.best_candidate.criteria!).map(label=>[label,label===selected?1:0]))}} as Parameters<typeof composeDecision>[1];
    const result=composeDecision(context,answers);
    if(result.candidateId) {if(wantRise)riseOffered=true;else levelOffered=true;}
    await route.fulfill({json:result});
  });
  await page.goto("/play");await page.getByRole("button",{name:"Play",exact:true}).click();
  await page.evaluate(()=>{window.__livingMatter!.teleport([0,.832,-23.4]);window.__livingMatter!.look(0,0);});
  await expect.poll(async()=>(await snapshot(page)).states[0].phase).toBe("active");
  const level=(await snapshot(page)).weave!.banks[0];
  expect(level.to[1]).toBeCloseTo(level.from[1]);
  wantRise=true;
  await page.evaluate(()=>window.__livingMatter!.look(0,.3));
  await expect.poll(()=>riseOffered).toBe(true);
  await expect.poll(async()=>{const state=await snapshot(page),bank=state.weave!.banks[0];return bank.to[1]-bank.from[1];}).toBeGreaterThan(.5);
  await expect.poll(async()=>(await snapshot(page)).states[0].phase).toBe("active");
  expect((await snapshot(page)).recoveries).toBe(0);
});
