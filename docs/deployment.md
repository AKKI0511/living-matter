# Deployment

Use a Node.js 24 host with pnpm. Live Jev needs a server for `/api/decision` and a shared Redis request budget.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_DECISION_BACKEND=jev` | Choose live Jev at build time and runtime. |
| `TYPESAFE_API_KEY` | Server-only TypeSafe credential. |
| `TYPESAFE_DEFAULT_MODEL=jev-1.13.0` | Pin the judgment model. |
| `UPSTASH_REDIS_REST_URL` | Shared Redis REST endpoint. |
| `UPSTASH_REDIS_REST_TOKEN` | Server-only Redis credential. |
| `JEV_DAILY_REQUEST_LIMIT` | Aggregate daily request cap. |
| `ENABLE_VERCEL_OBSERVABILITY=1` | Enable Vercel Analytics and Speed Insights when hosting on Vercel. |

`KV_REST_API_URL` and `KV_REST_API_TOKEN` are supported Redis alternatives. Rebuild after changing the backend; its value is embedded in the browser bundle. A `preview` deployment needs no inference credentials.

[decision-budget.ts](../src/server/decision-budget.ts) reserves requests atomically across instances, with application, IP and session limits. Missing or unavailable Redis prevents live production inference. Jev failures use Preview with increasing retry delays; existing support stays intact.

Keep credentials and local session recordings out of Git and deployment uploads. Production does not write audit files. The home page and inactive runs make no inference requests.

Run the [development checks](development.md), including the production-preview browser test, before deploying. Match build and runtime variables in each hosting environment, then verify home, play, pause and restart on the deployed URL.
