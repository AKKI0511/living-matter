import { expect, test, type Page } from "./fixtures";
import { ScenarioDecisions } from "../../src/game/decisions";
import { go, snapshot as physicalSnapshot } from "./steering-helpers";
import { sites } from "../../src/game/world";

test.skip(process.env.NEXT_PUBLIC_DECISION_BACKEND === "preview", "Requires the live-mode browser bundle; transport is mocked.");

test("pausing, restarting and exiting abort late live responses", async ({ page }) => {
  const pending: { finish: () => void }[] = [];
  await page.route("**/api/decision", async route => {
    const context=route.request().postDataJSON();
    await new Promise<void>(resolve => pending.push({finish:resolve}));
    await route.fulfill({json:{candidateId:context.candidates[0].id}}).catch(() => {});
  });
  await page.goto("/play"); await page.getByRole("button",{name:"Play",exact:true}).click();
  await page.evaluate(()=>{window.__livingMatter!.teleport([0,.825,-23]);window.__livingMatter!.look(.6,0);});
  await expect.poll(()=>pending.length).toBe(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Restart",exact:true}).click();
  pending[0].finish();
  await expect.poll(()=>page.evaluate(()=>(window.__livingMatter!.snapshot() as {states:{phase:string}[]}).states.every(s=>s.phase==="idle"))).toBe(true);
  await page.evaluate(()=>{window.__livingMatter!.teleport([0,.825,-23]);window.__livingMatter!.look(.6,0);});
  await expect.poll(()=>pending.length).toBe(2);
  await page.keyboard.press("Escape");await page.getByRole("link",{name:"Back to home",exact:true}).click();
  pending[1].finish();await page.waitForTimeout(500);
  await expect.poll(()=>page.evaluate(()=>!!window.__livingMatter)).toBe(false);
  await expect(page.locator("canvas")).toHaveCount(0);
  // A slow renderer may reach the transport deadline and retry before exit.
  // Inactive runs must stop scheduling regardless of that earlier request count.
  const requestsAtHome = pending.length;
  pending.forEach(request => request.finish());
  await page.waitForTimeout(500);
  expect(pending.length).toBe(requestsAtHome);
  await page.getByRole("link",{name:"Play",exact:true}).click();
  expect(pending.length).toBe(requestsAtHome);
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await page.waitForTimeout(500);
  expect(pending.length).toBe(requestsAtHome);
  expect(await page.evaluate(()=>(window.__livingMatter!.snapshot() as {states:{phase:string}[]}).states.every(s=>s.phase==="idle"))).toBe(true);
});

async function mockDecisions(page: Page) {
  const source = new ScenarioDecisions();
  const counts = { waterOffers: 0 };
  // Intercept every decision/audit request: this test never reaches Jev or audit storage.
  await page.route("**/api/decision**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/decision") {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    const context = route.request().postDataJSON();
    const decision = await source.select(context, new AbortController().signal);
    if (context.candidates.some((c: { id: string; physical: { medium: string } }) => c.id === decision.candidateId && c.physical.medium === "water")) counts.waterOffers++;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ json: decision.candidateId ? decision : { candidateId: null, hold: true } });
  });
  return counts;
}

