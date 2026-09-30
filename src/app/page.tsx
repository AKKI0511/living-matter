import Link from "next/link";
import Image from "next/image";
import Theme from "./Theme";
export default function Home() {
  return <main id="main" className="home">
    <div className="home-top"><span>Living Matter</span><Theme /></div>
    <div className="home-intro"><h1>Living Matter</h1><p>Explore a world with a companion that builds paths as you move.</p>
      <nav aria-label="Start"><Link id="play-link" className="primary" href="/play" prefetch={false}>Play</Link><a href="https://github.com/AKKI0511/living-matter">GitHub</a></nav>
    </div>
    <figure className="poster"><Image src="/images/living-matter.webp" alt="Champagne-colored living matter crossing blue-green water between limestone observatory terraces." width={1920} height={1080} priority sizes="(max-width: 760px) 100vw, 1200px" /></figure>
    <details className="how"><summary>How to play</summary><p>WASD or arrow keys to move. Mouse or drag to look. Space to jump. Shift to run. Escape to pause. T switches day and night.</p><p>On touch screens, use your left thumb to move and your right thumb to look. Tap Jump to jump.</p></details>
    <footer>Powered by <a href="https://typesafe.ai">Jev</a><a href="https://github.com/AKKI0511/living-matter/blob/release/living-matter-v1/docs/roadmap.md">Roadmap</a></footer>
  </main>;
}
