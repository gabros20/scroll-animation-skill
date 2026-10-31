"use client";

/**
 * The antique camera in three dimensions, for /lab: what renders inside the
 * 3d skill's SceneCanvas (src/three/r3f/SceneCanvas.tsx). A lazy chunk of its
 * own: three, R3F and drei arrive with it, never with the page.
 *
 * The scene doesn't run a loop. LabScene's render bridge (render-bridge.ts)
 * calls the `draw` this hands back on the scroll authority's tick, only when
 * the pinned scene's progress moved; `draw` is R3F's advance(), and
 * ConductorDriver ticks the conductor inside it. The camera framing per
 * chapter is POSES, below: one pose per chapter, eased between neighbours
 * along the conductor's segment(). No camera-path library: five stops and a
 * lerp read better than a spline nobody can tune.
 */

import { useGLTF } from "@react-three/drei";
import { advance, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { Conductor, ConductorState } from "@/three/conductor";
import { ConductorDriver } from "@/three/r3f/SceneCanvas";

/** #f4f0e9, globals.css: the page's paper, so the frame meets the page with no edge. */
const PAPER = "#f4f0e9";
const MODEL = "/media/lab/antique-camera.glb";
/** Vertical field of view, degrees: the poster's long lens (media-src/render/shots/orbit.js). */
export const FOV = 22;

/**
 * One framing per chapter. `az` and `elev` (degrees) place the lens around
 * the aim point: az 0 looks along -z, and the model's lens points to +x, so
 * az 90 faces the lens. The azimuths only climb, so the scroll is one turn
 * around the object, never a swing back. `dist` is in object heights. `aim` is the point looked
 * at: x and z are offsets from the camera body's centre in object heights, y
 * is a height above the floor as a fraction of the object's. The last pose is
 * the poster's (az -40, elev 14, the whole object filling 0.84 of the frame),
 * so the scene ends on the picture the page opened with.
 */
type Pose = { az: number; elev: number; dist: number; aim: readonly [number, number, number] };

const POSES: Record<string, Pose> = {
  body: { az: -132, elev: 14, dist: 1.2, aim: [0, 0.87, 0] },
  bellows: { az: -68, elev: 8, dist: 1.15, aim: [0.02, 0.86, 0] },
  lens: { az: 28, elev: 5, dist: 0.9, aim: [0.08, 0.87, 0] },
  tripod: { az: 118, elev: 20, dist: 2.1, aim: [0, 0.42, 0] },
  whole: { az: 320, elev: 14, dist: 3.06, aim: [0, 0.47, 0] },
};

/** From 1024 px the chapter text sits in a left column: the subject moves right by this share of the frame. */
const WIDE_SHIFT = 0.16;

const deg = THREE.MathUtils.degToRad;
const lerp = THREE.MathUtils.lerp;
const ease = (t: number) => t * t * (3 - 2 * t);

/** The model's measurements, taken once it has loaded. */
type Frame = { height: number; floor: number; axis: THREE.Vector3; reach: number };

const target = new THREE.Vector3();

function placeCamera(camera: THREE.PerspectiveCamera, conductor: Conductor, frame: Frame, wide: boolean) {
  const { a, b, t } = conductor.segment("smooth");
  const from = POSES[conductor.chapters[a]?.id ?? ""];
  const to = POSES[conductor.chapters[b]?.id ?? ""] ?? from;
  if (!from || !to) return;
  const k = ease(t);
  const az = deg(lerp(from.az, to.az, k));
  const elev = deg(lerp(from.elev, to.elev, k));
  const dist = lerp(from.dist, to.dist, k) * frame.height;
  target.set(
    frame.axis.x + lerp(from.aim[0], to.aim[0], k) * frame.height,
    frame.floor + lerp(from.aim[1], to.aim[1], k) * frame.height,
    frame.axis.z + lerp(from.aim[2], to.aim[2], k) * frame.height,
  );
  camera.position.set(
    target.x + dist * Math.sin(az) * Math.cos(elev),
    target.y + dist * Math.sin(elev),
    target.z + dist * Math.cos(az) * Math.cos(elev),
  );
  camera.lookAt(target);
  // filmOffset slides the frustum sideways (no perspective change) by
  // near × offset / filmWidth, against a frustum 2 × near × tan(fov/2) × aspect
  // wide; negative moves the subject right.
  const share = wide ? WIDE_SHIFT : 0;
  const filmOffset = -share * camera.getFilmWidth() * 2 * Math.tan(deg(camera.fov) / 2) * camera.aspect;
  if (camera.filmOffset !== filmOffset) {
    camera.filmOffset = filmOffset;
    camera.updateProjectionMatrix();
  }
}

/** A warm paper studio for image-based light (media-src/render/studio.js, the renders' own): brass and glass reflect it. */
function paperStudio(renderer: THREE.WebGLRenderer) {
  const room = new THREE.Scene();
  const paper = new THREE.Color("#f5f1e8");
  const basic = (color: THREE.Color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  room.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: paper.clone().multiplyScalar(0.18), side: THREE.BackSide })));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 32), basic(paper.clone().multiplyScalar(0.22)));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -6;
  room.add(floor);
  const panel = (w: number, h: number, intensity: number, position: [number, number, number], tint = 0xffffff) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic(new THREE.Color(tint).multiplyScalar(intensity)));
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  panel(22, 14, 11, [-26, 24, 20], 0xfff6ea); // key softbox, a touch warm
  panel(16, 18, 3, [30, 6, 10], 0xf4f1ec); // fill
  panel(3, 30, 9, [10, 10, -32]); // rim strip behind
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.035).texture;
  pmrem.dispose();
  room.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      (node.material as THREE.Material).dispose();
    }
  });
  return texture;
}

