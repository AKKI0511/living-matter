import { collisionBoxes, islands, sites, type Vec3 } from "./world";
import { bankProgress, WEAVE_SECONDS, type Weave } from "./weave";
import type { Candidate, Observation } from "./decisions";

export type PhysicalEvent = {
  support: string;
  motion: string;
  position_on_support?: string;
  facing_into?: string;
  surface_beyond_facing?: string;
};
export type MatterDescription = {
  state: "idle" | "forming" | "active";
  form?: string;
  player_supported_by_matter: boolean;
  occupied_section?: string;
  reusable_section?: string;
  reusable_section_relative_to_player?: string;
};
export type SemanticState = {
  player_now: PhysicalEvent;
  recent_behavior_oldest_to_newest: PhysicalEvent[];
  matter_now: MatterDescription;
};
export type PhysicalScene = {
  time: number;
  activeSite: number | null;
  phase: "idle" | "forming" | "active" | "dissolving";
  kind?: string;
  offset?: Vec3;
  weave: Weave | null;
};

const flat = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[2]) || 1;
  return [v[0] / n, 0, v[2] / n];
};
export function relativeDirection(from: Vec3, to: Vec3, gaze: Vec3) {
  const f = flat(gaze), d = flat([to[0] - from[0], 0, to[2] - from[2]]);
  const angle = Math.atan2(f[0] * d[2] - f[2] * d[0], f[0] * d[0] + f[2] * d[2]);
  const buckets = ["ahead", "ahead-right", "right", "behind-right", "behind", "behind-left", "left", "ahead-left"];
  return buckets[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
}
function permanentSupport(p: Vec3) {
  return islands.find((b) =>
    Math.abs(p[0] - b.position[0]) <= b.size[0] / 2 + 0.15 &&
    Math.abs(p[2] - b.position[2]) <= b.size[2] / 2 + 0.15 &&
    Math.abs(p[1] - (b.position[1] + b.size[1] / 2 + 0.825)) < 0.5,
  );
}
function supportIdentity(o: Observation, scene: PhysicalScene) {
  if (!o.grounded) return null;
  if (scene.weave && scene.phase === "active") {
    const bank = scene.weave.banks.find((b) => bankProgress(b, o.position).supported);
    if (bank) return `matter:${scene.activeSite}:${bank.version}:${bank.segment}`;
  }
  if (matterSupport(o.position, true, scene)) return `matter:${scene.activeSite}`;
  const ground = permanentSupport(o.position);
  return ground ? `ground:${islands.indexOf(ground)}` : null;
}
export function matterSupport(p: Vec3, grounded: boolean, scene: PhysicalScene) {
  if (!grounded || scene.activeSite === null || scene.phase !== "active") return false;
  if (scene.kind === "weave") return !!scene.weave?.banks.some((b) => bankProgress(b, p).supported);
  const site = sites[scene.activeSite], offset = scene.offset ?? [0, 0, 0];
  return collisionBoxes(site, scene.kind as Exclude<typeof site.candidates[number], "weave">).some((b) =>
    Math.abs(p[0] - b.position[0] - offset[0]) <= b.size[0] / 2 + 0.2 &&
    Math.abs(p[2] - b.position[2] - offset[2]) <= b.size[2] / 2 + 0.2 &&
    Math.abs(p[1] - (scene.kind === "stairs"
      ? site.start[1] + (site.end[1] - site.start[1]) * ((site.start[2] - p[2]) / (site.start[2] - site.end[2])) + 0.825
      : b.position[1] + offset[1] + b.size[1] / 2 + 0.825)) < 0.6,
  );
}
function matterAhead(p: Vec3, scene: PhysicalScene) {
  if (scene.activeSite === null || scene.phase !== "active") return false;
  if (scene.weave) return scene.weave.banks.some((b) => {
    const progress = bankProgress(b, p);
    return scene.time - b.since >= WEAVE_SECONDS && progress.t >= 0 && progress.t <= 1 && progress.across < 2.15;
  });
  const site = sites[scene.activeSite], offset = scene.offset ?? [0, 0, 0];
  return collisionBoxes(site, scene.kind as Exclude<typeof site.candidates[number], "weave">).some((b) =>
    Math.abs(p[0] - b.position[0] - offset[0]) <= b.size[0] / 2 &&
    Math.abs(p[2] - b.position[2] - offset[2]) <= b.size[2] / 2,
  );
}
function motion(o: Observation) {
  if (!o.grounded) return o.velocity[1] > 1 ? "jumping" : "falling";
  const speed = Math.hypot(o.velocity[0], o.velocity[2]);
  if (speed < 0.35) return "standing";
  const direction = relativeDirection(o.position, [o.position[0] + o.velocity[0], o.position[1], o.position[2] + o.velocity[2]], o.gaze);
  return `${speed > 5 ? "running" : "walking"} ${direction === "ahead" ? "forward" : direction}`;
}
export function describePhysical(o: Observation, scene: PhysicalScene): PhysicalEvent {
  const p = o.position, gaze = flat(o.gaze), onMatter = matterSupport(p, o.grounded, scene);
  const ground = permanentSupport(p);
  const event: PhysicalEvent = { support: onMatter ? "living matter" : o.grounded && ground ? "permanent ground" : "unsupported", motion: motion(o) };
  let edgeDistance = Infinity;
  if (onMatter && scene.weave) {
    const progress = scene.weave.banks.map((b) => bankProgress(b, p)).find((v) => v.supported);
    if (progress) edgeDistance = Math.min(progress.t, 1 - progress.t) * 5;
  } else if (ground) {
    edgeDistance = Math.min(
      ground.size[0] / 2 - Math.abs(p[0] - ground.position[0]),
      ground.size[2] / 2 - Math.abs(p[2] - ground.position[2]),
    );
  }
  if (edgeDistance < 1.2) event.position_on_support = "at an edge";
  else if (edgeDistance < 4.5) event.position_on_support = "near an edge";
  else if (event.support !== "unsupported") event.position_on_support = "inside the support";
  const facingPoint: Vec3 = [p[0] + gaze[0] * 4, p[1], p[2] + gaze[2] * 4];
  const aheadGround = permanentSupport(facingPoint);
  const aheadMatter = matterAhead(facingPoint, scene);
  event.facing_into = aheadMatter ? "living matter" : aheadGround ? "walkable ground" : "open air";
  if (event.facing_into === "open air") {
    const target = sites.flatMap((site) => [site.start, site.end]).find((end) => {
      const dx = end[0] - p[0], dz = end[2] - p[2], distance = Math.hypot(dx, dz);
      return distance > 5 && distance < 42 && (dx * gaze[0] + dz * gaze[2]) / distance > 0.78 && Math.abs(end[1] + 0.825 - p[1]) < 8;
    });
    if (target) event.surface_beyond_facing = `separate walkable ground ${heightWord(target[1] + 0.825 - p[1])}`;
  }
  return event;
}
function heightWord(rise: number) { return rise > 1 ? "higher" : rise < -1 ? "lower" : "at similar height"; }
export function describeMatter(o: Observation, scene: PhysicalScene): MatterDescription {
  const supported = matterSupport(o.position, o.grounded, scene);
  const state = scene.activeSite === null ? "idle" : scene.phase === "forming" ? "forming" : "active";
  const result: MatterDescription = { state, player_supported_by_matter: supported };
  if (state === "idle") return result;
  result.form = scene.kind === "weave" ? "walkable matter made from two reusable sections" : scene.kind === "platform" ? "moving deck" : "walkable matter";
  if (supported && scene.weave) {
    const occupied = scene.weave.banks.findIndex((b) => bankProgress(b, o.position).supported);
    if (occupied >= 0) {
      result.occupied_section = "the section supporting the player and it must remain";
      result.reusable_section = "unoccupied and allowed to rebuild";
      const free = scene.weave.banks[1 - occupied];
      result.reusable_section_relative_to_player = relativeDirection(o.position, [(free.from[0] + free.to[0]) / 2, (free.from[1] + free.to[1]) / 2, (free.from[2] + free.to[2]) / 2], o.gaze);
    }
  }
  return result;
}
export function describeCandidate(candidate: Candidate, o: Observation, supported: boolean): Record<string, string> {
  const p = candidate.physical!;
  const end = candidate.route && !supported ? candidate.route[1] : p.to;
  const direction = relativeDirection(o.position, end, o.gaze);
  if (candidate.kind === "platform") return {
    matter_change: "form a moving deck",
    player_use: "stand on it while it carries the player",
    starts_from: "beside the player's current support",
    travels: `through the open space ${direction}`,
    ends_at: `separate walkable ground ${heightWord(p.rise)}`,
  };
  return {
    matter_change: supported ? "reuse the unoccupied section as the next walkable section" : "form a walkable section",
    player_use: "walk on it under their own movement",
    starts_from: supported ? "the section currently supporting the player" : "the player's current support",
    extends: `${direction} of the player's current facing`,
    vertical_change: heightWord(p.rise),
    environment: p.medium === "water" ? "over water" : "over open air",
    ...(supported ? { occupied_support: "remains unchanged" } : {}),
  };
}
export class PhysicalHistory {
  private events: PhysicalEvent[] = [];
  private last: PhysicalEvent | null = null;
  private lastGaze: Vec3 | null = null;
  private lastSupportIdentity: string | null = null;
  private airborne: "jumping" | "falling" | null = null;
  private takeoffSupport: string | null = null;
  revision = 0;
  record(o: Observation, scene: PhysicalScene, recovered = false) {
    const now = describePhysical(o, scene);
    if (this.last?.support === "living matter" && now.support === "living matter" &&
      this.last.motion === "standing" && now.motion === "standing" &&
      this.lastGaze && flat(this.lastGaze).reduce((sum, value, i) => sum + value * flat(o.gaze)[i], 0) < 0.3)
      this.push({ ...now, motion: "turned around and stopped" });
    if (!o.grounded && !this.airborne) {
      this.airborne = o.velocity[1] > 1 ? "jumping" : "falling";
      this.takeoffSupport = this.lastSupportIdentity;
    }
    if (o.grounded && this.airborne) {
      const summary = { ...now, motion: recovered || this.airborne === "falling" ? "fell off the support and returned" : this.takeoffSupport === supportIdentity(o, scene) ? "jumped and landed back on the same support" : "jumped and landed on another support" };
      this.push(summary);
      this.airborne = null;
    }
    if (!this.last || JSON.stringify(now) !== JSON.stringify(this.last)) this.push(now);
    this.last = now;
    this.lastGaze = o.gaze;
    this.lastSupportIdentity = supportIdentity(o, scene);
  }
  private push(event: PhysicalEvent) { this.events.push(event); if (this.events.length > 7) this.events.shift(); this.revision++; }
  snapshot(now: PhysicalEvent) { return this.events.at(-1) && JSON.stringify(this.events.at(-1)) === JSON.stringify(now) ? this.events.slice() : [...this.events.slice(-6), now]; }
}
