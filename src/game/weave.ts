import type { Candidate } from "./decisions";
import { type Site, type Vec3, type MatterPose, smooth, withinMatterBounds, clearMatterSection, islands, PLAYER_RADIUS, WEAVE_END_CAP } from "./world";

export const WEAVE_SECONDS = 1.6;
export type WeaveBank = {
  segment: number;
  from: Vec3;
  to: Vec3;
  since: number;
  version: number;
  crossSlope?: number;
  shape?: "deck" | "fan" | "arch";
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
  const run = Math.hypot(b[0] - a[0], b[2] - a[2]);
  return Array.from({ length: 5 }, (_, i) => {
    const t = i / 4;
    return [
      a[0] + (b[0] - a[0]) * t - ((b[2] - a[2]) / run) * Math.sin(t * Math.PI) * bend * 5,
      a[1] + (b[1] - a[1]) * t + (i === 1 || i === 2 ? 1.2 : 0),
      a[2] + (b[2] - a[2]) * t + ((b[0] - a[0]) / run) * Math.sin(t * Math.PI) * bend * 5,
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
  const signedAcross = (-(p[0] - bank.from[0]) * dz + (p[2] - bank.from[2]) * dx) / run;
  const across = Math.abs(signedAcross);
  const top = bank.from[1] + (bank.to[1] - bank.from[1]) * t + signedAcross * (bank.crossSlope ?? 0) + 0.06;
  return {
    t,
    across,
    supported:
      t >= -(WEAVE_END_CAP + PLAYER_RADIUS) / run &&
      t <= 1 + (WEAVE_END_CAP + PLAYER_RADIUS) / run &&
      across < 2.4 + PLAYER_RADIUS &&
      Math.abs(p[1] - 0.825 - top) < 0.5,
  };
}

export function weaveCandidates(
  weave: Weave,
  site: Site,
  p: Vec3,
  time: number,
): { bank: number; segment: number; candidates: Candidate[] } | null {
  // The occupied half stays protected even at its tip or side rim. Requiring
  // the capsule to be fully inside its centre leaves a no-decision strip where
  // the player most needs a new section.
  const occupied = weave.banks.findIndex((b) => {
    const s = bankProgress(b, p);
    return time - b.since >= WEAVE_SECONDS && s.supported;
  });
  if (occupied < 0 || weave.banks.some((b) => time - b.since < WEAVE_SECONDS))
    return null;
  const current = weave.banks[occupied],
    free = 1 - occupied;
  // At a shared junction both halves can support the capsule. Wait until the
  // player has cleared it rather than recycling another occupied surface.
  if (bankProgress(weave.banks[free], p).supported) return null;
  if (site.steering) return steeringCandidates(weave, site, occupied, p);
  const missing = [current.segment + 1, current.segment - 1].find(
    (s) => s >= 0 && s < 4 && s !== weave.banks[free].segment,
  );
  if (missing === undefined) return null;
  const forward = missing > current.segment;
  const endpoint = forward ? missing + 1 : missing;
  const variants = endpoint > 0 && endpoint < 4 ? [-1, 0, 1] : [0];
  const candidates = variants.map((bend) => {
    const route = weave.route.map((v) => [...v] as Vec3);
    if (endpoint > 0 && endpoint < 4) {
      const t = endpoint / 4,
        a = route[0],
        b = route[4];
      route[endpoint] = [
        a[0] + (b[0] - a[0]) * t + bend * 4,
        route[endpoint][1],
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

function groundAt(p: Vec3, clearance = 0.4) {
  return islands.some(b => Math.abs(p[0] - b.position[0]) <= b.size[0] / 2 - clearance &&
    Math.abs(p[2] - b.position[2]) <= b.size[2] / 2 - clearance && Math.abs(p[1] - b.position[1] - b.size[1] / 2) < 0.32);
}

/** Both joints and the side of the occupied section can seed a bounded new heading. */
function steeringCandidates(weave: Weave, site: Site, occupied: number, p: Vec3) {
  const bank = weave.banks[occupied], free = 1 - occupied;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const g = bankGeometry(bank), ux = g.dx / g.run, uz = g.dz / g.run;
  const gradientX = ux * g.rise / g.run - uz * (bank.crossSlope ?? 0);
  const gradientZ = uz * g.rise / g.run + ux * (bank.crossSlope ?? 0);
  const ports = [
    { point: bank.to, segment: bank.segment + 1, attachment: "far end" as const },
    { point: bank.from, segment: bank.segment - 1, attachment: "near end" as const },
    ...[-1, 1].map(side => ({
      // Keep 0.6 units of overlap at the rim. Match the occupied plane across
      // the new deck's width, instead of driving a flat deck through a ramp.
      point: [(bank.from[0] + bank.to[0]) / 2 - uz * side * 1.8,
        (bank.from[1] + bank.to[1]) / 2 + (bank.crossSlope ?? 0) * side * 1.8,
        (bank.from[2] + bank.to[2]) / 2 + ux * side * 1.8] as Vec3,
      segment: bank.segment + 1, attachment: "middle" as const, side,
    })),
  ];
  for (const port of ports) {
    const sign = port.attachment === "near end" ? -1 : 1;
    const side = "side" in port ? port.side : 0;
    const dx = side ? -uz * side : sign * ux, dz = side ? ux * side : sign * uz;
    const surfaceRise = (gradientX * dx + gradientZ * dz) * 6;
    const targets: { point: Vec3; turnDegrees: number }[] =
      (side ? [Math.max(-1.5, Math.min(1.5, surfaceRise))] : [0, 1.5, -1.5]).map(rise => ({
        point: [port.point[0] + dx * 6, port.point[1] + rise, port.point[2] + dz * 6],
        turnDegrees: side ? side * 90 : 0,
      }));
    // Shallow turns make a path responsive to ordinary head movement. Both
    // level and rising/falling diagonal decks meet the occupied end face.
    if (!side) for (const turn of [-1, 1]) {
      const tx = (dx - dz * turn * 0.7) / Math.sqrt(1 + 0.7 ** 2);
      const tz = (dz + dx * turn * 0.7) / Math.sqrt(1 + 0.7 ** 2);
      for (const rise of port.attachment === "far end" ? [0, 1.5] : [0]) {
        targets.push({ point: [port.point[0] + tx * 6, port.point[1] + rise, port.point[2] + tz * 6], turnDegrees: turn * 35 });
      }
    }
    // Every island is a possible landing, including its east and west sides.
    // Keep only the two nearest physical surfaces; no stage sequence is used.
    const landings = islands.map(b => [
      Math.max(b.position[0] - b.size[0] / 2 + 1.2, Math.min(b.position[0] + b.size[0] / 2 - 1.2, port.point[0])),
      b.position[1] + b.size[1] / 2,
      Math.max(b.position[2] - b.size[2] / 2 + 1.2, Math.min(b.position[2] + b.size[2] / 2 - 1.2, port.point[2])),
    ] as Vec3).sort((a, b) => Math.hypot(a[0] - port.point[0], a[2] - port.point[2]) - Math.hypot(b[0] - port.point[0], b[2] - port.point[2])).slice(0, 2);
    if (!side) for (const landing of landings) {
      const dx = landing[0] - port.point[0], dz = landing[2] - port.point[2], distance = Math.hypot(dx, dz);
      const length = Math.min(7, distance);
      if (distance > 0.5 && !targets.some(t => t.point[1] === landing[1] &&
        Math.hypot(t.point[0] - landing[0], t.point[2] - landing[2]) < 1)) targets.push({ point: [
        port.point[0] + dx / distance * length,
        port.point[1] + Math.max(-1.5, Math.min(1.5, landing[1] - port.point[1])),
        port.point[2] + dz / distance * length,
      ], turnDegrees: 0 });
    }
    for (const target of targets) {
      const proposed = target.point;
      // An end connection must leave that end. A landing projected back through
      // the occupied deck duplicates its support and traps both halves in use.
      // Side turns use the rim ports; reverse travel uses the opposite end.
      if (!side && ((proposed[0] - port.point[0]) * ux +
        (proposed[2] - port.point[2]) * uz) * sign < -0.01) continue;
      let to = proposed;
      if (Math.hypot(to[0] - port.point[0], to[2] - port.point[2]) < 1) continue;
      const span = Math.hypot(to[0] - port.point[0], to[2] - port.point[2]);
      const projectedCross = (gradientX * -(to[2] - port.point[2]) + gradientZ * (to[0] - port.point[0])) / span;
      // Side joins share a whole strip of the occupied ramp. End joins meet at
      // their centre, and a landing must finish level with permanent ground.
      const straight = Math.abs(((to[0] - port.point[0]) * ux + (to[2] - port.point[2]) * uz) / span) > 0.99;
      const crossSlope = side || (straight && !groundAt(to) && bank.crossSlope) ? projectedCross : 0;
      if (Math.abs(crossSlope) > 0.5) continue;
      if (!clearMatterSection(port.point, to, crossSlope)) {
        // A long low ramp can run into a cliff before gaining enough height.
        // Preserve the ramp's grade when shortening it before a cliff. Keeping
        // the full rise on a short segment creates an unwalkable steep step.
        // Side joins retain their original plane and overlap.
        if (side) continue;
        const shorter = [3, 1.5, 1].filter(length => length < span).map(length => [
          port.point[0] + (proposed[0] - port.point[0]) * length / span,
          port.point[1] + (proposed[1] - port.point[1]) * length / span,
          port.point[2] + (proposed[2] - port.point[2]) * length / span,
        ] as Vec3).find(point => clearMatterSection(port.point, point, crossSlope));
        if (!shorter) continue;
        to = shorter;
      }
      if (!withinMatterBounds(site, to)) continue;
      const feet: Vec3 = [to[0], to[1] + 0.885, to[2]];
      if (weave.banks.some(b => bankProgress(b, feet).supported)) continue;
      const key = JSON.stringify([port.point, to]);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        id: `${site.id}:weave:local:${weave.revision}:${candidates.length}`,
        siteId: site.id, kind: "weave", weaveSegment: port.segment, attachment: port.attachment, crossSlope,
        turnDegrees: target.turnDegrees,
        physical: { from: port.point, to, distance: Math.hypot(p[0] - port.point[0], p[2] - port.point[2]),
          span: Math.hypot(to[0] - port.point[0], to[2] - port.point[2]), rise: to[1] - port.point[1], medium: site.medium ?? "air", landing: groundAt(to) },
      });
    }
  }
  // Keep a balanced physical menu under the request's sixteen-option budget.
  const balanced = [
    ...candidates.filter(c => c.attachment === "far end").slice(0, 8),
    ...candidates.filter(c => c.attachment === "near end").slice(0, 6),
    ...candidates.filter(c => c.attachment === "middle").slice(0, 2),
  ];
  return balanced.length ? { bank: free, segment: bank.segment + 1, candidates: balanced } : null;
}

export function applySteeringCandidate(weave: Weave, bank: number, candidate: Candidate, time: number) {
  const occupied = weave.banks[1 - bank];
  if (candidate.weaveSegment === undefined || !candidate.physical) throw new Error("Missing physical continuation");
  const reverse = candidate.weaveSegment < occupied.segment;
  weave.revision++;
  weave.banks[bank] = { segment: candidate.weaveSegment,
    from: reverse ? candidate.physical.to : candidate.physical.from,
    to: reverse ? candidate.physical.from : candidate.physical.to,
    since: time, version: weave.revision, crossSlope: (candidate.crossSlope ?? 0) * (reverse ? -1 : 1),
    shape: candidate.attachment === "middle" ? "fan" : candidate.turnDegrees ? "arch" : "deck" };
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
  const under = layer === 1;
  const fan = under && bank.shape === "fan";
  const arch = under && bank.shape === "arch";
  const visualAcross = fan ? across * 1.18 : across;
  return {
    position: [
      bank.from[0] + dx * t - (dz / run) * visualAcross,
      bank.from[1] + rise * t + across * (bank.crossSlope ?? 0) - 0.16 - layer * 0.36 -
        (arch ? Math.sin(t * Math.PI) * 0.9 : 0) - (fan ? Math.abs(across) * 0.18 : 0),
      bank.from[2] + dz * t + (dx / run) * visualAcross,
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
    const joint = direction > 0 ? bank.to : bank.from;
    const jointFeet: Vec3 = [joint[0], joint[1] + 0.885, joint[2]];
    if (
      (direction > 0 ? next.t < 0.92 : next.t > 0.08) ||
      groundAt(joint, -(PLAYER_RADIUS + WEAVE_END_CAP)) ||
      groundAt([p[0] + movement[0], p[1] - 0.825, p[2] + movement[2]]) ||
      weave.banks.some((b) => b !== bank && time - b.since >= WEAVE_SECONDS &&
        (bankProgress(b, jointFeet).supported || bankProgress(b, [p[0] + movement[0], p[1], p[2] + movement[2]]).supported))
    )
      continue;
    // An angled continuation must not turn the waiting motion into a sideways
    // slide off the retained section while its adjoining half assembles.
    if (weave.banks.some(b => b !== bank && time - b.since < WEAVE_SECONDS &&
      bankProgress(b, jointFeet).supported)) return [0, movement[1], 0];
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
