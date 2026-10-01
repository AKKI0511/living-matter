# Working on Living Matter

- Use Node 24 and pnpm. Run `pnpm dev` for the world.
- V1 is the movement companion in a flooded observatory. `/` is a static home; `/play` owns WebGL and the run. The UI is permanently dark; Day/Night changes only the world. Keep future heist/enemy work separate.
- Use the paired real-game arrival night/day posters in `public/images`; the home defaults to night and has no controls. Keep controls in the game menu short: Move, Jump and Sprint only. Pause/completion clear the previous focus without selecting anything in the panel; deliberate keyboard focus stays visible. Desktop play uses Escape; the Pause button is for touch devices. Keep Vercel Analytics and Speed Insights in the root layout for deployments.
- Presets in `quality.ts` affect presentation only. Auto measures sustained frames and makes at most one upgrade and one downgrade per selection. Preserve explicit High.
- New walkable space belongs in `walkableGround`; reachable obstacles must share rendering, collision and clearance dimensions. Keep the four crossing endpoints and five established islands.
- Live production requires the shared Redis reservation in `decision-budget.ts`. Fail closed without it; local guards are not aggregate limits. See `docs/contract.md` and `docs/deployment.md`.
- `src/game/world.ts` owns geometry; `decisions.ts` owns the replaceable selection contract. Keep selection independent of rendering and physics.
- There is exactly one matter body. `affordances.ts` supplies bidirectional physical candidates; keep stage IDs and ordering out of the selection policy. Never retract occupied support.
- `weave.ts` recycles only an unoccupied 256-unit half. Keep geometry independent of either decision backend. SDK calls belong in the server route; use mocked transport in tests unless live calls are explicitly requested.
- Simulation runs at 60 Hz. Keep frame updates out of React state.
- Keep atmosphere mounted across restarts to reuse the renderer's environment cache. The Drei patch releases reflection buffers and blur geometry.
- Keep dependency patches: Fiber uses Timer, Three specializes axial PMREM sampling, and N8AO uses explicit blur LOD. Rapier 0.20 fixes WASM initialization. Do not suppress renderer warnings.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build`. Verify movement, formations, recovery, completion, and restart in a browser after gameplay changes.
- Development exposes `window.__livingMatter` for inspection and formation testing; production does not.
- Set `PLAYTEST_URL` to a running preview-mode production server and run `pnpm exec playwright test production.spec.ts` to verify production. Measure frame times locally with GPU acceleration.
- Keep documentation short and player-facing. Do not commit generated artifacts, credentials, or local context.
