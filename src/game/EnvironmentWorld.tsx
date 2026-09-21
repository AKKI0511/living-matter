"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Environment,
  Lightformer,
  MeshReflectorMaterial,
} from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import {
  BackSide,
  Color,
  ShaderMaterial,
  DirectionalLight,
  Object3D,
  type MeshStandardMaterial,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { islands } from "./world";
import { useGame } from "./store";
import { NightStars } from "./Constellation";

const stoneShader = (
  shader: Parameters<NonNullable<MeshStandardMaterial["onBeforeCompile"]>>[0],
) => {
  shader.vertexShader =
    "varying vec3 vStonePosition;\n" +
    shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\nvStonePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
  shader.fragmentShader =
    "varying vec3 vStonePosition;\n" +
    shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
    float grain = fract(sin(dot(floor(vStonePosition * 90.0), vec3(12.9898,78.233,42.21))) * 43758.5453);
    float strata = sin(vStonePosition.y * 0.9 + sin(vStonePosition.x * 0.12) * 2.0) * 0.008;
    diffuseColor.rgb *= 0.985 + grain * 0.025 + strata;
  `,
    );
};

function Stone({ dark = false }: { dark?: boolean }) {
  return (
    <meshStandardMaterial
      color={dark ? "#586f75" : "#d5cbb5"}
      roughness={0.84}
      metalness={0.03}
      onBeforeCompile={stoneShader}
    />
  );
}

function CutStone({ size }: { size: [number, number, number] }) {
  const geometry = useMemo(
    () => new RoundedBoxGeometry(...size, 2, 0.08),
    [size[0], size[1], size[2]],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive attach="geometry" object={geometry} />;
}

function Sunlight() {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const quality = useGame((s) => s.quality);
  const night = useGame((s) => s.night);
  useFrame(({ camera }) => {
    if (!light.current) return;
    light.current.position.set(
      camera.position.x - 32,
      42,
      camera.position.z - 100,
    );
    target.position.set(camera.position.x, 0, camera.position.z - 22);
    target.updateMatrixWorld();
  });
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        target={target}
        intensity={night ? 0.85 : 3.6}
        color={night ? "#9cbcff" : "#ffdeb1"}
        castShadow
        shadow-mapSize={[
          quality === "high" ? 2048 : 1024,
          quality === "high" ? 2048 : 1024,
        ]}
        shadow-camera-left={-38}
        shadow-camera-right={38}
        shadow-camera-top={44}
        shadow-camera-bottom={-44}
        shadow-camera-near={1}
        shadow-camera-far={150}
        shadow-normalBias={0.035}
        shadow-bias={-0.00008}
      />
    </>
  );
}

function Sky() {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: {
          night: { value: 0 },
          zenith: { value: new Color("#234a69") },
          horizon: { value: new Color("#e4cba4") },
        },
        vertexShader:
          "varying vec3 vDirection; void main(){ vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }",
        fragmentShader: `varying vec3 vDirection; uniform vec3 zenith; uniform vec3 horizon; uniform float night;
      void main(){ vec3 d=normalize(vDirection); float h=max(d.y,0.); vec3 c=mix(horizon,zenith,pow(h,.45));
      vec3 sun=normalize(vec3(-.34,.19,-1.)); float glow=pow(max(dot(d,sun),0.),60.); c+=vec3(.3,.19,.075)*glow;
      float disk=smoothstep(.99978,.99986,dot(d,sun)); c=mix(c,vec3(2.,1.65,1.12),disk); vec3 nocturne=mix(vec3(.023,.043,.085),vec3(.002,.006,.025),pow(h,.4));
      nocturne+=vec3(.75,.85,1.)*disk;
      gl_FragColor=vec4(mix(c,nocturne,night),1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, dt) => {
    const target = useGame.getState().night ? 1 : 0;
    material.uniforms.night.value +=
      (target - material.uniforms.night.value) *
      (useGame.getState().reducedMotion
        ? 1
        : 1 - Math.exp(-Math.min(dt, 0.1) * 3));
    if (Math.abs(target - material.uniforms.night.value) > 0.002) invalidate();
  });
  return (
    <mesh material={material}>
      <sphereGeometry args={[700, 32, 20]} />
    </mesh>
  );
}

function Water({ lake = false }: { lake?: boolean }) {
  const mat = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      night: { value: 0 },
      tint: { value: new Color(lake ? "#50767a" : "#244e5c") },
    }),
    [lake],
  );
  useFrame((_, dt) => {
    if (mat.current)
      mat.current.uniforms.night.value = useGame.getState().night ? 1 : 0;
    if (mat.current && useGame.getState().phase === "playing")
      mat.current.uniforms.time.value += Math.min(dt, 0.05);
  });
  const quality = useGame((s) => s.quality);
  const night = useGame((s) => s.night);
  if (lake && quality === "high")
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 5.14, -169]}>
        <planeGeometry args={[46, 30]} />
        <MeshReflectorMaterial
          resolution={512}
          blur={[180, 50]}
          mixBlur={0.8}
          mixStrength={1.1}
          roughness={0.32}
          depthScale={0.35}
          minDepthThreshold={0.3}
          maxDepthThreshold={1.2}
          color={night ? "#1b3449" : "#436b70"}
          metalness={0.6}
          mirror={0.65}
        />
      </mesh>
    );
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={lake ? [0, 5.14, -169] : [0, -3, -120]}
    >
      <planeGeometry args={lake ? [46, 30, 1, 1] : [1400, 1400, 1, 1]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={`varying vec3 vWorld; void main(){ vec4 world=modelMatrix*vec4(position,1.); vWorld=world.xyz; gl_Position=projectionMatrix*viewMatrix*world; }`}
        fragmentShader={`
      varying vec3 vWorld; uniform float time; uniform vec3 tint; uniform float night;
      void main(){ vec2 p=vWorld.xz; float wave=sin(p.x*1.8+p.y*.6+time*.8)*.35+sin(p.y*2.7-p.x*.5-time*.65)*.2+sin(p.x*5.+p.y*4.+time)*.08;
      vec3 view=normalize(cameraPosition-vWorld); float fresnel=pow(1.-max(view.y,0.),3.);
      vec3 col=mix(tint,vec3(.55,.65,.64),fresnel*.8); col+=wave*.023;
      float stripe=pow(max(0.,sin(p.y*3.+wave*3.+time*.2)),24.);
      float sun=exp(-pow((p.x+32.)/13.,2.)); col+=vec3(.55,.4,.18)*stripe*sun*.35;
      float fog=1.-exp(-length(cameraPosition-vWorld)*.003); col=mix(col,vec3(.55,.65,.65),fog);
      col=mix(col,col*vec3(.12,.2,.34),night);
      gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }
    `}
      />
    </mesh>
  );
}