/** A floor that only shows shadow, fading out between `inner` and `outer` from the axis so it never meets a frame edge. */
function shadowMaterial(center: THREE.Vector2, inner: number, outer: number) {
  const material = new THREE.ShadowMaterial({ color: 0x3b2f24, opacity: 0.3 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.catcherCenter = { value: center };
    shader.uniforms.catcherRadii = { value: new THREE.Vector2(inner, outer) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCatcherWorld;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n\tvCatcherWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec2 catcherCenter;\nuniform vec2 catcherRadii;\nvarying vec3 vCatcherWorld;")
      .replace(
        "gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );",
        "float catcherFade = 1.0 - smoothstep(catcherRadii.x, catcherRadii.y, distance(vCatcherWorld.xz, catcherCenter));\n\tgl_FragColor = vec4( color, opacity * catcherFade * ( 1.0 - getShadowMask() ) );",
      );
  };
  return material;
}

export type CameraStageProps = {
  conductor: Conductor;
  /** Hands LabScene the draw function once the model is compiled and posed (null on unmount). */
  attach: (draw: ((ms: number) => void) | null) => void;
  /** The canvas has presented a frame of the model (true), or is gone (false). */
  onDrawn: (drawn: boolean) => void;
  /** Called on every conductor tick, with the state the frame was drawn with (?motion-debug). */
  onTick?: (state: Readonly<ConductorState>) => void;
};

function Model({ conductor, attach, onDrawn, onTick }: CameraStageProps) {
  const { scene: model } = useGLTF(MODEL, false, true);
  // The renderer, scene and camera are R3F's to own: read them through get()
  // inside effects and callbacks, never mutate a value a hook returned.
  const get = useThree((s) => s.get);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const wide = width >= 1024;
  const root = useRef<THREE.Group>(null);
  const light = useRef<THREE.DirectionalLight>(null);

  const frame = useMemo<Frame>(() => {
    const bounds = new THREE.Box3().setFromObject(model);
    const body = new THREE.Box3().setFromObject(model.getObjectByName("camera") ?? model);
    const size = bounds.getSize(new THREE.Vector3());
    return {
      height: size.y,
      floor: bounds.min.y,
      axis: body.getCenter(new THREE.Vector3()),
      reach: Math.max(size.x, size.y, size.z) * 1.6,
    };
  }, [model]);

  const catcher = useMemo(
    () => shadowMaterial(new THREE.Vector2(frame.axis.x, frame.axis.z), frame.height * 0.3, frame.height * 0.56),
    [frame],
  );

  const pose = useCallback(
    () => placeCamera(get().camera as THREE.PerspectiveCamera, conductor, frame, wide),
    [get, conductor, frame, wide],
  );

  // Before any frame: shadows on and the studio light.
  useLayoutEffect(() => {
    const { gl, scene } = get();
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    root.current?.traverse((node) => {
      if (node instanceof THREE.Mesh) node.castShadow = true;
    });
    const env = paperStudio(gl);
    scene.environment = env;
    scene.environmentRotation.set(0, deg(-40), 0);
    const key = light.current;
    if (key) {
      const reach = frame.reach;
      Object.assign(key.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.5, far: reach * 6 });
      key.shadow.camera.updateProjectionMatrix();
      // The poster's key: upper left of its view, high enough that no shadow reaches a frame edge.
      const az = deg(-88);
      const el = deg(62);
      key.target.position.set(frame.axis.x, frame.floor + frame.height * 0.47, frame.axis.z);
      key.position
        .copy(key.target.position)
        .add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(reach * 3));
      key.target.updateMatrixWorld();
    }
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [get, frame]);

  useEffect(() => () => catcher.dispose(), [catcher]);

  // The pose the conductor holds now, also on every resize: a draw before
  // ConductorDriver subscribes must not show three's default camera.
  useLayoutEffect(() => {
    pose();
  }, [pose, width, height]);

  // Compile every program off the scroll path, then hand LabScene the draw.
  useEffect(() => {
    let live = true;
    let drawn = false;
    const { gl, scene, camera } = get();
    gl.compileAsync(scene, camera).then(
      () => {
        if (!live) return;
        attach((ms) => {
          advance(ms / 1000);
          if (!drawn) {
            drawn = true;
            onDrawn(true);
          }
        });
      },
      () => {},
    );
    return () => {
      live = false;
      attach(null);
      onDrawn(false);
    };
  }, [get, attach, onDrawn]);

  return (
    <>
      <group ref={root}>
        <primitive object={model} />
      </group>
      <mesh rotation-x={-Math.PI / 2} position-y={frame.floor} receiveShadow material={catcher}>
        <planeGeometry args={[400, 400]} />
      </mesh>
      <directionalLight
        ref={light}
        color={0xfff4e6}
        intensity={3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.015}
        shadow-radius={2}
      />
      <Suspense fallback={null}>
        <ConductorDriver
          conductor={conductor}
          onFrame={(state) => {
            pose();
            onTick?.(state);
          }}
        />
      </Suspense>
    </>
  );
}

export default function CameraStage(props: CameraStageProps): ReactNode {
  return (
    <>
      <color attach="background" args={[PAPER]} />
      <Suspense fallback={null}>
        <Model {...props} />
      </Suspense>
    </>
  );
}
