import type { Candidate } from "./decisions";
import { islands, sites, type Site, type Vec3 } from "./world";

export function onPermanentGround(p: Vec3) {
  return islands.some(
    (b) =>
      Math.abs(p[0] - b.position[0]) < b.size[0] / 2 - 0.5 &&
      Math.abs(p[2] - b.position[2]) < b.size[2] / 2 - 0.5 &&
      Math.abs(p[1] - (b.position[1] + b.size[1] / 2 + 0.825)) < 0.45,
  );
}

/** Physical affordances only; endpoints may be approached from either direction. */
export function availableCandidates(
  position: Vec3,
  geometry: readonly Site[] = sites,
): Candidate[] {
  return geometry.flatMap((site) => {
    const a = Math.hypot(
      position[0] - site.start[0],
      position[2] - site.start[2],
    );
    const b = Math.hypot(position[0] - site.end[0], position[2] - site.end[2]);
    const from = a <= b ? site.start : site.end,
      to = a <= b ? site.end : site.start;
    const distance = Math.min(a, b);
    if (
      distance > 23 ||
      Math.abs(position[0] - from[0]) > 9 ||
      Math.abs(position[1] - 0.825 - from[1]) > 2
    )
      return [];
    return site.candidates.map((kind) => ({
      id: `${site.id}:${kind}`,
      siteId: site.id,
      kind,
      physical: {
        from,
        to,
        distance,
        span: Math.hypot(to[0] - from[0], to[2] - from[2]),
        rise: to[1] - from[1],
        medium: site.medium ?? "air",
      },
    }));
  });
}