function Landmark() {
  return (
    <group position={[0, 6, -207]}>
      <mesh position={[0, 16.5, -2]} castShadow receiveShadow>
        <torusGeometry args={[15.5, 1.1, 16, 128]} />
        <Stone />
      </mesh>
      <mesh position={[0, 16.5, -0.88]}>
        <torusGeometry args={[15.5, 0.055, 6, 160]} />
        <meshBasicMaterial color={[5, 3.3, 1.4]} />
      </mesh>
      <mesh position={[0, 16.5, -1.98]}>
        <torusGeometry args={[14.38, 0.065, 6, 160]} />
        <meshBasicMaterial color={[4, 2.8, 1.4]} />
      </mesh>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[-13.5, 4, -1.5]} castShadow receiveShadow>
          <CutStone size={[2, 8, 5]} />
          <Stone />
        </mesh>
        <mesh position={[13.5, 4, -1.5]} castShadow receiveShadow>
          <CutStone size={[2, 8, 5]} />
          <Stone />
        </mesh>
      </RigidBody>
      <mesh position={[0, 16.5, -2]}>
        <circleGeometry args={[14.35, 96]} />
        <shaderMaterial
          transparent
          depthWrite={false}
          vertexShader="varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}"
          fragmentShader="varying vec2 vUv; void main(){float edge=pow(length(vUv-.5)*2.,5.);gl_FragColor=vec4(1.,.8,.48,.035+edge*.12);}"
        />
      </mesh>
      <pointLight
        position={[0, 6, 2]}
        intensity={100}
        distance={23}
        color="#ffe0a4"
      />
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          position={[0, 0.012, 7 + i * 3.8]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[8 - i * 0.6, 0.05]} />
          <meshBasicMaterial color="#d6bd83" />
        </mesh>
      ))}
    </group>
  );
}

