import type { Candidate } from "./decisions";
import { islands, sites, clearMatterSection, type Site, type Vec3 } from "./world";
import { weaveRoute } from "./weave";

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
  const crossings = geometry.flatMap((site) => {
    const a = Math.hypot(
      position[0] - site.start[0],
      position[2] - site.start[2],
    );
    const b = Math.hypot(position[0] - site.end[0], position[2] - site.end[2]);
    const from = a <= b ? site.start : site.end,
      to = a <= b ? site.end : site.start;
    const distance = Math.min(a, b);
    const shore = islands.find((island) =>
      Math.abs(from[1] - island.position[1] - island.size[1] / 2) < 0.01 &&
      Math.abs(Math.abs(from[2] - island.position[2]) - island.size[2] / 2) < 0.01 &&
      Math.abs(from[0] - island.position[0]) < island.size[0] / 2,
    );
    if (
      distance > 8 ||
      Math.abs(position[0] - from[0]) > (shore ? shore.size[0] / 2 : 9) ||
      Math.abs(position[1] - 0.825 - from[1]) > 2
    )
      return [];
    // Walking uses the rolling route in both backends. Whole-span forms remain
    // available to the development harness; riding is a distinct live alternative.
    const kinds = site.candidates.includes("weave")
      ? site.candidates.filter(
          (kind) => kind === "weave" || kind === "platform",
        )
      : site.candidates;
    // Stable, overlapping shoreline ports provide support where the player
    // actually approaches. Fixed ports also survive motion during an API call.
    const ports = site.steering && shore
      ? [...new Set([
          ...Array.from({ length: 9 }, (_, i) => (i - 4) * 4),
          shore.position[0] - from[0] - shore.size[0] / 2 + 1.5,
          shore.position[0] - from[0] + shore.size[0] / 2 - 1.5,
        ])]
        .filter((offset) => Math.abs(from[0] + offset - shore.position[0]) <= shore.size[0] / 2 - 1.5)
        .sort((a, b) => Math.abs(from[0] + a - position[0]) - Math.abs(from[0] + b - position[0]))
        .slice(0, 1)
      : [0];
    return kinds.flatMap((kind) =>
      (kind === "weave" ? ports : [0]).flatMap((offset) =>
        (kind === "weave" ? [-1, 0, 1] : [0]).map((bend) => {
          const dock: Vec3 = offset === 0 ? from : [from[0] + offset, from[1], from[2]];
          return {
            id: `${site.id}:${kind}${kind === "weave" ? `:${bend + 1}${offset ? `:dock:${offset}` : ""}` : ""}`,
            siteId: site.id,
            kind,
            ...(kind === "weave"
              ? { route: weaveRoute({ ...site, start: dock, end: to }, bend) }
              : {}),
            physical: {
              from: dock,
              to,
              distance: Math.hypot(position[0] - dock[0], position[2] - dock[2]),
              span: Math.hypot(to[0] - dock[0], to[2] - dock[2]),
              rise: to[1] - from[1],
              medium: site.medium ?? "air",
            },
          };
        }),
      ),
    );
  });
  // Any reachable edge can launch a route. The owning slot only stores the one
  // matter body; its authored crossing never constrains these headings or bounds.
  const departures: Candidate[] = [];
  for (const [islandIndex, island] of islands.entries()) {
    const y = island.position[1] + island.size[1] / 2;
    if (Math.abs(position[1] - 0.825 - y) > 0.5) continue;
    const owner = [...geometry].sort((a, b) =>
      Math.min(...[a.start, a.end].map(e => Math.hypot(e[0] - position[0], e[2] - position[2]))) -
      Math.min(...[b.start, b.end].map(e => Math.hypot(e[0] - position[0], e[2] - position[2]))))[0];
    if (!owner?.steering) continue;
    for (let edge = 0; edge < 4; edge++) {
      const axis = edge < 2 ? 0 : 2, tangent = axis === 0 ? 2 : 0;
      const sign = edge % 2 ? 1 : -1;
      const from: Vec3 = [...island.position];
      from[1] = y;
      from[axis] += sign * island.size[axis] / 2;
      from[tangent] = Math.max(island.position[tangent] - island.size[tangent] / 2 + 2.4,
        Math.min(island.position[tangent] + island.size[tangent] / 2 - 2.4, Math.round(position[tangent] / 2) * 2));
      const distance = Math.hypot(from[0] - position[0], from[2] - position[2]);
      if (distance > 5) continue;
      for (const turn of [-1, 0, 1]) {
        const direction: Vec3 = [0, 0, 0];
        direction[axis] = sign / (turn ? Math.SQRT2 : 1);
        direction[tangent] = turn / Math.SQRT2;
        const route = [0, 6, 12].map(length => [from[0] + direction[0] * length, y, from[2] + direction[2] * length] as Vec3);
        if (!clearMatterSection(route[0], route[1]) || !clearMatterSection(route[1], route[2])) continue;
        departures.push({ id: `${owner.id}:explore:${islandIndex}:${edge}:${from[tangent]}:${turn}`,
          siteId: owner.id, kind: "weave", route,
          physical: { from, to: route[2], distance, span: 12, rise: 0, medium: "water", landing: false } });
      }
    }
  }
  return [...crossings, ...departures].slice(0, 16);
}
