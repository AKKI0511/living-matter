export type Vec3 = [number, number, number];
export type FormationKind =
  "bridge" | "stairs" | "platform" | "floating-path" | "weave";
export type StructureBox = { position: Vec3; size: Vec3; rotation?: Vec3 };
export type Site = {
  id: string;
  start: Vec3;
  end: Vec3;
  candidates: FormationKind[];
  medium?: "air" | "water";
  steering?: boolean;
};
export const sites: Site[] = [
  {
    id: "reach",
    start: [0, 0, -25],
    end: [-14, 0, -45],
    steering: true,
    candidates: ["bridge", "platform", "weave"],
  },
  {
    id: "rise",
    start: [-14, 0, -69],
    end: [14, 6, -85],
    steering: true,
    candidates: ["stairs", "platform", "weave"],
  },
  {
    id: "drift",
    start: [14, 6, -111],
    end: [-12, 6, -133],
    steering: true,
    candidates: ["platform", "bridge", "weave"],
  },
  {
    id: "tide",
    medium: "water",
    start: [-12, 6, -155],
    end: [10, 6, -183],
    steering: true,
    candidates: ["floating-path", "platform", "weave"],
  },
];
export const islands: StructureBox[] = [
  { position: [0, -4, -9], size: [20, 8, 32] },
  { position: [-14, -5, -57], size: [18, 10, 24] },
  { position: [14, -1, -98], size: [22, 14, 26] },
  { position: [-12, 0, -144], size: [20, 12, 22] },
  { position: [10, 0, -200], size: [30, 12, 34] },
];
export const SPAWN: Vec3 = [0, 1.1, 1];
export const terraces: StructureBox[] = [{ position: [-12, -2, -4], size: [4, 4, 12] }];
export const walkableGround = [...islands, ...terraces];
export const MONUMENT = { position: [10, 22.5, -211] as Vec3, radius: 15.5, tube: 1.1 };
export const DESTINATION: Vec3 = [10, 6, -204];
export const WORLD_LIMITS = { minX: -46, maxX: 46, minZ: -222, maxZ: 16 };
export const WATER_LEVEL = -3;

// Rendering and static collision use these same dimensions and transforms.
export const architectureBoxes: StructureBox[] = [
  { position: [-7.8, 5.5, -9], size: [1.8, 11, 2.5] },
  { position: [7.8, 5.5, -9], size: [1.8, 11, 2.5] },
  { position: [0, 10.6, -9], size: [17.4, 1.5, 2.5] },
  { position: [-21.6, 1.2, -57], size: [1, 2.4, 11] },
  { position: [-6.4, 1.2, -57], size: [1, 2.4, 11] },
  { position: [-21.6, 3.2, -60], size: [1.4, 6.4, 1.4] },
  { position: [-6.4, 3.2, -60], size: [1.4, 6.4, 1.4] },
  { position: [5, 13, -97], size: [1.5, 14, 2] },
  { position: [23, 13, -97], size: [1.5, 14, 2] },
  { position: [14, 19.5, -97], size: [19.5, 1, 2] },
  { position: [5, 10, -104], size: [1.5, 8, 2] },
  { position: [23, 10, -104], size: [1.5, 8, 2] },
  { position: [-20.8, 6.35, -144], size: [0.6, 0.7, 10] },
  { position: [-3.2, 6.35, -144], size: [0.6, 0.7, 10] },
  { position: [-13.6, 0.45, -4], size: [0.4, 0.9, 10] },
  { position: [-2.5, 9, -211], size: [1.7, 6, 3] },
  { position: [22.5, 9, -211], size: [1.7, 6, 3] },
];
export const columns = Array.from({ length: 7 }, (_, i) => ({
  position: [-21, 5, -119 - i * 7] as Vec3,
  height: 24 - i * 1.5,
  topRadius: 0.9,
  bottomRadius: 1.15,
}));
// Background cliffs now sit outside the matter bounds; no decorative box towers.
export const distantFragments: StructureBox[] = [];

/** The same physical boundary applies to every route, including player detours. */
export function withinMatterBounds(_site: Site, p: Vec3) {
  return p[0] >= WORLD_LIMITS.minX + 3 && p[0] <= WORLD_LIMITS.maxX - 3 &&
    p[2] >= WORLD_LIMITS.minZ + 3 && p[2] <= WORLD_LIMITS.maxZ - 3 &&
    p[1] >= -1 && p[1] <= 14;
}

