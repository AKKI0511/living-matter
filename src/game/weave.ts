import type { Candidate } from "./decisions";
import { type Site, type Vec3, type MatterPose, smooth } from "./world";

export const WEAVE_SECONDS = 1.6;
export type WeaveBank = {
  segment: number;
  from: Vec3;
  to: Vec3;
  since: number;
  version: number;
};
export type Weave = {
  route: Vec3[];
  banks: [WeaveBank, WeaveBank];
  revision: number;
};

/** Numeric geometry only. The decision source chooses which path is useful. */
export function weaveRoute(site: Site, bend = 0, reverse = false): Vec3[] {
  const a = reverse ? site.end : site.start,
    b = reverse ? site.start : site.end;
  return Array.from({ length: 5 }, (_, i) => {
    const t = i / 4;
    return [
      a[0] + (b[0] - a[0]) * t + Math.sin(t * Math.PI) * bend * 5,
      a[1] + (b[1] - a[1]) * t + (bend && (i === 1 || i === 2) ? 1.6 : 0),
      a[2] + (b[2] - a[2]) * t,
    ] as Vec3;
  });
}
export function createWeave(route: Vec3[], time: number): Weave {
  return {
    route,
    revision: 0,
    banks: [0, 1].map((segment) => ({
      segment,
      from: route[segment],
      to: route[segment + 1],
      since: time,
      version: 0,
    })) as [WeaveBank, WeaveBank],
  };
}
export function bankGeometry(bank: WeaveBank) {
  const dx = bank.to[0] - bank.from[0],
    dz = bank.to[2] - bank.from[2];
  const run = Math.hypot(dx, dz),
    rise = bank.to[1] - bank.from[1];
  return {
    run,
    rise,
    dx,
    dz,
    yaw: Math.atan2(-dx, -dz),
    slope: Math.atan2(rise, run),
  };
}
export function bankProgress(bank: WeaveBank, p: Vec3) {
  const { dx, dz, run } = bankGeometry(bank);
  const t =
    ((p[0] - bank.from[0]) * dx + (p[2] - bank.from[2]) * dz) / (run * run);
  const across =
    Math.abs((p[0] - bank.from[0]) * dz - (p[2] - bank.from[2]) * dx) / run;
  const top = bank.from[1] + (bank.to[1] - bank.from[1]) * t + 0.06;
  return {
    t,
    across,
    supported:
      t >= -0.03 &&
      t <= 1.03 &&
      across < 2.15 &&
      Math.abs(p[1] - 0.825 - top) < 0.5,
  };
}

export function weaveCandidates(
  weave: Weave,
  site: Site,
  p: Vec3,
  time: number,
): { bank: number; segment: number; candidates: Candidate[] } | null {
  // Recycle only after the capsule is fully on the other, settled half.
  const occupied = weave.banks.findIndex((b) => {
    const s = bankProgress(b, p);
    return (
      time - b.since >= WEAVE_SECONDS && s.supported && s.t > 0.06 && s.t < 0.94
    );
  });
  if (occupied < 0 || weave.banks.some((b) => time - b.since < WEAVE_SECONDS))
    return null;
  const current = weave.banks[occupied],
    free = 1 - occupied;
  const missing = [current.segment + 1, current.segment - 1].find(
    (s) => s >= 0 && s < 4 && s !== weave.banks[free].segment,
  );
  if (missing === undefined) return null;
  const forward = missing > current.segment;
  const variants = forward && missing < 3 ? [-1, 0, 1] : [0];
  const candidates = variants.map((bend) => {
    const route = weave.route.map((v) => [...v] as Vec3);
    if (forward && missing < 3) {
      const t = (missing + 1) / 4,
        a = route[0],
        b = route[4];
      route[missing + 1] = [
        a[0] + (b[0] - a[0]) * t + bend * 4,
        a[1] + (b[1] - a[1]) * t + (bend ? 1.3 : 0),
        a[2] + (b[2] - a[2]) * t,
      ];
    }
    const from = route[forward ? missing : missing + 1],
      to = route[forward ? missing + 1 : missing];
    return {
      id: `${site.id}:weave:${missing}:${bend + 1}:${weave.revision}`,
      siteId: site.id,
      kind: "weave" as const,
      route,
      physical: {
        from,
        to,
        distance: Math.hypot(p[0] - from[0], p[2] - from[2]),
        span: Math.hypot(to[0] - from[0], to[2] - from[2]),
        rise: to[1] - from[1],
        medium: site.medium ?? "air",
      },
    };
  });
  return { bank: free, segment: missing, candidates };
}

export function applyWeave(
  weave: Weave,
  bank: number,
  segment: number,
  route: Vec3[],
  time: number,
) {
  weave.route = route;
  weave.revision++;
  weave.banks[bank] = {
    segment,
    from: route[segment],
    to: route[segment + 1],
    since: time,
    version: weave.revision,
  };
}

/** 256 blocks form each independently reusable, traversable half. */
export function weavePose(bank: WeaveBank, index: number): MatterPose {
  const { run, dx, dz, rise } = bankGeometry(bank);
  const column = index % 8,
    row = Math.floor(index / 8) % 16,
    layer = Math.floor(index / 128);
  const t = (row + 0.5) / 16,
    across = (column - 3.5) * 0.6;
  return {
    position: [
      bank.from[0] + dx * t - (dz / run) * across,
      bank.from[1] + rise * t - 0.16 - layer * 0.36,
      bank.from[2] + dz * t + (dx / run) * across,
    ],
    scale: [0.576, 0.43, (run / 16 + 0.055) * 0.98],
  };
}
export const weaveBlend = (time: number, since: number) =>
  smooth((time - since) / WEAVE_SECONDS);

/** Wait at an unfinished end without pinning lateral motion or deliberate jumps. */
export function guardWeaveEdge(
  weave: Weave,
  p: Vec3,
  movement: Vec3,
  time: number,
): Vec3 {
  for (const bank of weave.banks) {
    const at = bankProgress(bank, p);
    if (!at.supported) continue;
    const next = bankProgress(bank, [
      p[0] + movement[0],
      p[1],
      p[2] + movement[2],
    ]);
    const direction = next.t > at.t ? 1 : -1;
    const adjacent = bank.segment + direction;
    if (adjacent < 0 || adjacent > 3) continue;
    if (
      (direction > 0 ? next.t < 0.92 : next.t > 0.08) ||
      weave.banks.some(
        (b) => b.segment === adjacent && time - b.since >= WEAVE_SECONDS,
      )
    )
      continue;
    const g = bankGeometry(bank),
      along = (movement[0] * g.dx + movement[2] * g.dz) / (g.run * g.run);
    return [
      movement[0] - along * g.dx,
      movement[1],
      movement[2] - along * g.dz,
    ];
  }
  return movement;
}
