import {expect,test,observeJump} from "./fixtures";
import {snapshot} from "./steering-helpers";

for(const example of [{index:0,kind:"weave" as const,position:[0,.825,-23],yaw:.61,edge:-25},{index:1,kind:"stairs" as const,position:[-14,.825,-67.5],yaw:-1.052,edge:-69}])
test(`a jump onto forming ${example.kind} lands while its pieces are still assembling`,async({page})=>{
  await page.goto("/play");
  await page.getByLabel("Graphics",{exact:true}).selectOption("low");
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await page.evaluate(example=>{window.__livingMatter!.teleport(example.position as [number,number,number]);window.__livingMatter!.look(example.yaw,0);},example);
  await expect.poll(async()=>(await snapshot(page)).grounded).toBe(true);
  await page.evaluate(example=>window.__livingMatter!.formation(example.index,example.kind),example);
  const jumping=observeJump(page);
  await page.keyboard.down("w");
  await page.keyboard.press("Space");
  await jumping;
  await page.waitForFunction(edge => (window.__livingMatter!.snapshot() as {player:number[]}).player[2] < edge-.2, example.edge, {polling:"raf"});
  await expect.poll(async()=>(await snapshot(page)).grounded,{intervals:[20]}).toBe(true);
  await page.keyboard.up("w");
  const state=await snapshot(page);
  expect(state.states[example.index].phase).toBe("forming");
  expect(state.player[2]).toBeLessThan(example.edge);
  expect(state.recoveries).toBe(0);
  await expect.poll(async()=>(await snapshot(page)).states[example.index].phase).toBe("active");
  expect((await snapshot(page)).recoveries).toBe(0);
});

test("forming matter passes a standing player without moving or trapping the capsule",async({page})=>{
  await page.goto("/play");
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await page.evaluate(()=>{window.__livingMatter!.teleport([0,.825,-23]);window.__livingMatter!.look(0,0);window.__livingMatter!.formation(0,"bridge");});
  await expect.poll(async()=>(await snapshot(page)).states[0].phase).toBe("active");
  const before=await snapshot(page);
  expect(before.recoveries).toBe(0);
  expect(Math.abs(before.player[0])).toBeLessThan(.1);
  expect(Math.abs(before.player[2]+23)).toBeLessThan(.1);
  await page.keyboard.down("d");
  await expect.poll(async()=>(await snapshot(page)).player[0]).toBeGreaterThan(1);
  await page.keyboard.up("d");
  expect((await snapshot(page)).recoveries).toBe(0);
});
