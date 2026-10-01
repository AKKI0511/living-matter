import { expect, test } from "./fixtures";
import { sites, islands, PLAYER_RADIUS, WEAVE_END_CAP } from "../../src/game/world";

test("production preview crosses a shore without game debug hooks or external services", async ({ page }, info) => {
  test.setTimeout(240_000);
  test.skip(!process.env.PLAYTEST_URL, "Set PLAYTEST_URL to a running preview-mode production server.");
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  page.on("request", request => {
    if (request.url().startsWith("http") && !request.url().startsWith(process.env.PLAYTEST_URL!)) external.push(request.url());
  });
  // Observe the camera matrix uploaded to WebGL, rather than adding a game
  // inspection API to the production bundle. Movement remains DOM input only.
  await page.addInitScript(() => {
    const names = new WeakMap<WebGLUniformLocation, string>();
    for (const constructor of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const prototype = constructor.prototype;
      const location = prototype.getUniformLocation, matrix = prototype.uniformMatrix4fv;
      const data = prototype.bufferData, subData = prototype.bufferSubData;
      const observeMatter = (value: unknown) => {
        if (value instanceof Float32Array && value.length === 512 * 16)
          Object.assign(window, { __renderedMatter: Array.from(value) });
      };
      prototype.bufferData = function(...args: unknown[]) {
        observeMatter(args[1]);
        Reflect.apply(data, this, args);
      };
      prototype.bufferSubData = function(...args: unknown[]) {
        observeMatter(args[2]);
        Reflect.apply(subData, this, args);
      };
      prototype.getUniformLocation = function(program, name) {
        const result = location.call(this, program, name);
        if (result) names.set(result, name);
        return result;
      };
      prototype.uniformMatrix4fv = function(...args: Parameters<WebGL2RenderingContext["uniformMatrix4fv"]>) {
        if (args[0] && names.get(args[0]) === "viewMatrix") {
          const m = Array.from(args[2]), tx = m[12], ty = m[13], tz = m[14];
          const x = -(m[0] * tx + m[1] * ty + m[2] * tz), y = -(m[4] * tx + m[5] * ty + m[6] * tz), z = -(m[8] * tx + m[9] * ty + m[10] * tz);
          if (y > 0 && Math.abs(x) < 46 && z > -222 && z < 16)
            Object.assign(window, { __renderedCamera: { x, y, z, yaw: Math.atan2(m[2], m[10]), pitch: Math.asin(-m[6]) } });
        }
        return matrix.apply(this, args);
      };
    }
  });
  await page.goto("/play");
  await expect(page.getByText("Preview", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Play$/ }).click();
  expect(await page.evaluate(() => window.__livingMatter)).toBeUndefined();
  const camera = () => page.evaluate(() => (window as unknown as { __renderedCamera?: { x: number; y: number; z: number; yaw: number; pitch: number } }).__renderedCamera);
  await expect.poll(async () => !!(await camera())).toBe(true);
  const renderedBanks = () => page.evaluate(() => {
    const matrices = (window as unknown as { __renderedMatter: number[] }).__renderedMatter;
    return [0, 1].map(bank => {
      const row = (r: number) => [0, 1, 2].map(axis => {
        let sum = 0;
        for (let column = 0; column < 8; column++)
          sum += matrices[(bank * 256 + r * 8 + column) * 16 + 12 + axis];
        return sum / 8 + (axis === 1 ? 0.16 : 0);
      });
      const first = row(0), last = row(15);
      return {
        from: first.map((v, i) => v - (last[i] - v) / 30),
        to: last.map((v, i) => v + (v - first[i]) / 30),
      };
    });
  });
  const complete = page.getByRole("button", { name: /^Play again$/ });
  async function go(target: number[]) {
    const until = Date.now() + 40_000;
    await page.keyboard.down("w");
    try {
      while (Date.now() < until) {
        if (await complete.isVisible()) return;
        const p = (await camera())!;
        if (Math.hypot(p.x - target[0], p.z - target[2]) < 0.4) return;
        const yaw = Math.atan2(-(target[0] - p.x), -(target[2] - p.z));
        const difference = Math.atan2(Math.sin(p.yaw - yaw), Math.cos(p.yaw - yaw));
        await page.evaluate(delta => window.dispatchEvent(new MouseEvent("mousemove", delta)), {
          movementX: Math.round(difference / 0.0018), movementY: Math.round(p.pitch / 0.0018),
        });
        await page.waitForTimeout(65);
      }
      throw new Error(`Rendered camera could not reach ${JSON.stringify(target)}: ${JSON.stringify({ camera: await camera(), banks: await renderedBanks() })}`);
    } finally { await page.keyboard.up("w"); }
  }
  const index = 0, site = sites[index];
    const dx = site.end[0] - site.start[0], dz = site.end[2] - site.start[2], run = Math.hypot(dx, dz);
    // Align before entering the offer radius. Preview answers immediately, so
    // turning only after reaching the edge legitimately launches exploration.
    await go([site.start[0] - dx / run * 6, site.start[1], site.start[2] - dz / run * 6]);
    await go([site.start[0] - dx / run * 2, site.start[1], site.start[2] - dz / run * 2]);
    const shoreView = (await camera())!;
    const shoreYaw = Math.atan2(-(site.end[0] - shoreView.x), -(site.end[2] - shoreView.z));
    await page.evaluate(delta => window.dispatchEvent(new MouseEvent("mousemove", delta)), {
      movementX: Math.round(Math.atan2(Math.sin(shoreView.yaw - shoreYaw), Math.cos(shoreView.yaw - shoreYaw)) / 0.0018),
      movementY: Math.round(shoreView.pitch / 0.0018),
    });
    await page.waitForTimeout(4000);
    // Follow the body actually rendered, including its selected attachment and
    // turns, rather than guessing which authored bend the policy selected.
    let banks = await renderedBanks();
    await go([banks[0].from[0], site.start[1], site.start[2] + 1.5]);
    await go(banks[0].from.map((v, a) => v * 0.3 + banks[0].to[a] * 0.7));
    await page.waitForTimeout(2000);
    let current = 1;
    let crossed = false;
    for (let step = 0; step < 16; step++) {
      banks = await renderedBanks();
      const bank = banks[current], other = 1 - current, previous = banks[other];
      const fromCloser = Math.hypot(bank.from[0] - site.end[0], bank.from[2] - site.end[2]) < Math.hypot(bank.to[0] - site.end[0], bank.to[2] - site.end[2]);
      const t = fromCloser ? 0.55 : 0.75;
      await go(bank.from.map((v, a) => v * (1 - t) + bank.to[a] * t));
      await page.waitForTimeout(250);
      const landing = islands[index + 1];
      const seam = PLAYER_RADIUS + WEAVE_END_CAP;
      const p = (await camera())!;
      const alreadyLanded = Math.abs(p.x - landing.position[0]) <= landing.size[0] / 2 + WEAVE_END_CAP &&
        Math.abs(p.z - landing.position[2]) <= landing.size[2] / 2 + WEAVE_END_CAP && p.y >= site.end[1] + 1.1 && p.y <= site.end[1] + 4.5;
      if (alreadyLanded || [bank.from, bank.to].some(end => Math.abs(end[0] - landing.position[0]) < landing.size[0] / 2 + seam &&
        Math.abs(end[2] - landing.position[2]) < landing.size[2] / 2 + seam &&
        end[1] >= site.end[1] - 0.12 && end[1] <= site.end[1] + 3)) {
        await go([site.end[0], site.end[1], site.end[2] - 2]);
        crossed = true;
        break;
      }
      const fresh = await renderedBanks();
      const remaining = (b: typeof bank) => Math.min(
        Math.hypot(b.from[0] - site.end[0], b.from[2] - site.end[2]),
        Math.hypot(b.to[0] - site.end[0], b.to[2] - site.end[2]),
      );
      if (remaining(fresh[other]) < remaining(fresh[current]) - 1) {
        await page.waitForTimeout(2000);
        current = other;
        continue;
      }
      const yaw = Math.atan2(-(site.end[0] - p.x), -(site.end[2] - p.z));
      const difference = Math.atan2(Math.sin(p.yaw - yaw), Math.cos(p.yaw - yaw));
      await page.evaluate(delta => window.dispatchEvent(new MouseEvent("mousemove", delta)), {
        movementX: Math.round(difference / 0.0018), movementY: Math.round(p.pitch / 0.0018),
      });
      await expect.poll(async () => {
        const next = (await renderedBanks())[other];
        return Math.hypot(next.from[0] - previous.from[0], next.from[2] - previous.from[2]) +
          Math.hypot(next.to[0] - previous.to[0], next.to[2] - previous.to[2]);
      }).toBeGreaterThan(0.3).catch(async error => {
        console.log("Production traversal stopped:", JSON.stringify({ index, step, current, camera: await camera(), banks: await renderedBanks() }));
        throw error;
      });
      await page.waitForTimeout(2000);
      current = other;
    }
    expect(crossed).toBe(true);
  await page.keyboard.press("t");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Switch to night" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("crossing.png") });
  await page.reload();
  await expect(page.getByRole("button", { name: /^Play$/ })).toBeVisible();
  expect(await page.evaluate(() => window.__livingMatter)).toBeUndefined();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
