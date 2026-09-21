# Living Matter

A quiet browser world in motion. Follow the light; the way will find you.

## Run

Node 24 LTS and pnpm 12: `pnpm install`, then `pnpm dev`.
Use WASD or arrow keys to move, mouse to look, Space to jump, Shift to run, Escape to pause, and T to switch day/night. Touch controls are available.

`pnpm build` creates a standalone static site in `out/`. `pnpm start` serves it locally.
Run `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` to verify changes.

## Code

`src/game/world.ts` defines the route and formation geometry. `Matter.tsx` executes transformations; `Player.tsx` uses Rapier's character controller. `decisions.ts` provides an asynchronous, replaceable selection interface. One persistent set of 512 units follows you. The deterministic preview responds to movement and gaze; try doubling back. At night, your route becomes a constellation.

React 19.2.8 matches Fiber 9.7's supported peer range. Development Strict Mode is disabled because its renderer teardown loses the WebGL context with this dependency combination. Fonts and synthesized audio are served locally.

`affordances.ts` supplies physical candidates; `decisions.ts` selects among them asynchronously. Inject a new `DecisionSource` into `createRuntime()` without changing physics or rendering.