/** Reject decks that would place the player or matter inside permanent solids. */
export function clearMatterSection(from: Vec3, to: Vec3, crossSlope = 0) {
  const dx = to[0] - from[0], dz = to[2] - from[2], run = Math.hypot(dx, dz);
  if (run < 1) return false;
  // A section wholly above walkable ground only adds a low wall across the
  // island. Allow a shore seam, but stop recycling matter deeper onto land.
  if (walkableGround.some(b => [from, to].every(p =>
    Math.abs(p[0] - b.position[0]) < b.size[0] / 2 - 0.5 &&
    Math.abs(p[2] - b.position[2]) < b.size[2] / 2 - 0.5 &&
    p[1] < b.position[1] + b.size[1] / 2 + 3))) return false;
  for (let row = 0; row <= Math.ceil(run / 0.4); row++) {
    const t = row / Math.ceil(run / 0.4);
    for (const across of [-2.4, -1.2, 0, 1.2, 2.4]) {
      const p: Vec3 = [from[0] + dx * t - dz / run * across,
        from[1] + (to[1] - from[1]) * t + across * crossSlope,
        from[2] + dz * t + dx / run * across];
      if (!withinMatterBounds(sites[0], p)) return false;
      if (walkableGround.some(b => Math.abs(p[0] - b.position[0]) < b.size[0] / 2 &&
        Math.abs(p[2] - b.position[2]) < b.size[2] / 2 &&
        p[1] < b.position[1] + b.size[1] / 2 - 0.12)) return false;
      if ([...architectureBoxes, ...distantFragments].some(b => {
        const local = boxCoordinates([p[0], p[1] + 0.8, p[2]], b);
        return Math.abs(local[0]) < b.size[0] / 2 + 0.35 &&
          Math.abs(local[2]) < b.size[2] / 2 + 0.35 &&
          Math.abs(local[1]) < b.size[1] / 2 + 0.8;
      })) return false;
      if (columns.some(c => Math.hypot(p[0] - c.position[0], p[2] - c.position[2]) < c.bottomRadius + 0.35 &&
        p[1] < c.position[1] + c.height / 2 && p[1] + 1.6 > c.position[1] - c.height / 2)) return false;
      if (Math.abs(p[2] - MONUMENT.position[2]) < MONUMENT.tube + 0.35 &&
        Math.abs(Math.hypot(p[0] - MONUMENT.position[0], p[1] + 0.8 - MONUMENT.position[1]) - MONUMENT.radius) < MONUMENT.tube + 0.8) return false;
    }
  }
  return true;
}
export function siteAxis(site: Site) {
  const dx = site.end[0] - site.start[0], dz = site.end[2] - site.start[2];
  const run = Math.hypot(dx, dz);
  return { dx, dz, run, ux: dx / run, uz: dz / run, yaw: Math.atan2(-dx, -dz) };
}
/** Coordinates in a box's local axes, including pitched and rotated ramps. */
export function boxCoordinates(p: Vec3, box: StructureBox, offset: Vec3 = [0, 0, 0]): Vec3 {
  let [x, y, z] = p.map((v, i) => v - box.position[i] - offset[i]);
  const [rx, ry, rz] = box.rotation ?? [0, 0, 0];
  [y, z] = [Math.cos(rx) * y + Math.sin(rx) * z, -Math.sin(rx) * y + Math.cos(rx) * z];
  [x, z] = [Math.cos(ry) * x - Math.sin(ry) * z, Math.sin(ry) * x + Math.cos(ry) * z];
  [x, y] = [Math.cos(rz) * x + Math.sin(rz) * y, -Math.sin(rz) * x + Math.cos(rz) * y];
  return [x, y, z];
}
export const MATTER_COUNT = 512;
export const FORMATION_SECONDS = 3.4;
export const PLAYER_RADIUS = 0.32;
export const WEAVE_END_CAP = 0.15;
export const PLAYER_HALF_HEIGHT = 0.48;

export function structureBoxes(
  site: Site,
  kind: Exclude<FormationKind, "weave">,
): StructureBox[] {
  const [x, y, z] = site.start;
  const { run: length, ux, uz, yaw } = siteAxis(site);
  if (kind === "platform")
    return [{ position: [x + ux * (2.55 / Math.abs(uz)), y - 0.32, z - 2.55], size: [4.8, 1, 4.8] }];
  if (kind === "stairs")
    return Array.from({ length: 32 }, (_, i) => ({
      position: [
        x + ux * (length * (i + 0.5)) / 32,
        y + ((site.end[1] - y) * (i + 1)) / 32 - 0.45,
        z + uz * (length * (i + 0.5)) / 32,
      ],
      size: [4.8, 0.9, length / 32 + 0.02] as Vec3,
      rotation: [0, yaw, 0] as Vec3,
    }));
  return [
    {
      position: [(x + site.end[0]) / 2, y - 0.39, (z + site.end[2]) / 2],
      size: [4.8, 0.9, length + 0.4],
      rotation: [0, yaw, 0],
    },
  ];
}

