# Living Matter

A quiet browser world in motion. Follow the light; the way will find you.

## Run

Node 24 LTS and pnpm 12: `pnpm install`, then `pnpm dev`.
Use WASD or arrow keys to move, mouse to look, Space to jump, Shift to run, Escape to pause, and T to switch day/night. Touch controls are available.

Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_DECISION_BACKEND=preview` (default) or `jev`; for live decisions add `TYPESAFE_API_KEY`. Restart development or rebuild production after switching. The key stays server-side.

`pnpm build` builds the app; `pnpm start` serves it with its decision endpoint. A Node.js server is required.
Run `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` to verify changes.

## Code

One set of 512 units follows you. Walking builds a route in sections, retaining support while recycling the other half ahead. Look sideways for alternate routes or double back. At night, your route becomes a constellation beneath a living black hole.

React 19.2.8 matches Fiber 9.7's supported peer range. Development Strict Mode is disabled because its renderer teardown loses the WebGL context with this dependency combination. Fonts and synthesized audio are served locally.

`world.ts` and `weave.ts` own geometry; both backends share physical candidates. `decision-backend.ts` switches sources. `server/decision-request.ts` batches destination Noul and traversal Score questions, then composes their answers with explicit thresholds and stability rules. The server route holds credentials and request limits. Uncertainty holds support. Development logs expose judgments and token usage; thresholds need live playtesting.
