"use client";
import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { BackSide, BufferAttribute, BufferGeometry, Color, DirectionalLight, InstancedMesh, MeshStandardMaterial, Object3D, ShaderMaterial, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { walkableGround, islands, WATER_LEVEL, architectureBoxes, columns, distantFragments, MONUMENT, type StructureBox, type Vec3 } from "./world";
import { useGame } from "./store";
import { QUALITY } from "./quality";
import { Moon, NightStars } from "./SkyFeatures";

const stoneShader: MeshStandardMaterial["onBeforeCompile"] = shader => {
  shader.vertexShader = "varying vec3 vStonePosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
    vec4 stonePosition=vec4(transformed,1.);
    #ifdef USE_INSTANCING
      stonePosition=instanceMatrix*stonePosition;
    #endif
    vStonePosition=(modelMatrix*stonePosition).xyz;`);
  shader.fragmentShader = "varying vec3 vStonePosition;\n" + shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
    float strata=sin(vStonePosition.y*2.8+sin(vStonePosition.x*.2)*.6)*.018;
    vec2 footprint=fwidth(vStonePosition.xz)*vec2(26.,24.);
    float pores=sin(vStonePosition.x*26.)*sin(vStonePosition.z*24.)*.009*
      (1.-smoothstep(.5,2.,max(footprint.x,footprint.y)));
    diffuseColor.rgb*=.985+strata+pores;`);
};

/** A bevelled rectangular cap above irregular, tapered masonry foundations. */
function foundationGeometry() {
  const g = new BufferGeometry(), vertices: number[] = [];
  const outline = [[-.5,-.46],[-.46,-.5],[.46,-.5],[.5,-.46],[.5,.46],[.46,.5],[-.46,.5],[-.5,.46]];
  const levels = [[0,1],[-.25,.94],[-.32,1],[-.73,.86],[-.8,.89],[-1,.7]];
  for (let tier=0;tier<levels.length-1;tier++) for(let i=0;i<8;i++) {
    const next=(i+1)%8;
    const p=(level:number,corner:number) => [outline[corner][0]*levels[level][1],levels[level][0],outline[corner][1]*levels[level][1]];
    vertices.push(...p(tier,i),...p(tier+1,i),...p(tier,next),...p(tier,next),...p(tier+1,i),...p(tier+1,next));
  }
  g.setAttribute("position", new BufferAttribute(new Float32Array(vertices),3)); g.computeVertexNormals(); return g;
}

