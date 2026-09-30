"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, type Group } from "three";
import { useGame } from "./store";

/** Real sphere silhouettes in a stable sky position, with normal depth occlusion. */
export function Moon() {
  const group=useRef<Group>(null), night=useGame(s=>s.night);
  useFrame(({camera}) => { group.current?.position.set(camera.position.x-155,camera.position.y+160,camera.position.z-470); });
  return <group ref={group}>
    <mesh><sphereGeometry args={[23.5,48,32]} /><meshBasicMaterial color={night?"#45637b":"#a3b3aa"} /></mesh>
    <mesh position={[1.5,.5,1.9]}><sphereGeometry args={[23.1,48,32]} /><meshBasicMaterial color={night?"#0b192b":"#5a777d"} /></mesh>
  </group>;
}

export function NightStars() {
  const night=useGame(s=>s.night);
  const geometry=useMemo(()=>{
    const g=new BufferGeometry(),p=new Float32Array(520*3);
    for(let i=0;i<520;i++){const y=.12+(i+.5)/520*.88,theta=i*2.39996323,r=Math.sqrt(1-y*y);p.set([550*r*Math.cos(theta),550*y,550*r*Math.sin(theta)],i*3);}
    g.setAttribute("position",new BufferAttribute(p,3));return g;
  },[]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <points geometry={geometry} visible={night} frustumCulled={false}>
    <shaderMaterial transparent depthWrite={false} blending={AdditiveBlending} vertexShader="void main(){gl_Position=projectionMatrix*mat4(mat3(viewMatrix))*vec4(position,1.);gl_PointSize=1.5;}"
      fragmentShader={`void main(){float r=length(gl_PointCoord-.5);gl_FragColor=vec4(.55,.65,.8,exp(-r*r*20.)*smoothstep(.5,.25,r)*.55);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`} />
  </points>;
}
