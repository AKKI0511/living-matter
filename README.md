# Living Matter

Explore a world with a companion that builds paths as you move.

[Play Living Matter](https://livingmatter.vercel.app) · [Roadmap](docs/roadmap.md)

![Living matter in the flooded observatory at night](public/images/living-matter-night.webp)

Walk across limestone terraces, turn toward open water, climb or head back. One body of 512 pieces builds and recycles paths while keeping occupied support in place. Reach the circular monument, or take your time exploring.

## Play locally

Use Node 24 and pnpm.

```sh
pnpm install
pnpm dev
```

Open [localhost:3000](http://localhost:3000) and select Play.

WASD / arrows move. Mouse / drag looks. Space jumps. Shift runs. Escape pauses. T switches Day / Night. Touch uses a left movement stick, right look area and Jump button.

The menu offers Resume, Restart, Back to home, Sound, Day / Night and Auto / Low / High graphics. The interface stays dark, and the world starts at night. Controls are illustrated before play; Escape pauses desktop play, and touch devices have a Pause button. Preferences are saved locally.

## Decision modes

The default is Preview, requiring no key. For live Jev intelligence, copy [`.env.example`](.env.example) to `.env.local`, set `NEXT_PUBLIC_DECISION_BACKEND=jev` and a server-only `TYPESAFE_API_KEY`, then restart. Live decisions hold existing support on provider failure and never silently switch to preview.

[Jev integration](docs/jev.md) · [Player–matter contract](docs/contract.md) · [Development](docs/development.md) · [Production configuration](docs/deployment.md) · [Roadmap](docs/roadmap.md)

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Project code and generated game art are [MIT licensed](LICENSE). Font licenses are in [public/licenses](public/licenses); renderer compatibility patches remain in [patches](patches).
