import {expect,test} from "./fixtures";
import {decisionSchema,buildDecisionRequest,composeDecision,decisionOptions} from "../../src/server/decision-request";
import {snapshot,go} from "./steering-helpers";

test.skip(process.env.NEXT_PUBLIC_DECISION_BACKEND==="preview","Live bundle with mocked inference.");
test("an ascending walkway can form and walk a descending side exit",async({page})=>{
  const side = -1;
  let offered=false;
  await page.route("**/api/decision",async route=>{
    const context=decisionSchema.parse(route.request().postDataJSON()),request=buildDecisionRequest(context),menu=decisionOptions(context);
    const group=menu.find(o=>o.candidates.some(c=>c.attachment==="middle"&&c.turnDegrees===side*90&&c.physical.rise<0));
    const ready=!offered&&group&&context.semantic.matter_now.player_supported_by_matter;
    const labels=Object.keys(request.questions.best_candidate.criteria!),selected=ready?group!.label:"none";
    const other=menu.find(o=>o.label!==selected&&o.description.path_shape==="straight");
    const answers={...Object.fromEntries(Object.keys(request.questions).filter(k=>k!=="best_candidate").map(k=>[k,{type:"noul",noul:ready?.9:.1}])),
      best_candidate:{type:"choice",choice:selected,confidence:ready?.25:1,probabilities:Object.fromEntries(labels.map(label=>[label,ready?label===selected?.55:label===other?.label?.35:label==="none"?.1:0:label==="none"?1:0]))}} as Parameters<typeof composeDecision>[1];
    const result=composeDecision(context,answers);
    if(result.candidateId)offered=true;
    await route.fulfill({json:result});
  });
  await page.goto("/play");await page.getByRole("button",{name:"Play",exact:true}).click();
  await page.evaluate(()=>{window.__livingMatter!.teleport([-14,.825,-67.5]);window.__livingMatter!.formation(1,"weave");});
  await expect.poll(async()=>(await snapshot(page)).states[1].phase).toBe("active");
  const occupied=(await snapshot(page)).weave!.banks[0];
  expect(occupied.to[1]).toBeGreaterThan(occupied.from[1]);
  const dx=occupied.to[0]-occupied.from[0],dz=occupied.to[2]-occupied.from[2],run=Math.hypot(dx,dz),across=side*1.9;
  const p=occupied.from.map((v,a)=>v*.5+occupied.to[a]*.5);
  p[0]-=dz/run*across;p[2]+=dx/run*across;p[1]+=.885;
  const direction=[-dz/run*side,dx/run*side];
  await page.evaluate(({p,yaw})=>{window.__livingMatter!.teleport(p as [number,number,number]);window.__livingMatter!.look(yaw,-.4);},{p,yaw:Math.atan2(-direction[0],-direction[1])});
  await expect.poll(async()=>(await snapshot(page)).weave!.revision).toBeGreaterThan(0);
  const branch=(await snapshot(page)).weave!.banks[1];
  expect(branch.to[1]).toBeLessThan(branch.from[1]);
  expect((await snapshot(page)).weave!.banks[0]).toEqual(occupied);
  await page.waitForTimeout(1800);
  await go(page,branch.from.map((v,a)=>v*.3+branch.to[a]*.7),.12);
  const state=await snapshot(page);
  expect(state.grounded).toBe(true);
  expect(state.player[1]).toBeLessThan(p[1]-.08);
  expect(state.recoveries).toBe(0);
  expect(state.weave!.banks[0]).toEqual(occupied);
});
