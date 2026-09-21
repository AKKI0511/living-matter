export type Vec3 = [number, number, number];
export type FormationKind = "bridge" | "stairs" | "platform" | "floating-path";
export type StructureBox = { position: Vec3; size: Vec3; rotation?: Vec3 };
export type Site = {
  id: string;
  start: Vec3;
  end: Vec3;
  candidates: FormationKind[];
  medium?: "air" | "water";
};
export const sites: Site[] = [
  {
    id: "reach",
    start: [0, 0, -25],
    end: [0, 0, -45],
    candidates: ["bridge", "platform"],
  },
  {
    id: "rise",
    start: [0, 0, -69],
    end: [0, 6, -85],
    candidates: ["stairs", "platform"],
  },
  {
    id: "drift",
    start: [0, 6, -111],
    end: [0, 6, -133],
    candidates: ["platform", "bridge"],
  },
  {
    id: "tide",
    medium: "water",
    start: [0, 6, -155],
    end: [0, 6, -183],
    candidates: ["floating-path", "platform"],
  },
];
export const islands: StructureBox[] = [
  { position: [0, -4, -9], size: [20, 8, 32] },
  { position: [0, -5, -57], size: [18, 10, 24] },
  { position: [0, -1, -98], size: [22, 14, 26] },
  { position: [0, 0, -144], size: [20, 12, 22] },
  { position: [0, 0, -200], size: [30, 12, 34] },
];
export const SPAWN: Vec3 = [0, 1.1, 1];
export const DESTINATION: Vec3 = [0, 6, -204];
export const MATTER_COUNT = 512;
export const FORMATION_SECONDS = 3.4;
export const PLAYER_RADIUS = 0.32;
export const PLAYER_HALF_HEIGHT = 0.48;

export function structureBoxes(
  site: Site,
  kind: FormationKind,
): StructureBox[] {
  const [x, y, z] = site.start;
  const length = z - site.end[2];
  if (kind === "platform")
    return [{ position: [x, y - 0.32, z - 2.55], size: [4.8, 1, 4.8] }];
  if (kind === "stairs")
    return Array.from({ length: 32 }, (_, i) => ({
      position: [
        x,
        y + ((site.end[1] - y) * (i + 1)) / 32 - 0.45,
        z - (length * (i + 0.5)) / 32,
      ],
      size: [4.8, 0.9, length / 32 + 0.02] as Vec3,
    }));
  return [
    {
      position: [x, y - 0.39, (z + site.end[2]) / 2],
      size: [4.8, 0.9, length + 0.4],
    },
  ];
}

export function collisionBoxes(
  site: Site,
  kind: FormationKind,
): StructureBox[] {
  if (kind !== "stairs") return structureBoxes(site, kind);
  const rise = site.end[1] - site.start[1],
    run = site.start[2] - site.end[2];
  const angle = Math.atan2(rise, run),
    thickness = 0.3;
  // A continuous support plane under the treads prevents capsule snagging.
  return [
    {
      position: [
        site.start[0],
        (site.start[1] + site.end[1]) / 2 +
          0.1 -
          (Math.cos(angle) * thickness) / 2,
        (site.start[2] + site.end[2]) / 2 - (Math.sin(angle) * thickness) / 2,
      ],
      size: [4.8, thickness, Math.hypot(rise, run) + 0.2],
      rotation: [angle, 0, 0],
    },
  ];
}

export type MatterPose = { position: Vec3; scale: Vec3 };
export function formationPose(
  site: Site,
  kind: FormationKind,
  index: number,
): MatterPose {
  const x = index % 8,
    row = Math.floor(index / 8) % 32,
    layer = Math.floor(index / 256);
  const length = site.start[2] - site.end[2];
  if (kind === "platform") {
    const iy = Math.floor(index / 64),
      iz = Math.floor(index / 8) % 8;
    return {
      position: [
        site.start[0] + (x - 3.5) * 0.6,
        site.start[1] + 0.1175 - iy * 0.125,
        site.start[2] - 2.55 + (iz - 3.5) * 0.6,
      ],
      scale: [0.576, 0.12, 0.576],
    };
  }
  const stepY =
    kind === "stairs" ? ((site.end[1] - site.start[1]) * (row + 1)) / 32 : 0.06;
  const span = kind === "stairs" ? length : length + 0.4;
  return {
    position: [
      site.start[0] + (x - 3.5) * 0.6,
      site.start[1] + stepY - 0.225 - layer * 0.45,
      (site.start[2] + site.end[2]) / 2 + span / 2 - ((row + 0.5) * span) / 32,
    ],
    scale: [0.576, 0.43, (span / 32) * 0.96],
  };
}

export function smooth(t: number) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}
export function platformOffset(site: Site, elapsed: number): Vec3 {
  // A generous boarding dwell at either shore; zero velocity at both ends.
  const period = 18,
    phase = ((elapsed % period) + period) % period;
  const t =
    phase < 3
      ? 0
      : phase < 9
        ? smooth((phase - 3) / 6)
        : phase < 12
          ? 1
          : 1 - smooth((phase - 12) / 6);
  return [
    0,
    (site.end[1] - site.start[1]) * t,
    (site.end[2] - site.start[2] + 5.1) * t,
  ];
}
