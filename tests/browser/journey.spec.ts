import { expect, test, type Page } from "@playwright/test";

type Snapshot = {
  time: number;
  player: number[];
  grounded: boolean;
  recoveries: number;
  phase: string;
  states: {
    phase: string;
    kind: string;
    offset: number[];
    rideSince: number;
  }[];
};
const snapshot = (page: Page) =>
  page.evaluate(() => window.__livingMatter!.snapshot() as Snapshot);
async function begin(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the world/ }).click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe("playing");
}
async function walkTo(page: Page, z: number, timeout = 40_000) {
  await page.keyboard.down("w");
  try {
    await expect
      .poll(async () => (await snapshot(page)).player[2], {
        timeout,
        intervals: [80],
      })
      .toBeLessThan(z);
  } finally {
    await page.keyboard.up("w");
  }
}

test("a fresh player walks the whole route, finishes and restarts", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(`${e.text()} ${e.location().url}`);
  });
  await begin(page);
  await page.screenshot({ path: info.outputPath("arrival.png") });
  await walkTo(page, -103);
  await page.screenshot({ path: info.outputPath("terrace.png") });
  expect((await snapshot(page)).recoveries).toBe(0);
  await expect.poll(async () => (await snapshot(page)).states[2].phase).toBe("active");
  if ((await snapshot(page)).states[2].kind === "platform") {
    // A moving deck must be boarded during its near-shore dwell.
    await expect
      .poll(
        async () => {
          const s = await snapshot(page), p = s.states[2];
          return (s.time - p.rideSince) % 18 < 1;
        },
        { timeout: 25_000, intervals: [80] },
      )
      .toBe(true);
    await walkTo(page, -112.3, 6000);
    await expect.poll(async () => (await snapshot(page)).player[2], { timeout: 20_000, intervals: [100] }).toBeLessThan(-128.8);
  } else {
    await walkTo(page, -128.8);
  }
  await page.screenshot({ path: info.outputPath("crossing.png") });
  expect((await snapshot(page)).grounded).toBe(true);
  await walkTo(page, -204, 40_000);
  await expect(
    page.getByRole("button", { name: /Wander again/ }),
  ).toBeVisible();
  const finished = await snapshot(page);
  expect(finished.recoveries).toBe(0);
  await page.screenshot({ path: info.outputPath("complete.png") });
  await page.getByRole("button", { name: /Wander again/ }).click();
  await expect.poll(async () => (await snapshot(page)).time).toBeLessThan(2);
  const restarted = await snapshot(page);
  expect(restarted.player[2]).toBeGreaterThan(0.5);
  expect(restarted.states.every((s) => s.phase === "idle")).toBe(true);
  expect(restarted.recoveries).toBe(0);
  expect(errors).toEqual([]);
});

test("jump, fall recovery, pause, and detail controls remain usable", async ({
  page,
}) => {
  await begin(page);
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  await page.keyboard.down("Space");
  await expect
    .poll(async () => (await snapshot(page)).player[1])
    .toBeGreaterThan(1.5);
  await page.keyboard.up("Space");
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  await page.keyboard.down("d");
  await expect
    .poll(async () => (await snapshot(page)).recoveries, { timeout: 10_000 })
    .toBe(1);
  await page.keyboard.up("d");
  await expect.poll(async () => (await snapshot(page)).grounded).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
  const frozen = (await snapshot(page)).time;
  await page.waitForTimeout(500);
  expect((await snapshot(page)).time).toBe(frozen);
  const detail = page.getByRole("button", { name: /Detail (high|low)/ });
  const previousDetail = await detail.textContent();
  await detail.click();
  await expect(detail).not.toHaveText(previousDetail!);
  await page.getByRole("button", { name: /Start over/ }).click();
  expect((await snapshot(page)).recoveries).toBe(0);
});

test("waiting to inspect a formation does not repeatedly dissolve it", async ({
  page,
}) => {
  await begin(page);
  await walkTo(page, -5);
  await expect
    .poll(async () => (await snapshot(page)).states[0].phase)
    .toBe("active");
  await page.waitForTimeout(7000);
  expect((await snapshot(page)).states[0].phase).toBe("active");
});

test("repeated restarts release scene resources", async ({ page }) => {
  await begin(page);
  await page.waitForTimeout(1000);
  const baseline = await page.evaluate(() =>
    window.__livingMatter!.renderInfo(),
  );
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Detail (high|low)/ }).click();
    await page.waitForTimeout(100);
    await page.getByRole("button", { name: /Detail (high|low)/ }).click();
    await page.getByRole("button", { name: /Start over/ }).click();
    await page.waitForTimeout(400);
  }
  const final = await page.evaluate(() => window.__livingMatter!.renderInfo());
  expect(final.geometries).toBeLessThanOrEqual(baseline.geometries + 2);
  expect(final.textures).toBeLessThanOrEqual(baseline.textures + 2);
});
