import type { NextConfig } from "next";
if (
  process.env.NEXT_PUBLIC_DECISION_BACKEND &&
  !["preview", "jev"].includes(process.env.NEXT_PUBLIC_DECISION_BACKEND)
) {
  throw new Error("NEXT_PUBLIC_DECISION_BACKEND must be preview or jev");
}
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: false,
  agentRules: false,
  devIndicators: false,
};
export default config;