test("delayed mocked live decisions form a water route after recovery", async ({ page }, info) => {
  const counts = await mockDecisions(page);
  const warnings: string[] = [];
  page.on("pageerror", (e) => warnings.push(e.message));
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") warnings.push(m.text()); });
  await page.goto("/play");
  await expect(page.getByText(/Live Jev/)).toBeVisible();
  await page.getByRole("button", { name: /^Play$/ }).click();
  const snapshot = () => page.evaluate(() => window.__livingMatter!.snapshot() as { player: number[]; grounded: boolean; recoveries: number; phase: string; states: { phase: string }[] });
  await expect.poll(async () => (await snapshot()).grounded).toBe(true);
  await page.evaluate(() => window.__livingMatter!.teleport([15, -5, 1]));
  await expect.poll(async () => (await snapshot()).recoveries).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot()).grounded).toBe(true);
  const recovered = (await snapshot()).recoveries;
  try {
    const frameTimes = await page.evaluate(async () => {
      const gl = document.querySelector("canvas")?.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_debug_renderer_info");
      const renderer = extension ? gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
      const samples: number[] = [];
      await new Promise<void>((resolve) => {
        let previous = 0;
        const frame = (time: number) => {
          if (previous) samples.push(time - previous);
          previous = time;
          if (samples.length < 180) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
      samples.sort((a, b) => a - b);
      return { renderer, samples: samples.length, median_ms: samples[89], p95_ms: samples[170] };
    });
    console.log("Local walking frame times:", JSON.stringify(frameTimes));
    await info.attach("frame-times", { body: JSON.stringify(frameTimes, null, 2), contentType: "application/json" });
    await page.evaluate(start => window.__livingMatter!.teleport([start[0], start[1] + 1, start[2] + 6]), sites[3].start);
    await go(page, [sites[3].start[0], sites[3].start[1], sites[3].start[2] + 1.2]);
    await page.evaluate(yaw => window.__livingMatter!.look(yaw, 0),
      Math.atan2(-(sites[3].end[0] - sites[3].start[0]), -(sites[3].end[2] - sites[3].start[2])));
    await expect.poll(async () => (await snapshot()).states[3].phase).toBe("active");
  } finally { await page.keyboard.up("w"); }
  expect(counts.waterOffers).toBeGreaterThanOrEqual(1);
  expect((await snapshot()).recoveries).toBe(recovered);
  expect(warnings).toEqual([]);
});

test("looking across occupied matter builds a side branch and permits returning", async ({ page }) => {
  await mockDecisions(page);
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  await page.evaluate(() => { window.__livingMatter!.teleport([0, 1, -23]); window.__livingMatter!.formation(0, "weave", 0); });
  await expect.poll(async () => (await physicalSnapshot(page)).states[0].phase).toBe("active");
  const original = (await physicalSnapshot(page)).weave!.banks[0];
  const middle = original.from.map((v, a) => (v + original.to[a]) / 2);
  const dx = original.to[0] - original.from[0], dz = original.to[2] - original.from[2];
  await page.evaluate(({ p, yaw }) => { window.__livingMatter!.teleport([p[0], p[1] + 0.885, p[2]]); window.__livingMatter!.look(yaw, 0); }, { p: middle, yaw: Math.atan2(dz, -dx) });
  await expect.poll(async () => (await physicalSnapshot(page)).weave!.revision).toBeGreaterThan(0);
  const branch = (await physicalSnapshot(page)).weave!.banks[1];
  expect((await physicalSnapshot(page)).weave!.banks[0]).toEqual(original);
  expect(Math.hypot(branch.from[0] - middle[0], branch.from[2] - middle[2])).toBeCloseTo(1.8);
  expect(Math.abs(dx * (branch.to[0] - branch.from[0]) + dz * (branch.to[2] - branch.from[2]))).toBeLessThan(0.01);
  await expect.poll(async () => (await physicalSnapshot(page)).grounded).toBe(true);
  await page.waitForTimeout(1800);
  await go(page, branch.from.map((v, a) => v * 0.25 + branch.to[a] * 0.75));
  await go(page, middle);
  expect((await physicalSnapshot(page)).recoveries).toBe(0);
});

test("the live source is consulted at a matter side rim while the old deck still points ahead", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/decision", async route => {
    calls++;
    await route.fulfill({ json: { candidateId: null, hold: true } });
  });
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  await page.evaluate(() => window.__livingMatter!.formation(2, "weave", 0));
  await expect.poll(async () => (await physicalSnapshot(page)).states[2].phase).toBe("active");
  const bank = (await physicalSnapshot(page)).weave!.banks[0];
  const dx = bank.to[0] - bank.from[0], dz = bank.to[2] - bank.from[2];
  const run = Math.hypot(dx, dz);
  const p = [
    (bank.from[0] + bank.to[0]) / 2 - dz / run * 1.9,
    (bank.from[1] + bank.to[1]) / 2 + 0.885,
    (bank.from[2] + bank.to[2]) / 2 + dx / run * 1.9,
  ];
  await page.evaluate(({ p, yaw }) => { window.__livingMatter!.teleport(p as [number, number, number]); window.__livingMatter!.look(yaw, 0); },
    { p, yaw: Math.atan2(-dx, -dz) });
  await expect.poll(async () => Math.abs((await physicalSnapshot(page)).player[0] - p[0])).toBeLessThan(0.5);
  await expect.poll(async () => (await physicalSnapshot(page)).grounded).toBe(true);
  await expect.poll(() => calls).toBeGreaterThan(0);
});

test("a reversal rebuilds the missing half behind without moving occupied support", async ({ page }) => {
  await mockDecisions(page);
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  await page.evaluate(() => { window.__livingMatter!.teleport([0, 1, -23]); window.__livingMatter!.formation(0, "weave"); });
  await expect.poll(async () => (await physicalSnapshot(page)).states[0].phase).toBe("active");
  const occupied = (await physicalSnapshot(page)).weave!.banks[1];
  await page.evaluate(p => { window.__livingMatter!.teleport([p[0], p[1] + 0.885, p[2]]); window.__livingMatter!.look(0.6, 0); }, occupied.from.map((v, a) => v * 0.25 + occupied.to[a] * 0.75));
  await expect.poll(async () => (await physicalSnapshot(page)).weave!.revision).toBeGreaterThan(0);
  await page.waitForTimeout(1800);
  const revision = (await physicalSnapshot(page)).weave!.revision;
  await go(page, occupied.from.map((v, a) => v * 0.75 + occupied.to[a] * 0.25));
  const p = (await physicalSnapshot(page)).player;
  await page.evaluate(yaw => window.__livingMatter!.look(yaw, 0), Math.atan2(p[0], -(-23.8 - p[2])));
  await expect.poll(async () => (await physicalSnapshot(page)).weave!.revision).toBeGreaterThan(revision);
  await page.waitForTimeout(1800);
  const returned = (await physicalSnapshot(page)).weave!;
  expect(returned.banks[1]).toEqual(occupied);
  expect(returned.banks[0].from[2]).toBeGreaterThan(returned.banks[0].to[2]);
  await go(page, returned.banks[0].from.map((v, a) => v * 0.75 + returned.banks[0].to[a] * 0.25));
  await go(page, [0, 0, -23]);
  expect((await physicalSnapshot(page)).recoveries).toBe(0);
});
