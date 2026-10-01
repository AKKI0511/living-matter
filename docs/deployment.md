# Release configuration

Use Node 24 and pnpm. Set `NEXT_PUBLIC_DECISION_BACKEND=jev` for both the build and runtime, with server-only `TYPESAFE_API_KEY` and `TYPESAFE_DEFAULT_MODEL=jev-1.13.0`. Preview builds use `preview` and need no inference credentials.

Live production needs `UPSTASH_REDIS_REST_URL` and server-only `UPSTASH_REDIS_REST_TOKEN`, or the equivalent `KV_REST_API_URL` / `KV_REST_API_TOKEN` supplied by Vercel Marketplace. One Redis EVAL atomically reserves a daily aggregate budget (default 20,000 requests, configurable with `JEV_DAILY_REQUEST_LIMIT`), 70 requests/IP/minute and 250 requests/session/hour across all instances. The launch configuration limits inference to 2,000 requests/day and uses the Free Redis plan with paid upgrades disabled. Failed reservations and unavailable Redis prevent inference. IP keys use a hash of Vercel's overwritten client-IP header. The local 4-call concurrency / 120-call minute guard is only an instance guard.

The endpoint accepts bounded physical state, checks same origin in production, limits the streamed body to 24 KB and three seconds, gives Jev 1.6 seconds and makes no SDK retries. Browser decisions have a two-second gate. Home, loading, pause and disposed runs do not schedule inference. Production auditing is disabled and requires no writable directories.

Create a preview with the production configuration, verify public routes and real backend operation, then promote that exact deployment. Keep `.env*`, audits and recordings outside Git and deployment uploads. Check the GitHub repository link and Node 24 project setting explicitly. Platform DDoS protection supplements the application limits; it does not replace the shared budget.

Vercel builds mount Web Analytics and Speed Insights in the root layout. The linked project remains on Hobby and uses capped free collection; do not enable Speed Insights Plus or upgrade the plan. Local development and browser tests do not send telemetry. See [free Speed Insights limits](https://vercel.com/docs/speed-insights/limits-and-pricing).