export function Atmosphere() {
  const night = useGame((s) => s.night);
  return (
    <>
      <Sky />
      <NightStars />
      <fog attach="fog" args={[night ? "#0b162a" : "#afc2c4", 45, 290]} />
      <ambientLight
        intensity={night ? 0.18 : 0.12}
        color={night ? "#6c91ca" : "#b3cad1"}
      />
      <hemisphereLight
        args={[night ? "#648ac9" : "#b3d2e2", "#454431", night ? 0.4 : 0.75]}
      />
      <Sunlight />
      <Environment
        resolution={128}
        frames={1}
        environmentIntensity={night ? 0.2 : 0.65}
      >
        <Lightformer
          form="rect"
          intensity={2.2}
          color="#bcd5df"
          scale={[100, 100, 1]}
          position={[0, 40, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={4}
          color="#ffe0b1"
          scale={[45, 45, 1]}
          position={[-30, 20, -40]}
          rotation={[0, 0.6, 0]}
        />
      </Environment>
    </>
  );
}

export function World() {
  return (
    <>
      <Water />
      <Water lake />
      {islands.map((island, i) => (
        <group key={i}>
          <RigidBody type="fixed" colliders={false}>
            <CuboidCollider
              args={[
                island.size[0] / 2,
                island.size[1] / 2,
                island.size[2] / 2,
              ]}
              position={island.position}
            />
            <mesh position={island.position} castShadow receiveShadow>
              <CutStone size={island.size} />
              <Stone />
            </mesh>
          </RigidBody>
          <mesh
            position={[
              0,
              island.position[1] - island.size[1] / 2 - 6,
              island.position[2],
            ]}
            receiveShadow
            castShadow
          >
            <boxGeometry
              args={[island.size[0] - 2.5, 12, island.size[2] - 3]}
            />
            <Stone dark />
          </mesh>
          {/* A shallow brass inlay quietly carries the eye forward. */}
          <mesh
            position={[
              0,
              island.position[1] + island.size[1] / 2 + 0.008,
              island.position[2],
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[0.035, island.size[2] - 6]} />
            <meshStandardMaterial
              color="#99896b"
              roughness={0.45}
              metalness={0.5}
            />
          </mesh>
          {[1, -1].map((side) => (
            <mesh
              key={side}
              position={[
                side * (island.size[0] / 2 - 0.35),
                island.position[1] + island.size[1] / 2 + 0.018,
                island.position[2],
              ]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[0.04, island.size[2] - 0.7]} />
              <meshStandardMaterial color="#a59f8c" />
            </mesh>
          ))}
        </group>
      ))}
      {/* Monumental fragments frame the route, with generous clear space around the player. */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[-7.8, 5.5, -9]} castShadow receiveShadow>
          <CutStone size={[1.8, 11, 2.5]} />
          <Stone />
        </mesh>
        <mesh position={[7.8, 5.5, -9]} castShadow receiveShadow>
          <CutStone size={[1.8, 11, 2.5]} />
          <Stone />
        </mesh>
        <mesh position={[-2, 10.6, -9]} castShadow>
          <CutStone size={[13.4, 1.5, 2.5]} />
          <Stone />
        </mesh>
        <mesh position={[6.8, 5, -57]} castShadow receiveShadow>
          <boxGeometry args={[1.6, 10, 9]} />
          <Stone />
        </mesh>
        <mesh position={[-7.8, 11, -97]} castShadow receiveShadow>
          <boxGeometry args={[1.5, 10, 14]} />
          <Stone />
        </mesh>
        <mesh position={[7, 10, -142]} castShadow receiveShadow>
          <boxGeometry args={[2, 8, 8]} />
          <Stone />
        </mesh>
      </RigidBody>
      {Array.from({ length: 10 }, (_, i) => {
        const side = i % 2 ? -1 : 1,
          z = 35 - i * 22.7,
          x = side * (42 + Math.sin(i * 6.2) * 14 + i * 0.8),
          height = 8 + (Math.sin(i * 32.8) + 1) * 19;
        return (
          <mesh
            key={i}
            position={[x, height / 2 - 9, z]}
            rotation={[0, Math.sin(i * 3) * 0.35, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[8 + (i % 5) * 3, height, 9 + (i % 3) * 4]} />
            <Stone dark={i % 3 === 0} />
          </mesh>
        );
      })}
      <group position={[-51, 7, -95]} rotation={[0.15, 0.45, -0.32]}>
        <mesh castShadow receiveShadow>
          <torusGeometry args={[18, 2.2, 8, 72, Math.PI * 1.65]} />
          <Stone dark />
        </mesh>
        <mesh position={[0, 0, 0.1]}>
          <torusGeometry args={[18, 2.24, 4, 72, Math.PI * 0.03]} />
          <meshStandardMaterial color="#b5a582" roughness={0.7} />
        </mesh>
      </group>
      <group position={[48, 13, -228]} rotation={[0, -0.65, 0.17]}>
        <mesh castShadow receiveShadow>
          <torusGeometry args={[24, 2.4, 8, 80, Math.PI * 1.35]} />
          <Stone dark />
        </mesh>
      </group>
      {Array.from({ length: 7 }, (_, i) => (
        <mesh
          key={`column-${i}`}
          position={[-21, 5, -119 - i * 7]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[0.9, 1.15, 24 - i * 1.5, 12]} />
          <Stone />
        </mesh>
      ))}
      <mesh position={[-125, 18, -270]} rotation={[0, -0.15, 0]}>
        <boxGeometry args={[130, 60, 35]} />
        <Stone dark />
      </mesh>
      <mesh position={[105, 5, -310]} rotation={[0, 0.25, 0]}>
        <boxGeometry args={[130, 70, 55]} />
        <Stone dark />
      </mesh>
      <Landmark />
    </>
  );
}
