# Working on Living Matter

- Use Node 24 and pnpm. Run `pnpm dev` for the world.
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
