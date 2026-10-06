import { expect, test } from "./fixtures";
import { sites, type FormationKind } from "../../src/game/world";
import { go, boardPlatform, snapshot } from "./steering-helpers";

for (const [index, kind] of [
  [1, "platform"],
  [1, "stairs"],
  [2, "bridge"],
  [3, "floating-path"],
] as [number, FormationKind][]) {
  test(`${sites[index].id} also supports ${kind} with real traversal`, async ({
    page,
  }, info) => {
    const site = sites[index];
    await page.route("**/api/decision**", route => route.fulfill({ json: { candidateId: null, hold: true } }));
    await page.goto("/play");
    await page.getByRole("button", { name: /^Play$/ }).click();
    await page.evaluate(
      ({ index, kind, start }) => {
        window.__livingMatter!.teleport([start[0], start[1] + 1, start[2] + 2]);
        window.__livingMatter!.formation(index, kind);
      },
      { index, kind, start: site.start },
    );
    await expect
      .poll(async () => (await snapshot(page)).states[index].phase)
      .toBe("active");
    if (kind === "platform") {
      await boardPlatform(page, index);
      await expect
        .poll(async () => (await snapshot(page)).player[2], {
          timeout: 40_000,
          intervals: [100],
        })
        .toBeLessThan(site.end[2] + 4);
    }
    if (kind !== "platform") await go(page, site.start.map((v, a) => (v + site.end[a]) / 2));
    await go(page, [site.end[0], site.end[1], site.end[2] - 4.5]);
    await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
    await info.attach("landing-state", {
      body: JSON.stringify(await snapshot(page)),
      contentType: "application/json",
    });
    const state = await snapshot(page);
    expect(state.recoveries).toBe(0);
    expect(state.player[1]).toBeGreaterThan(site.end[1] + 0.7);
    expect(state.player[1]).toBeLessThan(site.end[1] + 1);
  });
}

test("largest formation keeps a stable render loop", async ({ page }, info) => {
  test.skip(
    !!process.env.CI,
    "Frame-time budgets require a hardware-accelerated browser.",
  );
  await page.goto("/play");
  await page.getByRole("button", { name: /^Play$/ }).click();
  await page.evaluate(() => {
    window.__livingMatter!.teleport([-5, 7, -151]);
    window.__livingMatter!.look(0.55, -0.2);
  });
  await page.waitForTimeout(4500);
  await page.evaluate(() =>
    window.__livingMatter!.formation(3, "floating-path"),
  );
  const measurement = page.evaluate(
    () =>
      new Promise<{
        median: number;
        p95: number;
        over50ms: number;
        frames: number;
      }>((resolve) => {
        const intervals: number[] = [];
        let previous = performance.now(),
          elapsed = 0;
        function frame(now: number) {
          const delta = now - previous;
          previous = now;
          elapsed += delta;
          intervals.push(delta);
          if (elapsed < 5000) requestAnimationFrame(frame);
          else {
            const sorted = intervals.slice().sort((a, b) => a - b);
            resolve({
              median: sorted[Math.floor(sorted.length / 2)],
              p95: sorted[Math.floor(sorted.length * 0.95)],
              over50ms: sorted.filter((n) => n > 50).length,
              frames: sorted.length,
            });
          }
        }
        requestAnimationFrame(frame);
      }),
  );
  await page.waitForTimeout(1700);
  await page.screenshot({ path: info.outputPath("transformation.png") });
  const timing = await measurement;
  console.log("Transformation frame times:", timing);
  await info.attach("frame-times", {
    body: JSON.stringify(timing),
    contentType: "application/json",
  });
  expect(timing.p95).toBeLessThan(50);
  expect(timing.frames).toBeGreaterThan(150);
});

test("a faster deck boards at the far dock and safely carries back down to the near shore",async({page})=>{
  const site=sites[1];
  await page.goto("/play");await page.getByRole("button",{name:/^Play$/}).click();
  await page.evaluate(({site})=>{window.__livingMatter!.teleport([site.end[0],site.end[1]+1,site.end[2]-2]);window.__livingMatter!.formation(1,"platform",0,true);},{site});
  await expect.poll(async()=>(await snapshot(page)).states[1].phase).toBe("active");
  await boardPlatform(page, 1, true);
  await expect.poll(async()=>(await snapshot(page)).player[2],{timeout:40_000,intervals:[100]}).toBeGreaterThan(site.start[2]-4);
  await go(page,[site.start[0],site.start[1],site.start[2]+4.5]);
  await expect.poll(async()=>(await snapshot(page)).grounded).toBe(true);
  expect((await snapshot(page)).recoveries).toBe(0);
});
