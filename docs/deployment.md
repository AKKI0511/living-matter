# Deploying live Jev

[Development](development.md) · [Architecture](architecture.md) · [Docs](README.md)

Living Matter runs on Vercel at [livingmatter.vercel.app](https://livingmatter.vercel.app). Use Node.js 24 and pnpm. The app needs a Node.js server for `/api/decision`.

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_DECISION_BACKEND=jev` | Select live Jev at build time and runtime. |
| `TYPESAFE_API_KEY` | Server-only TypeSafe credential. |
| `TYPESAFE_DEFAULT_MODEL=jev-1.13.0` | Pin the model used for judgments. |
| `UPSTASH_REDIS_REST_URL` | Shared Redis REST endpoint. |
| `UPSTASH_REDIS_REST_TOKEN` | Server-only Redis credential. |
| `JEV_DAILY_REQUEST_LIMIT` | Aggregate daily application request cap. The hosted game uses `2000`; the code default is `20000`. |
| `ENABLE_VERCEL_OBSERVABILITY=1` | Mount Web Analytics and Speed Insights on Vercel. |

Vercel Marketplace's `KV_REST_API_URL` and `KV_REST_API_TOKEN` are also supported. Set variables for both Preview and Production. Changing `NEXT_PUBLIC_DECISION_BACKEND` requires a rebuild because Next.js embeds it in the browser bundle. A Preview-backend deployment uses `preview` and needs no inference credentials.

## Bound public inference

[`decision-budget.ts`](../src/server/decision-budget.ts) atomically reserves requests in Redis across serverless instances. It enforces the aggregate daily cap, 70 requests per IP per minute and 250 requests per session within a one-hour window. Missing or unavailable Redis prevents live production inference. The in-memory concurrency guard protects one instance only.

The endpoint validates physical state, enforces same-origin requests in production, limits the streamed body to 24 KB and gives body reading three seconds. Jev has a 1.6-second deadline with no SDK retries. The browser decision gate ordinarily expires after two seconds. Existing safe support remains in place after failure.

The home page and inactive runs schedule no inference. Production auditing is disabled and needs no writable filesystem. Keep `.env.local`, recordings and audit directories out of Git and deployment uploads.

## Verify and promote

1. Run `pnpm typecheck`, `pnpm test` and `pnpm build`.
2. Check the linked Vercel project, GitHub repository and Node 24 setting.
3. Create a preview with matching build and runtime configuration.
4. Verify `/`, direct `/play`, pause, return home and repeated Play actions. Check real backend responses with a bounded live smoke test; use mocked transport for automated provider tests.
5. Promote that verified deployment to production and check the public domain.

The hosted project uses Vercel Hobby and Free Redis with automatic paid upgrades disabled. Keep observability within [Vercel's free collection limits](https://vercel.com/docs/speed-insights/limits-and-pricing). Application request reservations bound inference attempts; they are not a provider billing report.
