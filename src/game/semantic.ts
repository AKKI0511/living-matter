import { collisionBoxes, walkableGround as islands, sites, boxCoordinates, WEAVE_END_CAP, type Vec3 } from "./world";
import { bankProgress, WEAVE_SECONDS, type Weave } from "./weave";
import type { Candidate, Observation } from "./decisions";
import { VIEW_DOWN_HEIGHT_THRESHOLD, VIEW_HEIGHT_THRESHOLD } from "./view-intent";

export type PhysicalEvent = {
  support: string;
  motion: string;
  position_on_support?: string;
  facing_into?: string;
  surface_beyond_facing?: string;
  view_height?: string;
  walkway_axis?: string;
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
// Match the travel/selection cutoff: slower motion follows held view. Giving
// Jev "walking" alongside "not moving horizontally" contradicts that intent.
const MOVEMENT_INTENT_SPEED = 0.6;
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
  return collisionBoxes(site, scene.kind as Exclude<typeof site.candidates[number], "weave">).some((b) => {
    const local = boxCoordinates([p[0], p[1] - 0.825, p[2]], b, offset);
    return Math.abs(local[0]) <= b.size[0] / 2 + 0.2 && Math.abs(local[2]) <= b.size[2] / 2 + 0.2 && Math.abs(local[1] - b.size[1] / 2) < 0.6;
  });
}
function matterAhead(p: Vec3, scene: PhysicalScene) {
  if (scene.activeSite === null || scene.phase !== "active") return false;
  if (scene.weave) return scene.weave.banks.some((b) => {
    const progress = bankProgress(b, p);
    const cap = WEAVE_END_CAP / Math.hypot(b.to[0] - b.from[0], b.to[2] - b.from[2]);
    return scene.time - b.since >= WEAVE_SECONDS && progress.t >= -cap && progress.t <= 1 + cap && progress.across < 2.15;
  });
  const site = sites[scene.activeSite], offset = scene.offset ?? [0, 0, 0];
  return collisionBoxes(site, scene.kind as Exclude<typeof site.candidates[number], "weave">).some((b) => {
    const local = boxCoordinates([p[0], b.position[1] + offset[1], p[2]], b, offset);
    return Math.abs(local[0]) <= b.size[0] / 2 && Math.abs(local[2]) <= b.size[2] / 2;
  });
}
function motion(o: Observation) {
  if (!o.grounded) return o.velocity[1] > 1 ? "jumping" : "falling";
  const speed = Math.hypot(o.velocity[0], o.velocity[2]);
  if (speed <= MOVEMENT_INTENT_SPEED) return "standing";
  const direction = relativeDirection(o.position, [o.position[0] + o.velocity[0], o.position[1], o.position[2] + o.velocity[2]], o.gaze);
  return `${speed > 5 ? "running" : "walking"} ${direction === "ahead" ? "forward" : direction}`;
}
export function describePhysical(o: Observation, scene: PhysicalScene): PhysicalEvent {
  const p = o.position, gaze = flat(o.gaze), onMatter = matterSupport(p, o.grounded, scene);
  const ground = permanentSupport(p);
  const event: PhysicalEvent = { support: onMatter ? "living matter" : o.grounded && ground ? "permanent ground" : "unsupported", motion: motion(o) };
  event.view_height = o.gaze[1] > VIEW_HEIGHT_THRESHOLD ? "looking upward" : o.gaze[1] <= -VIEW_DOWN_HEIGHT_THRESHOLD ? "looking downward" : "looking roughly level";
  let edgeDistance = Infinity;
  if (onMatter && scene.weave) {
    const progress = scene.weave.banks.map((b) => bankProgress(b, p)).find((v) => v.supported);
    if (progress) {
      const bank = scene.weave.banks.find((b) => bankProgress(b, p).supported)!;
      // An undirected axis: reversing bank endpoints must not change its
      // meaning. All directions use the player's view, just like the options.
      const axis = relativeDirection(bank.from, bank.to, o.gaze);
      event.walkway_axis = axis === "ahead" || axis === "behind" ? "ahead to behind" :
        axis === "left" || axis === "right" ? "left to right across view" :
        axis === "ahead-left" || axis === "behind-right" ? "ahead-left to behind-right" : "ahead-right to behind-left";
      edgeDistance = Math.min(Math.min(progress.t, 1 - progress.t) * Math.hypot(bank.to[0] - bank.from[0], bank.to[2] - bank.from[2]), 2.4 - progress.across);
    }
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
  // A landing beyond a gap is not continuous support. Sampling only the point
  // four units ahead told both backends to hold at unfinished shore connections.
  let continuous = !!(aheadGround || aheadMatter);
  for (let i = 1; continuous && i <= 40; i++) {
    const point: Vec3 = [p[0] + gaze[0] * i / 10, p[1], p[2] + gaze[2] * i / 10];
    if (!permanentSupport(point) && !matterAhead(point, scene)) continuous = false;
  }
  event.facing_into = continuous && aheadMatter ? "living matter" : continuous && aheadGround ? "walkable ground" : "open air";
  if (event.facing_into === "open air") {
    const target = islands.map(b => [
      Math.max(b.position[0] - b.size[0] / 2, Math.min(b.position[0] + b.size[0] / 2, p[0] + gaze[0] * 20)),
      b.position[1] + b.size[1] / 2,
      Math.max(b.position[2] - b.size[2] / 2, Math.min(b.position[2] + b.size[2] / 2, p[2] + gaze[2] * 20)),
    ] as Vec3).find((end) => {
      const dx = end[0] - p[0], dz = end[2] - p[2], distance = Math.hypot(dx, dz);
      return distance > 5 && distance < 42 && (dx * gaze[0] + dz * gaze[2]) / distance > 0.78 && Math.abs(end[1] + 0.825 - p[1]) < 8;
    });
    if (target) event.surface_beyond_facing = `separate walkable ground ${heightWord(target[1] + 0.825 - p[1])}`;
  }
  return event;
}
function heightWord(rise: number) { return rise > 0.15 ? "higher" : rise < -0.15 ? "lower" : "at similar height"; }
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
  const dx = end[0] - o.position[0], dz = end[2] - o.position[2];
  const alignment = (x: number, z: number) => {
    const dot = (x * dx + z * dz) / ((Math.hypot(x, z) || 1) * (Math.hypot(dx, dz) || 1));
    return dot > 0.96 ? "aligned" : dot > 0.75 ? "close" : dot > 0.25 ? "oblique" : dot > -0.25 ? "sideways" : "opposed";
  };
  const turn = candidate.turnDegrees ?? 0;
  let path = turn ? `${Math.abs(turn) <= 45 ? "gentle" : "sharp"} ${turn > 0 ? "right" : "left"} turn` : "straight";
  if (candidate.route) {
    const a = candidate.route[0], b = candidate.route.at(-1)!;
    const run = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    const offset = ((end[0] - a[0]) * -(b[2] - a[2]) + (end[2] - a[2]) * (b[0] - a[0])) / run;
    path = Math.abs(offset) < 0.5 ? "straight" : `bends ${offset > 0 ? "right" : "left"} before returning toward the destination`;
  }
  const formation = candidate.kind === "platform" ? "moving deck" : candidate.kind === "stairs" ? "steps" :
    candidate.kind === "floating-path" ? "stepping surfaces" : candidate.kind === "bridge" ? "bridge" : candidate.attachment === "middle" ? "side branch with a broad base" :
    turn ? "turning path with arched support" : "walking path";
  const landing = (point: Vec3) => permanentSupport([point[0], point[1] + 0.825, point[2]]) ? "solid ground" : "open gap";
  return {
    formation,
    player_use: candidate.kind === "platform" ? "ride a moving deck" : "walk",
    attachment: candidate.attachment === "middle" ? "side of existing walking surface" :
      candidate.attachment ? "end of existing walking surface" : "edge of solid ground",
    starts_from: p.distance < 0.4 ? "beneath the person" : relativeDirection(o.position, p.from, o.gaze),
    attachment_proximity: p.distance < 1.5 ? "at the person" : p.distance < 4.5 ? "nearby" : "farther along the surface",
    heading: relativeDirection(p.from, end, o.gaze),
    view_alignment: alignment(o.gaze[0], o.gaze[2]),
    movement_alignment: Math.hypot(o.velocity[0], o.velocity[2]) > MOVEMENT_INTENT_SPEED ? alignment(o.velocity[0], o.velocity[2]) : "not moving horizontally",
    vertical_change: heightWord(end[1] - p.from[1]),
    path_shape: path,
    surface_tilt: Math.abs(candidate.crossSlope ?? 0) > 0.02 ? "tilted across its width" : "level across its width",
    next_surface_ends_at: landing(end),
    ...(end !== p.to && end.some((value, axis) => value !== p.to[axis]) ? {
      eventual_destination: landing(p.to), destination_height: heightWord(p.to[1] - p.from[1]),
    } : {}),
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
  clear() {
    this.events = []; this.last = null; this.lastGaze = null;
    this.lastSupportIdentity = null; this.airborne = null; this.takeoffSupport = null;
    this.revision++;
  }
  record(o: Observation, scene: PhysicalScene, recovered = false) {
    const now = describePhysical(o, scene);
    const turned = this.last?.support === "living matter" && now.support === "living matter" &&
      this.last.motion === "standing" && now.motion === "standing" &&
      this.lastGaze && flat(this.lastGaze).reduce((sum, value, i) => sum + value * flat(o.gaze)[i], 0) < 0.82;
    if (turned) this.push({ ...now, motion: now.facing_into === "open air" ? "turned toward unsupported space and stopped" : "turned on the support and stopped" });
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
    if (!this.lastGaze || turned || now.motion !== "standing" || now.support !== "living matter") this.lastGaze = o.gaze;
    this.lastSupportIdentity = supportIdentity(o, scene);
  }
  private push(event: PhysicalEvent) { this.events.push(event); if (this.events.length > 7) this.events.shift(); this.revision++; }
  snapshot(now: PhysicalEvent) { return this.events.at(-1) && JSON.stringify(this.events.at(-1)) === JSON.stringify(now) ? this.events.slice() : [...this.events.slice(-6), now]; }
}