export function collisionBoxes(
  site: Site,
  kind: Exclude<FormationKind, "weave">,
): StructureBox[] {
  if (kind !== "stairs") return structureBoxes(site, kind);
  const rise = site.end[1] - site.start[1],
    { run, ux, uz, yaw } = siteAxis(site);
  const angle = Math.atan2(rise, run),
    thickness = 0.3;
  // A continuous support plane under the treads prevents capsule snagging.
  return [
    {
      position: [
        (site.start[0] + site.end[0]) / 2 + ux * (Math.sin(angle) * thickness) / 2,
        (site.start[1] + site.end[1]) / 2 +
          0.1 -
          (Math.cos(angle) * thickness) / 2,
        (site.start[2] + site.end[2]) / 2 + uz * (Math.sin(angle) * thickness) / 2,
      ],
      size: [4.8, thickness, Math.hypot(rise, run) + 0.2],
      rotation: [
        Math.atan2(Math.sin(angle), Math.cos(yaw) * Math.cos(angle)),
        Math.asin(Math.sin(yaw) * Math.cos(angle)),
        Math.atan2(-Math.sin(yaw) * Math.sin(angle), Math.cos(yaw)),
      ],
    },
  ];
}

/** Height of the collider's top plane at a world position, including ramp tilt. */
export function supportHeight(box: StructureBox, p: Vec3) {
  const local = boxCoordinates([p[0],0,p[2]],box);
  const normalY = boxCoordinates([p[0],1,p[2]],box)[1] - local[1];
  return Math.abs(normalY) > 0.01 ? (box.size[1] / 2 - local[1]) / normalY : box.position[1] + box.size[1] / 2;
}

export type MatterPose = { position: Vec3; scale: Vec3; yaw?: number };
export function formationPose(
  site: Site,
  kind: Exclude<FormationKind, "weave">,
  index: number,
): MatterPose {
  const x = index % 8,
    row = Math.floor(index / 8) % 32,
    layer = Math.floor(index / 256);
  const { run: length, ux, uz, yaw } = siteAxis(site);
  if (kind === "platform") {
    const iy = Math.floor(index / 64),
      iz = Math.floor(index / 8) % 8;
    return {
      position: [
        structureBoxes(site, "platform")[0].position[0] + (x - 3.5) * 0.6,
        site.start[1] + 0.1175 - iy * 0.125,
        site.start[2] - 2.55 + (iz - 3.5) * 0.6,
      ],
      scale: [0.576, 0.12, 0.576],
    };
  }
  const stepY =
    kind === "stairs" ? ((site.end[1] - site.start[1]) * (row + 1)) / 32 : 0.06;
  const span = kind === "stairs" ? length : length + 0.4;
  const along = length / 2 - span / 2 + ((row + 0.5) * span) / 32;
  const across = (x - 3.5) * 0.6;
  return {
    position: [
      site.start[0] + ux * along - uz * across,
      site.start[1] + stepY - 0.225 - layer * 0.45,
      site.start[2] + uz * along + ux * across,
    ],
    scale: [0.576, 0.43, (span / 32) * 0.96],
    yaw,
  };
}

export function smooth(t: number) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}
export const PLATFORM_DWELL_SECONDS = 1.5;
export const PLATFORM_TRAVEL_SECONDS = 5;
export const PLATFORM_HALF_CYCLE_SECONDS = PLATFORM_DWELL_SECONDS + PLATFORM_TRAVEL_SECONDS;
export function platformOffset(site: Site, elapsed: number): Vec3 {
  // Brief boarding dwell; smooth acceleration and zero velocity at both docks.
  const period = 2 * PLATFORM_HALF_CYCLE_SECONDS,
    phase = ((elapsed % period) + period) % period;
  const t =
    phase < PLATFORM_DWELL_SECONDS
      ? 0
      : phase < PLATFORM_HALF_CYCLE_SECONDS
        ? smooth((phase - PLATFORM_DWELL_SECONDS) / PLATFORM_TRAVEL_SECONDS)
        : phase < PLATFORM_HALF_CYCLE_SECONDS + PLATFORM_DWELL_SECONDS
          ? 1
          : 1 - smooth((phase - PLATFORM_HALF_CYCLE_SECONDS - PLATFORM_DWELL_SECONDS) / PLATFORM_TRAVEL_SECONDS);
  const { dx, ux, uz } = siteAxis(site);
  return [
    (dx - 2 * ux * (2.55 / Math.abs(uz))) * t,
    (site.end[1] - site.start[1]) * t,
    (site.end[2] - site.start[2] + 5.1) * t,
  ];
}
