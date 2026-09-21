"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  AdditiveBlending,
  type Group,
} from "three";
import type { Runtime } from "./runtime";
import { useGame } from "./store";

const pointFragment = `void main(){float r=length(gl_PointCoord-.5);float a=exp(-r*r*20.)*smoothstep(.5,.25,r);gl_FragColor=vec4(vec3(1.,.83,.55),a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

/** A bounded celestial drawing made from the actual route taken in this run. */
export function Constellation({ runtime }: { runtime: Runtime }) {
  const night = useGame((s) => s.night),
    group = useRef<Group>(null);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(320 * 3), 3),
    );
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const line = useMemo(
    () =>
      new Line(
        geometry,
        new LineBasicMaterial({
          color: "#dabd83",
          transparent: true,
          opacity: 0.55,
          blending: AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      ),
    [geometry],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      line.material.dispose();
    },
    [geometry, line],
  );
  useFrame(({ camera }) => {
    // Like real constellations, this drawing lives in the sky rather than moving past the viewer.
    group.current?.position.set(camera.position.x, 0, camera.position.z);
    const positions = geometry.getAttribute("position");
    runtime.constellation.forEach((p, i) =>
      positions.setXYZ(
        i,
        -18 + p[0] * 2.5,
        36 + Math.sin(p[2] * 0.045) * 7 + p[1] * 0.4,
        -48 + p[2] * 0.18,
      ),
    );
    positions.needsUpdate = true;
    geometry.setDrawRange(0, runtime.constellation.length);
  });
  return (
    <group ref={group} visible={night}>
      <primitive object={line} frustumCulled={false} />
      <points geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          vertexShader="void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(650./-p.z,3.,10.);}"
          fragmentShader={pointFragment}
        />
      </points>
    </group>
  );
}

export function NightStars() {
  const night = useGame((s) => s.night);
  const geometry = useMemo(() => {
    const g = new BufferGeometry(),
      p = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) {
      const y = 0.06 + ((i + 0.5) / 1800) * 0.94,
        theta = i * 2.39996323,
        r = Math.sqrt(1 - y * y);
      p.set(
        [500 * r * Math.cos(theta), 500 * y, 500 * r * Math.sin(theta)],
        i * 3,
      );
    }
    g.setAttribute("position", new BufferAttribute(p, 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <points geometry={geometry} visible={night} frustumCulled={false}>
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        vertexShader="void main(){gl_Position=projectionMatrix*mat4(mat3(viewMatrix))*vec4(position,1.);gl_PointSize=2.2;}"
        fragmentShader="void main(){float r=length(gl_PointCoord-.5);gl_FragColor=vec4(.65,.77,1.,exp(-r*r*18.)*smoothstep(.5,.25,r)*.75);}"
      />
    </points>
  );
}