function Boxes({ boxes, material, shadows = true }: { boxes: readonly StructureBox[]; material: MeshStandardMaterial; shadows?: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  useEffect(() => {
    const transform=new Object3D();
    boxes.forEach((box,i) => { transform.position.set(...box.position); transform.scale.set(...box.size); transform.rotation.set(...(box.rotation ?? [0,0,0])); transform.updateMatrix(); mesh.current!.setMatrixAt(i,transform.matrix); });
    mesh.current!.instanceMatrix.needsUpdate=true; mesh.current!.computeBoundingSphere();
  }, [boxes]);
  return <instancedMesh ref={mesh} args={[undefined, material, boxes.length]} castShadow={shadows} receiveShadow><boxGeometry /></instancedMesh>;
}

function Sunlight() {
  const light = useRef<DirectionalLight>(null), target = useMemo(() => new Object3D(), []);
  const basis = useMemo(() => {
    const direction = new Vector3(-32,62,-60).normalize();
    const right = new Vector3(0,1,0).cross(direction).normalize();
    return { right, up: direction.clone().cross(right).normalize(), center: new Vector3() };
  }, []);
  const quality = useGame(s => s.renderQuality), night = useGame(s => s.night);
  useFrame(({ camera }) => {
    if (!light.current) return;
    // Shadow texels live in light space, not world X/Z. Snap both projected
    // axes so the same surface keeps its shadow samples while the player moves.
    const texel=76/QUALITY.high.shadowSize, {center,right,up}=basis;
    center.set(camera.position.x,6,camera.position.z-16);
    const x=center.dot(right), y=center.dot(up);
    center.addScaledVector(right,Math.round(x/texel)*texel-x);
    center.addScaledVector(up,Math.round(y/texel)*texel-y);
    target.position.copy(center); target.updateMatrixWorld();
    light.current.position.set(center.x-32,center.y+62,center.z-60);
  });
  return <><primitive object={target} /><directionalLight ref={light} target={target} intensity={night ? 1.1 : 3.1} color={night ? "#a9c9eb" : "#fff0d3"} castShadow={quality === "high"} shadow-mapSize={[2048,2048]} shadow-camera-left={-38} shadow-camera-right={38} shadow-camera-top={38} shadow-camera-bottom={-38} shadow-camera-near={1} shadow-camera-far={160} shadow-normalBias={0.035} shadow-bias={-0.00008} /></>;
}

function Sky() {
  const invalidate=useThree(s => s.invalidate);
  const material=useMemo(() => new ShaderMaterial({ side:BackSide, depthWrite:false, uniforms:{night:{value:0}, zenith:{value:new Color("#5a929e")}, horizon:{value:new Color("#d5dbcf")}},
    vertexShader:"varying vec3 vDirection; void main(){vDirection=position;vec4 p=projectionMatrix*mat4(mat3(viewMatrix))*vec4(position,1.);gl_Position=p.xyww;}",
    fragmentShader:`varying vec3 vDirection;uniform vec3 zenith;uniform vec3 horizon;uniform float night;
      void main(){vec3 d=normalize(vDirection);float h=max(d.y,0.);vec3 c=mix(horizon,zenith,pow(h,.5));
      vec3 sun=normalize(vec3(-32.,62.,-60.));float glow=pow(max(dot(d,sun),0.),38.);c+=vec3(.23,.16,.07)*glow;
      vec3 nocturne=mix(vec3(.06,.11,.16),vec3(.007,.016,.037),pow(h,.5));
      gl_FragColor=vec4(mix(c,nocturne,night),1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }` }), []);
  useEffect(() => () => material.dispose(),[material]);
  useFrame((_,dt) => {
    const target=useGame.getState().night ? 1:0;
    material.uniforms.night.value+=(target-material.uniforms.night.value)*(useGame.getState().reducedMotion?1:1-Math.exp(-Math.min(dt,.1)*3));
    if(Math.abs(target-material.uniforms.night.value)>.002)invalidate();
  });
  return <mesh material={material} renderOrder={-10}><sphereGeometry args={[700,32,20]} /></mesh>;
}

/** Both presets use the same animated normals, Fresnel response and sky reflection. */
function Water() {
  const material=useRef<ShaderMaterial>(null), quality=useGame(s=>s.renderQuality);
  const uniforms=useMemo(() => ({time:{value:0},night:{value:0},detail:{value:QUALITY.low.waterDetail}}),[]);
  useFrame((_,dt) => {
    if(!material.current)return;
    material.current.uniforms.night.value=useGame.getState().night?1:0;
    if(useGame.getState().phase==="playing")material.current.uniforms.time.value+=Math.min(dt,.05);
    material.current.uniforms.detail.value=QUALITY[quality].waterDetail;
  });
  return <mesh rotation={[-Math.PI/2,0,0]} position={[0,WATER_LEVEL,-120]} receiveShadow>
    <planeGeometry args={[1600,1600]} />
    <shaderMaterial ref={material} uniforms={uniforms} vertexShader="varying vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}"
      fragmentShader={`varying vec3 vWorld;uniform float time;uniform float night;uniform float detail;
      void main(){vec2 p=vWorld.xz;
        float a=dot(p,vec2(.48,.32))+time*.48;float b=dot(p,vec2(-.27,.62))-time*.36;
        float c=dot(p,vec2(2.1,1.5))+time*.65;
        vec2 slope=cos(a)*vec2(.48,.32)*.028+cos(b)*vec2(-.27,.62)*.024+cos(c)*vec2(2.1,1.5)*.004*detail;
        vec3 normal=normalize(vec3(-slope.x,1.,-slope.y));vec3 view=normalize(cameraPosition-vWorld);
        vec3 reflected=reflect(-view,normal);float fresnel=.025+.72*pow(1.-max(dot(normal,view),0.),4.);
        vec3 skyDay=mix(vec3(.17,.30,.29),vec3(.08,.20,.25),pow(max(reflected.y,0.),.5));
        vec3 skyNight=mix(vec3(.065,.115,.16),vec3(.012,.028,.06),pow(max(reflected.y,0.),.5));
        vec3 deep=mix(vec3(.018,.115,.125),vec3(.008,.034,.051),night);
        vec3 col=mix(deep,mix(skyDay,skyNight,night),fresnel);
        vec3 sun=normalize(vec3(-32.,62.,-60.));float light=pow(max(dot(reflected,sun),0.),140.);
        col+=mix(vec3(1.1,.88,.54),vec3(.32,.48,.68),night)*light*.85;
        float distance=length(cameraPosition-vWorld);float haze=1.-exp(-distance*.0018);
        col=mix(col,mix(vec3(.45,.55,.53),vec3(.048,.084,.125),night),haze);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`} />
  </mesh>;
}

function GroundDetail({ stone, brass }: { stone: MeshStandardMaterial; brass: MeshStandardMaterial }) {
  const seams=useMemo(() => walkableGround.flatMap(b => {
    const y=b.position[1]+b.size[1]/2+.012;
    return [...Array.from({length:Math.floor(b.size[2]/4)-1},(_,j)=>({position:[b.position[0],y,b.position[2]-b.size[2]/2+(j+1)*4] as Vec3,size:[b.size[0]-.3,.008,.018] as Vec3})),
      ...[-1,1].map(side=>({position:[b.position[0]+side*(b.size[0]/2-.24),y,b.position[2]] as Vec3,size:[.028,.008,b.size[2]-.48] as Vec3}))];
  }),[]);
  const inlays=useMemo(() => islands.map((b,i)=>({position:[b.position[0],b.position[1]+b.size[1]/2+.017,b.position[2]] as Vec3,size:[.03,.01,b.size[2]-7] as Vec3})),[]);
  const surveyMarks=useMemo(() => Array.from({length:12},(_,i)=>({
    position:[-5+Math.sin(i*Math.PI/6)*1.65,.021,-22.8+Math.cos(i*Math.PI/6)*1.65] as Vec3,
    size:[.025,.002,i%3===0?.3:.13] as Vec3, rotation:[0,i*Math.PI/6,0] as Vec3,
  })),[]);
  return <><Boxes boxes={seams} material={stone} shadows={false} /><Boxes boxes={inlays} material={brass} shadows={false} />
    <Boxes boxes={surveyMarks} material={brass} shadows={false} />
    {/* Flush survey marks belong to the arrival terrace's existing stone surface. */}
    <group position={[-5, .021, -22.8]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh material={brass}><ringGeometry args={[1.88, 1.9, 64]} /></mesh>
      <mesh material={stone}><ringGeometry args={[2.11, 2.14, 64]} /></mesh>
    </group>
  </>;
}

function Reeds() {
  const mesh=useRef<InstancedMesh>(null);
  useEffect(() => {
    const o=new Object3D();
    for(let i=0;i<48;i++) {
      const side=i<24?-1:1, n=i%24;
      o.position.set(-12+side*8.8+Math.sin(i*13)*.25,6.2+(i%5)*.05,-139-n*.42);
      o.scale.set(.022,.36+(i%7)*.055,.022);o.rotation.set(Math.sin(i)*.18,0,Math.cos(i)*.16);o.updateMatrix();mesh.current!.setMatrixAt(i,o.matrix);
    } mesh.current!.instanceMatrix.needsUpdate=true;mesh.current!.computeBoundingSphere();
  },[]);
  return <instancedMesh ref={mesh} args={[undefined,undefined,48]}><coneGeometry args={[1,1,3]} /><meshStandardMaterial color="#657b65" roughness={1} /></instancedMesh>;
}

function Scenery({ dark, stone }: { dark: MeshStandardMaterial; stone: MeshStandardMaterial }) {
  const cliffs=useRef<InstancedMesh>(null);
  const ruins=useMemo(() => Array.from({length:12},(_,i)=>({position:[-110+i*9,13+Math.sin(i*.8)*4,-282] as Vec3,size:[2.2,25,3.2] as Vec3})),[]);
  // A submerged meridian hall grounds the large ring in architecture. Its
  // nearest surface is beyond the playable/matter bounds, with no approach.
  const hall=useMemo(() => Array.from({length:9},(_,i) => {
    const angle=-Math.PI*.78+i*Math.PI*.18, x=-87+Math.cos(angle)*25, z=-124+Math.sin(angle)*19;
    const height=[17,22,27,24,19,23,26,18,13][i];
    return [
      {position:[x,-7+height/2,z] as Vec3,size:[2.6,height,2.6] as Vec3},
      {position:[x,-7+height-.5,z] as Vec3,size:[4.2,1.2,3.8] as Vec3},
      ...(i>1&&i<7?[{position:[x,-7+height+1,z] as Vec3,size:[7.4,1.3,3.1] as Vec3,rotation:[0,-angle,0] as Vec3}]:[]),
    ];
  }).flat(),[]);
  useEffect(() => {
    const o=new Object3D(), color=new Color();
    for(let i=0;i<32;i++) {
      const side=i%2?-1:1,z=70-Math.floor(i/2)*30;
      o.position.set(side*(170+Math.sin(i*2.4)*24),-19,z);
      o.scale.set(33+(i%4)*6,39+(i%5)*8,34+(i%3)*7);
      o.rotation.set(0,i*.7,.05*Math.sin(i));o.updateMatrix();cliffs.current!.setMatrixAt(i,o.matrix);
      color.set(i%3===0?"#697f7d":"#82928a");cliffs.current!.setColorAt(i,color);
    } cliffs.current!.instanceMatrix.needsUpdate=true;cliffs.current!.computeBoundingSphere();
  },[]);
  return <group>
    <instancedMesh ref={cliffs} args={[undefined,undefined,32]}><dodecahedronGeometry args={[1,1]} /><meshStandardMaterial roughness={1} flatShading /></instancedMesh>
    <Boxes boxes={ruins} material={dark} shadows={false} />
    <Boxes boxes={hall} material={stone} shadows={false} />
    <mesh position={[-87,-5,-124]} material={dark}><cylinderGeometry args={[28,32,8,48]} /></mesh>
    <mesh position={[-87,-1.1,-124]} material={stone}><cylinderGeometry args={[27,28,.6,48]} /></mesh>
    <mesh position={[-60,26,-284]} material={dark}><boxGeometry args={[115,3,6]} /></mesh>
    <mesh position={[-87,12,-118]} rotation={[0,.5,-.25]} material={stone}><torusGeometry args={[23,1.9,8,72,Math.PI*1.65]} /></mesh>
    <mesh position={[86,23,-233]} rotation={[0,-.5,.13]} material={dark}><torusGeometry args={[32,2.2,8,80,Math.PI*1.3]} /></mesh>
    <mesh position={[-93,-1,-123]} material={dark}><cylinderGeometry args={[14,21,20,12]} /></mesh>
    <mesh position={[92,0,-239]} material={dark}><cylinderGeometry args={[19,26,35,12]} /></mesh>
  </group>;
}

function Landmark({ stone, brass }: { stone: MeshStandardMaterial; brass: MeshStandardMaterial }) {
  const night=useGame(s=>s.night);
  return <>
    <RigidBody type="fixed" colliders="trimesh"><mesh position={MONUMENT.position} material={stone} castShadow receiveShadow><torusGeometry args={[MONUMENT.radius,MONUMENT.tube,12,96]} /></mesh></RigidBody>
    <mesh position={[10,22.5,-209.88]} material={brass}><torusGeometry args={[MONUMENT.radius,.045,6,96]} /></mesh>
    <mesh position={[10,6.025,-203]} rotation={[-Math.PI/2,0,0]} material={brass}><ringGeometry args={[5.9,6,64]} /></mesh>
    <mesh position={[10,22.5,-211]}><sphereGeometry args={[.32,16,12]} /><meshStandardMaterial color="#f4e5b4" emissive="#e4c784" emissiveIntensity={night?1.2:.2} /></mesh>
    <pointLight position={[10,11,-207]} color="#ffe4b3" intensity={night?60:12} distance={19} />
  </>;
}

export const Atmosphere = memo(function Atmosphere() {
  const night=useGame(s=>s.night);
  const reflections = useMemo(() => <>
    <Lightformer form="rect" intensity={1.6} color="#c0d7dd" scale={[100,100,1]} position={[0,40,0]} rotation={[Math.PI/2,0,0]} />
    <Lightformer form="rect" intensity={3} color="#fff0d3" scale={[45,45,1]} position={[-30,40,-60]} rotation={[0,.6,0]} />
  </>, []);
  return <>
    <Sky /><NightStars /><Moon />
    <fog attach="fog" args={[night?"#182d40":"#b1c2bc",110,510]} />
    <ambientLight intensity={night?.3:.12} color={night?"#7796b7":"#c5d6d3"} />
    <hemisphereLight args={[night?"#9aaec9":"#deebe1",night?"#394945":"#9a8d72",night?.8:.72]} />
    <Sunlight />
    <Environment resolution={128} frames={1} environmentIntensity={night?.3:.6}>
      {reflections}
    </Environment>
  </>;
});

export function World() {
  const materials=useMemo(() => {
    const stone=new MeshStandardMaterial({color:"#d8d0bc",roughness:.86,metalness:.02});stone.onBeforeCompile=stoneShader;
    const dark=new MeshStandardMaterial({color:"#71817d",roughness:1});dark.onBeforeCompile=stoneShader;
    const seams=new MeshStandardMaterial({color:"#9d9a89",roughness:1});
    const brass=new MeshStandardMaterial({color:"#b5a274",roughness:.5,metalness:.48});
    return {stone,dark,seams,brass};
  },[]);
  const foundation=useMemo(foundationGeometry,[]), cap=useMemo(()=>new RoundedBoxGeometry(1,1,1,1,.012),[]);
  useEffect(()=>()=>{Object.values(materials).forEach(m=>m.dispose());foundation.dispose();cap.dispose();},[materials,foundation,cap]);
  return <>
    <Water />
    <RigidBody type="fixed" colliders={false}>
      {walkableGround.map((b,i)=><CuboidCollider key={`ground-${i}`} args={[b.size[0]/2,b.size[1]/2,b.size[2]/2]} position={b.position} />)}
      {architectureBoxes.map((b,i)=><CuboidCollider key={`architecture-${i}`} args={[b.size[0]/2,b.size[1]/2,b.size[2]/2]} position={b.position} />)}
      {distantFragments.map((b,i)=><CuboidCollider key={`fragment-${i}`} args={[b.size[0]/2,b.size[1]/2,b.size[2]/2]} position={b.position} rotation={b.rotation} />)}
    </RigidBody>
    {walkableGround.map((b,i)=>{const top=b.position[1]+b.size[1]/2;return <group key={i}>
      <mesh geometry={cap} material={materials.stone} position={[b.position[0],top-.18,b.position[2]]} scale={[b.size[0],.36,b.size[2]]} castShadow receiveShadow />
      <mesh geometry={foundation} material={materials.dark} position={[b.position[0],top-.36,b.position[2]]} scale={[b.size[0],Math.max(10,b.size[1]+4),b.size[2]]} receiveShadow />
    </group>})}
    <Boxes boxes={architectureBoxes} material={materials.stone} />
    {columns.map((c,i)=><RigidBody key={i} type="fixed" colliders="hull"><mesh position={c.position} material={materials.stone} castShadow receiveShadow><cylinderGeometry args={[c.topRadius,c.bottomRadius,c.height,12]} /></mesh></RigidBody>)}
    <GroundDetail stone={materials.seams} brass={materials.brass} /><Reeds /><Scenery dark={materials.dark} stone={materials.stone} /><Landmark stone={materials.stone} brass={materials.brass} />
  </>;
}
