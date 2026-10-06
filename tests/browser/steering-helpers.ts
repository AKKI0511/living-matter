import { expect, type Page } from "./fixtures";
import { sites, islands, PLAYER_RADIUS, WEAVE_END_CAP, structureBoxes, platformOffset, PLATFORM_HALF_CYCLE_SECONDS } from "../../src/game/world";
import type { Weave } from "../../src/game/weave";
type Bank = Weave["banks"][number];

export const snapshot = (page: Page) => page.evaluate(() => window.__livingMatter!.snapshot() as {
  player: number[]; grounded: boolean; recoveries: number; phase: string; time: number; solidMatterColliders: number;
  states: { phase: string; offset: number[] }[]; weave: Weave | null;
});

export async function go(page: Page, target: number[], tolerance = 0.35, platformIndex?: number) {
  const steer = ({ target, tolerance, platformIndex }: { target: number[]; tolerance: number; platformIndex?: number }) => {
    const state = window.__livingMatter!.snapshot() as {
      phase: string; player: number[]; states: { offset: number[] }[];
    };
    const offset = platformIndex === undefined ? [0, 0, 0] : state.states[platformIndex].offset;
    const dx = target[0] + offset[0] - state.player[0], dz = target[2] + offset[2] - state.player[2];
    if (state.phase === "complete" || Math.hypot(dx, dz) < tolerance) return true;
    window.__livingMatter!.look(Math.atan2(-dx, -dz), 0);
    return false;
  };
  const destination = { target, tolerance, platformIndex };
  // Face the destination before walking; slow protocol delivery must not
  // briefly ask matter to extend in the previous direction.
  if (await page.evaluate(steer, destination)) return;
  await page.keyboard.down("w");
  try {
    await page.waitForFunction(steer, destination, { polling: "raf", timeout: 20_000 });
  } finally { await page.keyboard.up("w"); }
}

export async function boardPlatform(page: Page, index: number, reverse = false) {
  const offset = platformOffset(sites[index], reverse ? PLATFORM_HALF_CYCLE_SECONDS : 0);
  await page.waitForFunction(({ index, offset }) => {
    const state = (window.__livingMatter!.snapshot() as { states: { phase: string; offset: number[] }[] }).states[index];
    return state.phase === "active" && Math.hypot(state.offset[0] - offset[0], state.offset[2] - offset[2]) < .2;
  }, { index, offset }, { polling: "raf", timeout: 30_000 });
  await go(page, structureBoxes(sites[index], "platform")[0].position, .4, index);
}

export async function cross(page: Page, index: number) {
  const site = sites[index];
  const dx = site.end[0] - site.start[0], dz = site.end[2] - site.start[2], run = Math.hypot(dx, dz);
  // Enter the offer radius along the intended direction and reach the actual
  // gap; waiting farther inside a diagonal shore still has continuous ground.
  await go(page, [site.start[0] - dx / run * 6, site.start[1], site.start[2] - dz / run * 6]);
  await go(page, [site.start[0] - dx / run * 1.5, site.start[1], site.start[2] - dz / run * 1.5]);
  await page.evaluate(yaw => window.__livingMatter!.look(yaw, 0), Math.atan2(-(site.end[0] - site.start[0]), -(site.end[2] - site.start[2])));
  await expect.poll(async () => (await snapshot(page)).states[index].phase).toBe("active");
  const first = (await snapshot(page)).weave!.banks[0];
  await go(page, first.from.map((v, a) => v * 0.3 + first.to[a] * 0.7), 0.75);
  const remaining = (b: Bank) => Math.min(...[b.from, b.to].map(p => Math.hypot(p[0] - site.end[0], p[2] - site.end[2])));
  // A glance back can replace the second half with a reverse section. Follow
  // the half actually closest to the destination, whichever slot holds it.
  let bank = (await snapshot(page)).weave!.banks.reduce((a, b) => remaining(a) < remaining(b) ? a : b);
  for (let i = 0; i < 15; i++) {
    const fromCloser = Math.hypot(bank.from[0] - site.end[0], bank.from[2] - site.end[2]) < Math.hypot(bank.to[0] - site.end[0], bank.to[2] - site.end[2]);
    const t = fromCloser ? 0.55 : 0.75;
    await go(page, bank.from.map((v, a) => v * (1 - t) + bank.to[a] * t), 0.75);
    const state = await snapshot(page);
    const landed = islands[index + 1];
    const seam = PLAYER_RADIUS + WEAVE_END_CAP;
    if ([bank.from, bank.to].some(end => Math.abs(end[0] - landed.position[0]) < landed.size[0] / 2 + seam &&
      Math.abs(end[2] - landed.position[2]) < landed.size[2] / 2 + seam &&
      end[1] >= site.end[1] - 0.12 && end[1] <= site.end[1] + 3)) {
      await go(page, [site.end[0], site.end[1], site.end[2] - 2]);
      return;
    }
    const builtAhead = state.weave!.banks.find(b => b.version > bank.version && (
      remaining(b) < remaining(bank) - 1 ||
      // A final section can enter the landing island and therefore increase
      // distance to its authored edge while still being the forward route.
      [b.from, b.to].some(end => Math.abs(end[0] - landed.position[0]) < landed.size[0] / 2 + seam &&
        Math.abs(end[2] - landed.position[2]) < landed.size[2] / 2 + seam &&
        end[1] >= site.end[1] - 0.12 && end[1] <= site.end[1] + 3)
    ));
    if (builtAhead) {
      await page.waitForTimeout(1800);
      bank = builtAhead;
      continue;
    }
    const revision = state.weave!.revision;
    await page.evaluate(yaw => window.__livingMatter!.look(yaw, 0), Math.atan2(-(site.end[0] - state.player[0]), -(site.end[2] - state.player[2])));
    await expect.poll(async () => (await snapshot(page)).weave!.revision).toBeGreaterThan(revision);
    await page.waitForTimeout(2000);
    bank = (await snapshot(page)).weave!.banks.reduce((a, b) => remaining(a) < remaining(b) ? a : b);
  }
  throw new Error(`Crossing ${index} did not reach shore`);
}
