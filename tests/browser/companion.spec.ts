import { expect, observeJump, test, type Page } from "./fixtures";
const snap = (page: Page) =>
  page.evaluate(
    () =>
      window.__livingMatter!.snapshot() as {
        time: number;
        player: number[];
        grounded: boolean;
        recoveries: number;
        activeSite: number | null;
        matterMeshes: number;
        matterUnits: number;
        constellation: number;
        states: {
          phase: string;
          offset: number[];
          rideSince: number;
          reverse: boolean;
        }[];
      },
  );
async function begin(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Enter the world/ }).click();
}
async function walk(page: Page, z: number, direction = "w") {
  await page.keyboard.down(direction);
  try {
    await expect
      .poll(
        async () => {
          const p = (await snap(page)).player[2];
          return direction === "w" ? p < z : p > z;
        },
        { timeout: 25000, intervals: [60] },
      )
      .toBe(true);
  } finally {
    await page.keyboard.up(direction);
  }
}

async function simulateFor(page: Page, seconds: number) {
  const until = (await snap(page)).time + seconds;
  await page.waitForFunction((until) =>
    (window.__livingMatter!.snapshot() as { time: number }).time >= until,
  until, { polling: "raf", timeout: 12000 });
}

test("free movement relative to a travelling platform, including reversing and jumping", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 7, -104]);
    window.__livingMatter!.formation(2, "platform");
  });
  await expect
    .poll(async () => (await snap(page)).states[2].phase)
    .toBe("active");
  await walk(page, -112.3);
  await expect
    .poll(async () => (await snap(page)).states[2].offset[2], {
      intervals: [50],
    })
    .toBeLessThan(-4);
  const relative = async () => {
    const s = await snap(page);
    return [s.player[0], s.player[2] - s.states[2].offset[2]];
  };
  let before = await relative();
  await page.keyboard.down("d");
  await simulateFor(page, 0.28);
  await page.keyboard.up("d");
  let after = await relative();
  expect(after[0] - before[0]).toBeGreaterThan(0.6);
  before = await relative();
  await page.keyboard.down("a");
  await simulateFor(page, 0.4);
  await page.keyboard.up("a");
  after = await relative();
  expect(after[0] - before[0]).toBeLessThan(-0.6);
  before = await relative();
  await page.keyboard.down("s");
  await simulateFor(page, 0.25);
  await page.keyboard.up("s");
  after = await relative();
  expect(after[1] - before[1]).toBeGreaterThan(0.45);
  before = await relative();
  await page.keyboard.down("w");
  await simulateFor(page, 0.35);
  await page.keyboard.up("w");
  after = await relative();
  expect(after[1] - before[1]).toBeLessThan(-0.5);
  const jumped = observeJump(page);
  await page.keyboard.press("Space");
  await jumped;
  await expect.poll(async () => (await snap(page)).grounded).toBe(true);
  expect((await snap(page)).recoveries).toBe(0);
});

test("one continuous matter body assists forward traversal and a deliberate return", async ({
  page,
}) => {
  await begin(page);
  await walk(page, -53);
  await expect
    .poll(async () => (await snap(page)).states[0].phase)
    .toBe("idle");
  await page.evaluate(() => window.__livingMatter!.look(Math.PI, 0));
  await expect
    .poll(async () => (await snap(page)).states[0].phase, { timeout: 12000 })
    .toBe("active");
  await page.keyboard.down("w");
  await expect
    .poll(async () => (await snap(page)).player[2], { timeout: 18000 })
    .toBeGreaterThan(-21);
  await page.keyboard.up("w");
  const s = await snap(page);
  expect(s.recoveries).toBe(0);
  expect(s.matterMeshes).toBe(1);
  expect(s.matterUnits).toBe(512);
  expect(
    s.states.filter((x) => x.phase === "active").length,
  ).toBeLessThanOrEqual(1);
});

test("night reveals a constellation of the actual route and controls stay legible", async ({
  page,
}, info) => {
  await begin(page);
  await walk(page, -12);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to night" }).click();
  await expect(
    page.getByRole("button", { name: "Switch to day" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.evaluate(() => window.__livingMatter!.look(0.15, 0.55));
  await page.waitForTimeout(1800);
  expect((await snap(page)).constellation).toBeGreaterThan(5);
  await page.screenshot({ path: info.outputPath("memory-sky.png") });
  expect(
    await page
      .locator(".hint")
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(15);
  await page.keyboard.press("t");
  await expect(
    page.getByRole("button", { name: "Switch to night" }),
  ).toBeVisible();
});

test("the same platform can collect a player from the far shore and return", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 7, -141]);
    window.__livingMatter!.look(Math.PI, 0);
    // This test exercises reverse platform transport, independent of selection.
    window.__livingMatter!.formation(2, "platform", 0, true);
  });
  await expect
    .poll(async () => (await snap(page)).states[2].phase)
    .toBe("active");
  expect((await snap(page)).states[2].reverse).toBe(true);
  await page.keyboard.down("w");
  await expect
    .poll(async () => (await snap(page)).player[2], { intervals: [50] })
    .toBeGreaterThan(-131.7);
  await page.keyboard.up("w");
  await expect
    .poll(async () => (await snap(page)).states[2].offset[2], {
      timeout: 14000,
      intervals: [100],
    })
    .toBeGreaterThan(-0.5);
  await page.keyboard.down("w");
  await expect
    .poll(async () => (await snap(page)).player[2], {
      timeout: 6000,
      intervals: [50],
    })
    .toBeGreaterThan(-106);
  await page.keyboard.up("w");
  expect((await snap(page)).recoveries).toBe(0);
});

test("unselected bridge colliders cannot support a player over open air", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    window.__livingMatter!.teleport([0, 2, -36]);
    window.__livingMatter!.formation(0, "platform");
  });
  await expect
    .poll(async () => (await snap(page)).recoveries, {
      timeout: 5000,
      intervals: [50],
    })
    .toBe(1);
});

for (const [index, position, destination] of [
  [1, [0, 7, -92], -65],
  [3, [0, 7, -190], -151],
] as [number, [number, number, number], number][]) {
  test(`return traversal also works at formation ${index}`, async ({
    page,
  }) => {
    await begin(page);
    await page.evaluate((p) => {
      window.__livingMatter!.teleport(p);
      window.__livingMatter!.look(Math.PI, 0);
    }, position);
    await expect
      .poll(async () => (await snap(page)).states[index].phase)
      .toBe("active");
    await page.keyboard.down("w");
    await expect
      .poll(async () => (await snap(page)).player[2], {
        timeout: 18000,
        intervals: [70],
      })
      .toBeGreaterThan(destination);
    await page.keyboard.up("w");
    expect((await snap(page)).recoveries).toBe(0);
  });
}
