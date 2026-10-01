import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  title: "Living Matter",
  description: "Explore a world with a companion that builds paths as you move.",
  openGraph: { title: "Living Matter", description: "Explore a world with a companion that builds paths as you move.", images: [{ url: "/images/living-matter-night.webp", width: 1920, height: 1080 }] },
  twitter: { card: "summary_large_image", title: "Living Matter", images: ["/images/living-matter-night.webp"] },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#131313",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><link rel="preload" href="/fonts/atkinson-next-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /><link rel="preload" href="/fonts/atkinson-mono-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /></head>
      <body><a className="skip" href="#main">Skip to content</a>{children}{process.env.ENABLE_VERCEL_OBSERVABILITY === "1" && <><Analytics /><SpeedInsights /></>}</body>
    </html>
  );
}
