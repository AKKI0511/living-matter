# Development

Use Node.js 24 and the pnpm version pinned in [package.json](../package.json).

```sh
pnpm install
pnpm dev
```

Open [localhost:3000](http://localhost:3000). Preview is the default and needs no credentials.

## Live Jev

Copy [.env.example](../.env.example) to `.env.local`, get a key from [TypeSafe](https://typesafe.ai), and set:

```dotenv
NEXT_PUBLIC_DECISION_BACKEND=jev
TYPESAFE_API_KEY=your_server_side_key
TYPESAFE_DEFAULT_MODEL=jev-1.13.0
```

Restart the server after changing the backend. Keep credentials server-side and out of Git. Set the backend to `preview` to use local selection again. Live production builds also require the [shared Redis budget](deployment.md).

## Verify changes

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

The browser suite starts or reuses a development server on port 3000. Provider transport is mocked. Local tests use Chrome; enable hardware acceleration for graphics measurements.

For the production traversal check, build with `NEXT_PUBLIC_DECISION_BACKEND=preview`, run `pnpm start`, and set `PLAYTEST_URL` to that server. Then run:

```sh
pnpm exec playwright test production.spec.ts
```

In PowerShell, set the URL with `$env:PLAYTEST_URL = "http://localhost:3000"`. In a POSIX shell, use `export PLAYTEST_URL=http://localhost:3000`.

## Source guide

| Area | Files |
| --- | --- |
| World and reachable formations | [world.ts](../src/game/world.ts), [affordances.ts](../src/game/affordances.ts), [weave.ts](../src/game/weave.ts) |
| Observations and semantic state | [semantic.ts](../src/game/semantic.ts), [decision-state.ts](../src/game/decision-state.ts) |
| Jev questions and policy | [decision-request.ts](../src/server/decision-request.ts), [decision-backend.ts](../src/game/decision-backend.ts) |
| Movement, assembly and rendering | [Player.tsx](../src/game/Player.tsx), [Matter.tsx](../src/game/Matter.tsx), [Scene.tsx](../src/game/Scene.tsx) |

Keep selection separate from physics. New walking surfaces belong in `walkableGround`; rendering, collision and clearance share dimensions. Preserve the [player–matter contract](contract.md) and the compatibility patches in [pnpm-workspace.yaml](../pnpm-workspace.yaml).

Development exposes `window.__livingMatter` for snapshots and formation checks. Production excludes it. The [Jev recorder](jev-session-audits.md) lets you inspect actual inputs, judgments and game outcomes.
