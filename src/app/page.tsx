import Link from "next/link";
import Image from "next/image";
import ControlGuide from "./ControlGuide";
import HomeFocus from "./HomeFocus";
export default function Home() {
  return <main id="main" className="home">
    <HomeFocus />
    <div className="home-top"><span>Living Matter</span></div>
    <div className="home-intro"><h1>Living Matter</h1><p>Explore a world with a companion that builds paths as you move.</p>
      <nav aria-label="Start"><Link id="play-link" className="primary" href="/play" prefetch={false}>Play</Link><a href="https://github.com/AKKI0511/living-matter">GitHub</a></nav>
    </div>
    <ControlGuide />
    <figure className="poster"><Image src="/images/living-matter-night.webp" alt="Living matter assembling a branching path across the flooded observatory at night." width={1920} height={1080} priority sizes="(max-width: 760px) 100vw, 1200px" /></figure>
    <footer><span>© 2026 Akshat Joshi</span><span>Powered by <a href="https://typesafe.ai">Jev</a></span></footer>
  </main>;
}
