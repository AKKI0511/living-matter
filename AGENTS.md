# Working on Living Matter

- Use Node 24 and pnpm. Run `pnpm dev` for the world.
- `src/game/world.ts` owns geometry; `decisions.ts` owns the replaceable selection contract. Keep selection independent of rendering and physics.
- Simulation runs at 60 Hz. Keep frame updates out of React state.
- Keep atmosphere mounted across restarts to reuse the renderer's environment cache. The Drei patch releases reflection buffers and blur geometry.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build`. Verify movement, formations, recovery, completion, and restart in a browser after gameplay changes.
- Development exposes `window.__livingMatter` for inspection and formation testing; production does not.
- Set `PLAYTEST_URL` to the served export and run `pnpm exec playwright test production.spec.ts` to verify production. Measure frame times locally with GPU acceleration.
- Keep documentation short and player-facing. Do not commit generated artifacts, credentials, or local context.
