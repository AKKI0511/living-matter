# Living Matter

A world that understands your intent and adapts around you. Powered by real-time Jev intelligence.

[Play](https://livingmatter.vercel.app) · [How Jev works](docs/jev.md) · [Architecture](docs/architecture.md)

![Living matter weaving a rising path through the flooded observatory at night](public/images/living-matter-arrival-night.webp)

Sprint toward open water. Change direction mid-stride. Look toward a higher terrace. **Jev understands your intent through movement, gaze and action**, bringing the world around you to life. Change your mind and the world responds.

Explore a flooded observatory with one body of 512 pieces. Bridges, rising paths and moving platforms carry you between limestone islands toward a circular monument. Two reusable halves let the companion keep rebuilding while the section beneath you stays in place.

## Play

Open [livingmatter.vercel.app](https://livingmatter.vercel.app) on a desktop or touch device.

| Action | Desktop |
| --- | --- |
| Move | WASD or arrow keys |
| Look | Mouse or drag |
| Jump | Space |
| Sprint | Shift |
| Pause | Escape |

On touch screens, use the left stick to move, drag on the right to look, and tap Jump. The menu has sound, graphics and Day / Night settings.

## Run locally

Install Node.js 24 and pnpm, then run these commands.

```sh
git clone https://github.com/AKKI0511/living-matter.git
cd living-matter
pnpm install
pnpm dev
```

Open [localhost:3000](http://localhost:3000). Local development starts in **Preview**, a rule-based backend that needs no API key.

To run **live Jev intelligence**, copy [`.env.example`](.env.example) to `.env.local`, set these values and restart the server.

```dotenv
NEXT_PUBLIC_DECISION_BACKEND=jev
TYPESAFE_API_KEY=your_server_side_key
TYPESAFE_DEFAULT_MODEL=jev-1.13.0
```

Get a key from [TypeSafe](https://typesafe.ai). Keep it server-side. [Development](docs/development.md) covers testing; [deployment](docs/deployment.md) covers the shared request budget required for production.

## Inside the intelligence

The engine builds physically legal options from the world around you. Jev judges whether you are asking for a new path and which option fits your intent. The engine checks the answer against your current position, then assembles the available matter. Movement and physics keep running while Jev responds.

Read the [worked Jev example](docs/jev.md) to see the actual state, questions, typed answers and execution flow. The [architecture guide](docs/architecture.md) maps that loop to the source. The [roadmap](docs/roadmap.md) describes what comes after V1.

Created by Akshat Joshi. Project code is [MIT licensed](LICENSE); bundled asset notices are in [public/licenses](public/licenses).
