# Local development

[Architecture](architecture.md) · [How Jev works](jev.md) · [Docs](README.md)

Use **Node.js 24** and **pnpm**. The package manager version is pinned in [`package.json`](../package.json).

```sh
pnpm install
pnpm dev
```

Open [localhost:3000](http://localhost:3000). `/` is the home page; `/play` loads the game. Google Chrome with hardware acceleration is the local browser test target.

## Choose Preview or Jev

Preview is the default and needs no credentials. To use Jev, copy [`.env.example`](../.env.example) to `.env.local` and set these values.

```dotenv
NEXT_PUBLIC_DECISION_BACKEND=jev
TYPESAFE_API_KEY=your_server_side_key
TYPESAFE_DEFAULT_MODEL=jev-1.13.0
```

Restart `pnpm dev` after changing the backend. Keep the API key out of browser variables and Git. Set `NEXT_PUBLIC_DECISION_BACKEND=preview` to return to local selection. The game menu identifies which backend is running.

Development Jev calls do not require Redis when no Redis credentials are configured. A production build in live mode does require the [shared budget](deployment.md), including when served locally with `pnpm start`.

To inspect actual model requests and game outcomes, enable the optional [session recorder](jev-session-audits.md). Use Preview and mocked transport for routine tests so tests do not consume inference.

## Check a change

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

The browser suite starts or reuses a development server at port 3000. Run it with the Preview backend. To exercise mocked live transport, restart the development server in Jev mode and run `pnpm exec playwright test live-transport.spec.ts`; the suite intercepts decision requests.

For the production traversal check, build with Preview and start the server.

```sh
pnpm build
pnpm start
```

In a second terminal, set `PLAYTEST_URL` to that server's URL. In PowerShell, use `$env:PLAYTEST_URL = "http://localhost:3000"`; in a POSIX shell, use `export PLAYTEST_URL=http://localhost:3000`. Then run the traversal check.

```sh
pnpm exec playwright test production.spec.ts
```

CI uses Playwright Chromium and software graphics. Local tests use Chrome; measure rendering performance on a hardware-accelerated browser. CI frame timings are not a GPU benchmark.

Development exposes `window.__livingMatter` for inspecting snapshots and checking formations. Production excludes it.

## Where to change behavior

Add or adjust physical options in `world.ts`, `affordances.ts` and `weave.ts`. Jev questions and composition live in `src/server/decision-request.ts`; the selection interface lives in `decisions.ts`. Preserve the [player–matter contract](contract.md) when changing either side. [Architecture](architecture.md) links the remaining entry points.

New walkable surfaces belong in `walkableGround`. Reachable obstacles must share dimensions across rendering, collision and route clearance. Keep frame updates out of React state and keep atmosphere mounted across restarts.

## Dependency compatibility

[`pnpm-workspace.yaml`](../pnpm-workspace.yaml) pins the required rendering patches and Rapier override. Preserve them when upgrading:

- Fiber's Timer-backed clock.
- Three's axial PMREM sampling fix.
- N8AO's explicit blur texture LOD.
- Drei's reflection-buffer and blur-geometry disposal.
- Rapier 0.20 WASM compatibility.

Working conventions are in [AGENTS.md](../AGENTS.md). Project code uses the [MIT license](../LICENSE); bundled fonts and the TypeSafe skill retain notices in [public/licenses](../public/licenses) and the [skill license](../.agents/skills/typesafe-ai/LICENSE).
