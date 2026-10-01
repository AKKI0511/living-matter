"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, type Group } from "three";
import { useGame } from "./store";

/** Real sphere silhouettes in a stable sky position, with normal depth occlusion. */
export function Moon() {
  const group=useRef<Group>(null), night=useGame(s=>s.night);
  const material=useMemo(() => new ShaderMaterial({
    uniforms: { body: { value: new Color() }, rim: { value: new Color() } },
    vertexShader: "varying vec3 vNormal;varying vec3 vView;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=-p.xyz;gl_Position=projectionMatrix*p;}",
    fragmentShader: `varying vec3 vNormal;varying vec3 vView;uniform vec3 body;uniform vec3 rim;
      void main(){float edge=1.-max(dot(normalize(vNormal),normalize(vView)),0.);
      gl_FragColor=vec4(mix(body,rim,smoothstep(.87,1.,edge)*.65),1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  }),[]);
  useEffect(() => {
    material.uniforms.body.value.set(night?"#0b192b":"#5a777d");
    material.uniforms.rim.value.set(night?"#45637b":"#a3b3aa");
  },[material,night]);
  useEffect(() => () => material.dispose(),[material]);
  useFrame(({camera}) => { group.current?.position.set(camera.position.x-155,camera.position.y+160,camera.position.z-470); });
  return <group ref={group}>
    <mesh material={material}><sphereGeometry args={[23.5,64,48]} /></mesh>
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
