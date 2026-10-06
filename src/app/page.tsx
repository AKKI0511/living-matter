import Link from "next/link";
import HomeFocus from "./HomeFocus";
import GameplayPreview from "./GameplayPreview";
export default function Home() {
  return <main id="main" className="home">
    <HomeFocus />
    <div className="home-intro"><h1>Living Matter</h1><p>A world that adapts to your intent with real-time AI.</p>
      <nav aria-label="Start"><Link id="play-link" className="primary" href="/play" prefetch={false}>Play</Link><a href="https://github.com/AKKI0511/living-matter">GitHub</a></nav>
    </div>
    <figure className="poster"><GameplayPreview /></figure>
    <footer><span>© 2026 Akshat Joshi</span><span>Powered by <a href="https://typesafe.ai">Jev</a></span></footer>
  </main>;
}
