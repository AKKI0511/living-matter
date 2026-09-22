"use client";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CapsuleCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type RapierRigidBody,
  type RapierCollider,
} from "@react-three/rapier";
import { Euler, Vector3 } from "three";
import { input } from "./input";
import { useGame } from "./store";
import { sound } from "./audio";
import {
  DESTINATION,
  islands,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
  sites,
  SPAWN,
} from "./world";
import type { Runtime } from "./runtime";
import { guardWeaveEdge } from "./weave";

export function Player({ runtime }: { runtime: Runtime }) {
  const body = useRef<RapierRigidBody>(null),
    collider = useRef<RapierCollider>(null);
  const controller = useRef<ReturnType<
    ReturnType<typeof useRapier>["world"]["createCharacterController"]
  > | null>(null);
  const { world, rapier } = useRapier();
  const { camera, invalidate } = useThree();
  const motion = useRef({
    x: 0,
    z: 0,
    y: 0,
    coyote: 0,
    jumpBuffer: 0,
    previousJump: false,
    steps: 0,
    cameraY: SPAWN[1] + 0.65,
    wasGrounded: false,
    carrierX: 0,
    carrierZ: 0,
    airX: 0,
    airZ: 0,
  });
  const rotation = useRef(new Euler(0, 0, 0, "YXZ"));
  const gaze = useRef(new Vector3());
  const diagnosticsEnabled = useRef(
    process.env.NODE_ENV === "development" &&
      new URLSearchParams(window.location.search).has("diagnostics"),
  );
  const finale = useRef({
    started: false,
    look: new Vector3(),
    position: new Vector3(10, 17, -174),
    target: new Vector3(0, 21, -207),
  });
  useEffect(() => {
    const kcc = world.createCharacterController(0.025);
    kcc.setNormalNudgeFactor(0.005);
    kcc.enableAutostep(0.32, 0.12, false);
    kcc.enableSnapToGround(0.35);
    kcc.setMaxSlopeClimbAngle(Math.PI / 3);
    kcc.setMinSlopeSlideAngle(Math.PI / 3);
    controller.current = kcc;
    return () => {
      world.removeCharacterController(kcc);
      controller.current = null;
    };
  }, [world]);

  useBeforePhysicsStep(() => {
    const rb = body.current,
      col = collider.current,
      kcc = controller.current;
    if (!rb || !col || !kcc || useGame.getState().phase !== "playing") return;
    const dt = 1 / 60,
      m = motion.current;
    runtime.time += dt;
    if (runtime.forcedPosition) {
      const p = runtime.forcedPosition;
      rb.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
      rb.setNextKinematicTranslation({ x: p[0], y: p[1], z: p[2] });
      m.x = m.z = m.y = m.airX = m.airZ = m.carrierX = m.carrierZ = 0;
      m.cameraY = p[1] + 0.65;
      runtime.forcedPosition = null;
    }
    const pos = rb.translation();
    const speed = input.sprint ? 6.2 : 4.2;
    const magnitude = Math.max(1, Math.hypot(input.forward, input.right));
    const f = input.forward / magnitude,
      r = input.right / magnitude;
    const targetX =
      (-Math.sin(input.yaw) * f + Math.cos(input.yaw) * r) * speed;
    const targetZ =
      (-Math.cos(input.yaw) * f - Math.sin(input.yaw) * r) * speed;
    const response = 1 - Math.exp(-(runtime.grounded ? 18 : 6) * dt);
    m.x += (targetX - m.x) * response;
    m.z += (targetZ - m.z) * response;
    m.coyote = runtime.grounded ? 0.12 : Math.max(0, m.coyote - dt);
    if (input.jumpQueued || (input.jump && !m.previousJump))
      m.jumpBuffer = 0.14;
    else m.jumpBuffer = Math.max(0, m.jumpBuffer - dt);
    input.jumpQueued = false;
    m.previousJump = input.jump;
    if (m.jumpBuffer > 0 && m.coyote > 0) {
      m.y = 6.6;
      m.jumpBuffer = 0;
      m.coyote = 0;
      runtime.grounded = false;
      m.airX = m.carrierX;
      m.airZ = m.carrierZ;
    } else if (runtime.grounded && m.y < 0) m.y = -0.6;
    m.y = Math.max(-24, m.y - 19 * dt);
    let supportedDeck: number | null = null;
    let carryX = 0,
      carryY = 0,
      carryZ = 0;
    runtime.states.forEach((s, i) => {
      if (s.phase !== "active" || s.kind !== "platform" || m.y > 1) return;
      const site = sites[i],
        deck = site.start[1] + 0.18 + s.previousOffset[1];
      if (
        Math.abs(pos.x - site.start[0]) < 2.65 &&
        Math.abs(pos.z - (site.start[2] - 2.55 + s.previousOffset[2])) < 2.65 &&
        Math.abs(pos.y - 0.825 - deck) < 0.3
      ) {
        supportedDeck = site.start[1] + 0.18 + s.offset[1];
        carryX += s.offset[0] - s.previousOffset[0];
        carryY += s.offset[1] - s.previousOffset[1];
        carryZ += s.offset[2] - s.previousOffset[2];
      }
    });
    if (runtime.grounded) {
      m.carrierX = carryX / dt;
      m.carrierZ = carryZ / dt;
      m.airX = m.airZ = 0;
    } else {
      m.airX *= Math.exp(-0.35 * dt);
      m.airZ *= Math.exp(-0.35 * dt);
    }
    // Queries use the explicit formation admission set; inactive proxies must never become invisible support.
    let movement: [number, number, number] = [
      (m.x + m.airX) * dt + carryX,
      m.y * dt + carryY,
      (m.z + m.airZ) * dt + carryZ,
    ];
    if (runtime.weave && runtime.grounded && m.y <= 0)
      movement = guardWeaveEdge(
        runtime.weave,
        [pos.x, pos.y, pos.z],
        movement,
        runtime.time,
      );
    kcc.computeColliderMovement(
      col,
      {
        x: movement[0],
        y: movement[1],
        z: movement[2],
      },
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      (c) =>
        (!runtime.matterColliderHandles.has(c.handle) ||
          runtime.solidColliderHandles.has(c.handle)) &&
        (supportedDeck === null ||
          c.parent()?.handle !== runtime.platformBodyHandle),
    );
    const delta = kcc.computedMovement();
    if (diagnosticsEnabled.current) {
      const contacts = [];
      for (let i = 0; i < kcc.numComputedCollisions(); i++) {
        const c = kcc.computedCollision(i);
        if (c)
          contacts.push({
            normal: c.normal1,
            point: c.witness1,
            collider: c.collider?.translation(),
            half: c.collider?.halfExtents(),
          });
      }
      runtime.diagnostics = {
        input: { ...input },
        desired: [m.x, m.y, m.z],
        delta,
        contacts,
      };
    }
    let grounded = kcc.computedGrounded();
    if (supportedDeck !== null && m.y <= 0) {
      const s = runtime.states[runtime.activeSite!],
        site = sites[runtime.activeSite!];
      if (
        Math.abs(pos.x + delta.x - site.start[0]) < 2.65 &&
        Math.abs(pos.z + delta.z - (site.start[2] - 2.55 + s.offset[2])) < 2.65
      ) {
        delta.y = supportedDeck + 0.825 - pos.y;
        grounded = true;
        m.y = -0.6;
      }
    }
    if (grounded && !m.wasGrounded && m.y < -3) sound.land();
    m.wasGrounded = grounded;
    runtime.grounded = grounded;
    if (delta.y < m.y * dt - 0.01 && m.y > 0) m.y = 0;
    // Keep the capsule just outside the contact margin. Coplanar seam rounding can
    // otherwise start the next sweep inside its skin and exhaust Rapier's iterations.
    const next = {
      x: pos.x + delta.x,
      y: pos.y + delta.y + (grounded ? 0.002 : 0),
      z: pos.z + delta.z,
    };
    rb.setNextKinematicTranslation(next);
    runtime.player[0] = next.x;
    runtime.player[1] = next.y;
    runtime.player[2] = next.z;
    runtime.velocity[0] = delta.x / dt;
    runtime.velocity[1] = delta.y / dt;
    runtime.velocity[2] = delta.z / dt;
    if (grounded) {
      m.steps += Math.hypot(delta.x - carryX, delta.z - carryZ);
      if (m.steps > 1.9) {
        sound.step();
        m.steps = 0;
      }
      for (const island of islands) {
        if (
          Math.abs(next.x - island.position[0]) < island.size[0] / 2 - 2 &&
          Math.abs(next.z - island.position[2]) < island.size[2] / 2 - 3 &&
          Math.abs(next.y - (island.position[1] + island.size[1] / 2 + 0.825)) <
            0.25
        ) {
          runtime.checkpoint = [next.x, next.y + 0.1, next.z];
        }
      }
    }
    const waterHeight =
      next.z < -154 && next.z > -184 && Math.abs(next.x) < 23 ? 5.15 : -3;
    if (next.y < waterHeight + 0.1 || Math.abs(next.x) > 160) {
      runtime.recoveries++;
      runtime.forcedPosition = [...runtime.checkpoint];
      sound.tone(140, 0.7, 0.1);
      document.documentElement.animate([{ opacity: 0.3 }, { opacity: 1 }], {
        duration: 650,
      });
    }
    if (next.z < DESTINATION[2] && Math.abs(next.x) < 5 && next.y > 6) {
      useGame.getState().setPhase("complete");
      sound.arrive();
      document.exitPointerLock?.();
    }
    if (runtime.time >= runtime.nextObservation) {
      runtime.nextObservation = runtime.time + 0.2;
      camera.getWorldDirection(gaze.current);
      const activeIndex = runtime.states.findIndex((s) => s.phase === "active");
      runtime.history.push({
        time: runtime.time,
        position: [...runtime.player],
        velocity: [...runtime.velocity],
        gaze: gaze.current.toArray(),
        grounded,
        activeStructure: activeIndex < 0 ? null : sites[activeIndex].id,
      });
      if (runtime.history.length > 40) runtime.history.shift();
      const last = runtime.constellation.at(-1);
      if (
        runtime.grounded &&
        (!last || Math.hypot(next.x - last[0], next.z - last[2]) > 1.5)
      ) {
        runtime.constellation.push([next.x, next.y, next.z]);
        if (runtime.constellation.length > 320) runtime.constellation.shift();
      }
    }
  });
  useFrame((_, dt) => {
    if (useGame.getState().phase === "complete") {
      const view = finale.current;
      if (!view.started) {
        camera
          .getWorldDirection(view.look)
          .multiplyScalar(45)
          .add(camera.position);
        view.started = true;
      }
      const ease = useGame.getState().reducedMotion
        ? 1
        : 1 - Math.exp(-Math.min(dt, 0.05) * 0.8);
      camera.position.lerp(view.position, ease);
      view.look.lerp(view.target, ease);
      camera.lookAt(view.look);
      if (camera.position.distanceToSquared(view.position) > 0.001)
        invalidate();
      return;
    }
    const p = body.current?.translation();
    if (!p) return;
    const m = motion.current,
      reduced = useGame.getState().reducedMotion;
    m.cameraY +=
      (p.y + 0.65 - m.cameraY) * (1 - Math.exp(-20 * Math.min(dt, 0.1)));
    const bob =
      !reduced && runtime.grounded
        ? Math.sin(runtime.time * 10) *
          Math.min(0.012, Math.hypot(m.x, m.z) * 0.002)
        : 0;
    camera.position.set(p.x, m.cameraY + bob, p.z);
    rotation.current.set(input.pitch, input.yaw, 0);
    camera.quaternion.setFromEuler(rotation.current);
  });
  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders={false}
      position={SPAWN}
      enabledRotations={[false, false, false]}
    >
      <CapsuleCollider
        ref={collider}
        args={[PLAYER_HALF_HEIGHT, PLAYER_RADIUS]}
      />
    </RigidBody>
  );
}
