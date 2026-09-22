"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Mesh, ShaderMaterial, Vector3 } from "three";
import { useGame } from "./store";

/** A single sky quad: warped accretion light, a breathing photon ring and an opaque horizon. */
export function BlackHole() {
  const mesh = useRef<Mesh>(null);
  const direction = useMemo(() => new Vector3(-0.38, 0.48, -1).normalize(), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        uniforms: { time: { value: 0 }, night: { value: 0 } },
        vertexShader: `varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec2 vUv; uniform float time; uniform float night;
      float band(float d,float w){return exp(-d*d/w);}
      void main(){
        vec2 p=(vUv-.5)*2.; p=mat2(.97,-.24,.24,.97)*p;
        float r=length(p), a=atan(p.y,p.x);
        float pulse=1.+.012*sin(time*.38);
        float horizon=.255*pulse;
        float ring=band(r-horizon-.018,.00013);
        float halo=band(r-.30,.009)*.25;
        vec2 disk=vec2(p.x,p.y*4.3);
        float dr=length(disk), da=atan(disk.y,disk.x);
        float flow=.65+.18*sin(da*11.-time*.8+dr*35.)+.12*sin(da*23.+time*.4-dr*60.);
        float accretion=smoothstep(.26,.33,dr)*(1.-smoothstep(.48,.91,dr))*flow;
        // Light from the far side bends over the shadow instead of crossing it.
        float lens=band(length(vec2(p.x,p.y*.82))-.34,.0005)*smoothstep(-.05,.15,p.y);
        float intensity=ring*1.8+halo+accretion*1.15+lens*.6;
        vec3 warm=mix(vec3(.95,.57,.22),vec3(1.,.88,.62),clamp(intensity*.65,0.,1.));
        vec3 color=warm*intensity*(.85+night*.3);
        float shadow=1.-smoothstep(horizon-.006,horizon+.002,r);
        color=mix(color,vec3(.002,.004,.008),shadow);
        float alpha=max(shadow,clamp(intensity,0.,1.))*(1.-smoothstep(.94,1.,r));
        if(alpha<.003)discard;
        gl_FragColor=vec4(color,alpha);
      }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera, clock }, dt) => {
    if (!mesh.current) return;
    mesh.current.position.copy(camera.position).addScaledVector(direction, 420);
    mesh.current.quaternion.copy(camera.quaternion);
    material.uniforms.time.value = useGame.getState().reducedMotion
      ? 0
      : clock.elapsedTime;
    material.uniforms.night.value +=
      ((useGame.getState().night ? 1 : 0) - material.uniforms.night.value) *
      Math.min(1, dt * 1.5);
  });
  return (
    <mesh ref={mesh} material={material} renderOrder={-1} frustumCulled={false}>
      <planeGeometry args={[240, 240]} />
    </mesh>
  );
}
