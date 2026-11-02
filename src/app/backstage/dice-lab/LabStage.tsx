"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from "@react-three/drei";
import * as THREE from "three";
import { DieBody } from "@/v2/components/dice/dice3d/Die";
import { faceTexture, type DieSpec } from "./labDice";
import type { DropShadow, Layout, Show } from "./labLayout";
import { diceSvg, type SvgOpts } from "./labSvg";
import { DIE_HALF, type ThrowParams } from "./labPhysics";
import {
  LabRig,
  type ExportOpts,
  type SavedPose,
  type SettleMode,
} from "./labRig";

// The 3D half of the dice lab: a transparent R3F canvas with the hero's dice,
// lights and materials, where dice can be rolled (Rapier), dragged, nudged and
// rendered out to a PNG at any resolution. The page (DiceLab.tsx) drives it
// through the StageHandle it receives via `onHandle`.

export type { ExportOpts };
export type StageHandle = {
  roll(params: ThrowParams): Promise<void>;
  squareUp(): void;
  upright(facing?: "blue" | "orange"): void;
  reorder(): void;
  rotateDie(i: number, axis: "x" | "y" | "z", deg: number): void;
  arrange(): void;
  getPoses(): SavedPose[];
  resetCamera(view: CameraView): void;
  exportPng(opts: ExportOpts): Promise<Blob>;
  exportSvg(opts: SvgOpts): string;
};

export type CameraView = "default" | "front";
const CAM_POS = new THREE.Vector3(0, 8, 60);
const CAM_DIST = CAM_POS.length();
const CAM_VIEWS: Record<CameraView, THREE.Vector3> = {
  default: CAM_POS, // slightly above, like the hero
  front: new THREE.Vector3(0, 0, CAM_DIST), // dead-on
};
const MAX_EXPORT = 8192;

type Props = {
  dice: DieSpec[];
  ortho: boolean;
  fov: number;
  shadows: boolean;
  shadow: DropShadow;
  grid: boolean;
  settle: SettleMode;
  keepOrder: boolean;
  layout: Layout;
  // saved poses (browser storage or a settings file); applied whenever a new
  // set arrives, after the layout
  poses: SavedPose[] | null;
  // the dice came to rest after moving: hand them back for saving
  onPoses: (poses: SavedPose[]) => void;
  // when set, outline the crop the export would make (dice bbox + padding)
  frame: { pad: number; exportW: number } | null;
  arena: { w: number; d: number };
  selected: number | null;
  onSelect: (i: number | null) => void;
  onHandle: (h: StageHandle) => void;
};

export default function LabStage(props: Props) {
  const { dice, settle, keepOrder, layout, onHandle, onPoses } = props;
  const [rig] = useState(() => new LabRig());

  const n = dice.length;
  useEffect(() => rig.resize(n), [n, rig]);
  // Re-lay the dice out whenever the layout or which faces show changes.
  // On load the saved poses (next effect) then overwrite that.
  const shows = dice.map((d) => d.show).join(",");
  useEffect(() => {
    rig.setLayout(shows.split(",") as Show[], layout);
  }, [shows, layout, rig]);
  const { poses } = props;
  useEffect(() => {
    if (poses) rig.setPoses(poses);
  }, [poses, rig]);
  useEffect(() => {
    rig.setSettleMode(settle);
  }, [settle, rig]);
  useEffect(() => {
    rig.setKeepOrder(keepOrder);
  }, [keepOrder, rig]);
  useEffect(() => {
    rig.setOnChange(() => onPoses(rig.getPoses()));
    return () => rig.setOnChange(null);
  }, [onPoses, rig]);

  useEffect(() => {
    onHandle({
      roll: (params) => rig.roll(params),
      squareUp: () => rig.squareUp(),
      upright: (facing) => rig.upright(facing),
      reorder: () => rig.reorder(),
      rotateDie: (i, axis, deg) => rig.rotateDie(i, axis, deg),
      arrange: () => rig.arrange(),
      getPoses: () => rig.getPoses(),
      resetCamera: (view) => rig.resetCamera(view),
      exportPng: (opts) => rig.exportPng(opts),
      exportSvg: (opts) => rig.exportSvg(opts),
    });
  }, [rig, onHandle]);

  useEffect(() => () => rig.dispose(), [rig]);

  const frameEl = useRef<HTMLDivElement>(null);
  const placeFrame = useCallback(
    (x: number, y: number, w: number, h: number) => {
      const box = frameEl.current;
      if (!box) return;
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    },
    [],
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.NeutralToneMapping,
        }}
        style={{ width: "100%", height: "100%", background: "transparent" }}
        onPointerMissed={() => props.onSelect(null)}
      >
        <Scene {...props} rig={rig} />
        {props.frame && (
          <FrameBox rig={rig} frame={props.frame} onBox={placeFrame} />
        )}
      </Canvas>
      {props.frame && (
        <div
          ref={frameEl}
          className="pointer-events-none absolute border border-dashed border-sky-400 bg-sky-400/5"
        />
      )}
    </div>
  );
}

// Projects every die's corners to find the screen-space bounding box, then
// grows it by the export padding scaled from export pixels to canvas pixels.
function FrameBox({
  rig,
  frame,
  onBox,
}: {
  rig: LabRig;
  frame: { pad: number; exportW: number };
  onBox: (x: number, y: number, w: number, h: number) => void;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const pose of rig.poses) {
      for (let k = 0; k < 8; k++) {
        v.set(
          k & 1 ? DIE_HALF : -DIE_HALF,
          k & 2 ? DIE_HALF : -DIE_HALF,
          k & 4 ? DIE_HALF : -DIE_HALF,
        )
          .applyQuaternion(pose.q)
          .add(pose.p)
          .project(camera);
        const x = ((v.x + 1) / 2) * size.width;
        const y = ((1 - v.y) / 2) * size.height;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (!Number.isFinite(x0)) return;
    const pad = (frame.pad * size.width) / frame.exportW;
    onBox(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
  });
  return null;
}

function Scene({
  dice,
  ortho,
  fov,
  shadows,
  shadow,
  grid,
  arena,
  selected,
  onSelect,
  rig,
}: Omit<Props, "frame" | "poses" | "onPoses"> & { rig: LabRig }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { gl, camera, size } = useThree();
  const get = useThree((s) => s.get);

  // Ortho zoom that frames the same world height the perspective camera does.
  const orthoZoom =
    size.height / (2 * CAM_DIST * Math.tan(THREE.MathUtils.degToRad(fov) / 2));

  useEffect(() => {
    rig.setResetCamera((view) => {
      get().camera.position.copy(CAM_VIEWS[view]);
      controls.current?.target.set(0, 0, 0);
      controls.current?.update();
    });
    return () => {
      rig.setResetCamera(null);
    };
  }, [get, rig]);

  // Physics + square-up ticking, ahead of the dice's own pose reads.
  useFrame((_, dt) => rig.tick(dt), -1);

  // Drag a die across its own height plane; orbit controls pause meanwhile.
  const beginDrag = useCallback(
    (i: number) => (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onSelect(i);
      if (rig.beginDrag(i, e.ray) && controls.current)
        controls.current.enabled = false;
    },
    [onSelect, rig],
  );
  useEffect(() => {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const move = (ev: PointerEvent) => {
      if (!rig.dragging) return;
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      rig.moveDrag(ray.ray);
    };
    const up = () => {
      if (rig.endDrag() && controls.current) controls.current.enabled = true;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [gl, camera, rig]);

  const half = Math.max(arena.w, arena.d) / 2 + 2;
  const arenaBox = useMemo(
    () => new THREE.BoxGeometry(arena.w, 0.01, arena.d),
    [arena.w, arena.d],
  );
  useEffect(() => () => arenaBox.dispose(), [arenaBox]);

  return (
    <>
      {ortho ? (
        <OrthographicCamera
          makeDefault
          position={CAM_POS.toArray()}
          zoom={orthoZoom}
          near={1}
          far={200}
        />
      ) : (
        <PerspectiveCamera
          makeDefault
          position={CAM_POS.toArray()}
          fov={fov}
          near={1}
          far={200}
        />
      )}
      <OrbitControls ref={controls} makeDefault target={[0, 0, 0]} />

      {/* hero lighting, with the key light pushed out to cover a wider arena */}
      <ambientLight intensity={1.15} />
      <hemisphereLight
        intensity={0.9}
        color={"#fff6e0"}
        groundColor={"#caa97a"}
      />
      <directionalLight
        position={[7, 12, 10]}
        intensity={1.25}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-half, half, half, -half, 0.1, 40]}
        />
      </directionalLight>
      <directionalLight
        position={[-5, 2, 2]}
        intensity={0.35}
        color="#bcdcff"
      />

      {dice.map((spec, i) => (
        <LabDie
          key={i}
          spec={spec}
          index={i}
          rig={rig}
          selected={selected === i}
          shadow={shadow}
          onPointerDown={beginDrag(i)}
        />
      ))}

      {/* editing aids: anything named "ui" is hidden while exporting */}
      {grid && (
        <group name="ui" position={[0, -DIE_HALF, 0]}>
          <gridHelper args={[20, 20, "#4d9ff7", "#8a8a8a"]} />
          <lineSegments>
            <edgesGeometry args={[arenaBox]} />
            <lineBasicMaterial color="#d8502b" />
          </lineSegments>
        </group>
      )}

      <Exporter rig={rig} dice={dice} shadow={shadow} />
    </>
  );
}

function LabDie({
  spec,
  index,
  rig,
  selected,
  shadow,
  onPointerDown,
}: {
  spec: DieSpec;
  index: number;
  rig: LabRig;
  selected: boolean;
  shadow: DropShadow;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const shadowMesh = useRef<THREE.Mesh>(null);
  const textures = useMemo(() => spec.faces.map(faceTexture), [spec]);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  const shadowTex = useMemo(() => shadowTexture(shadow.blur), [shadow.blur]);
  useEffect(() => () => shadowTex.dispose(), [shadowTex]);

  const away = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const pose = rig.poses[index];
    const g = group.current;
    if (!pose || !g) return;
    g.position.copy(pose.p);
    g.quaternion.copy(pose.q);
    const sh = shadowMesh.current;
    if (sh) {
      // billboard behind the die (along the view direction), offset like a
      // drop shadow in screen terms
      camera.getWorldDirection(away);
      sh.position
        .copy(pose.p)
        .addScaledVector(away, 0.9)
        .add(new THREE.Vector3(shadow.dx, -shadow.dy, 0));
      sh.quaternion.copy(camera.quaternion);
    }
  });

  return (
    <>
      <group ref={group} onPointerDown={onPointerDown}>
        <DieBody textures={textures} />
        {selected && (
          <mesh name="ui">
            <boxGeometry args={[1.14, 1.14, 1.14]} />
            <meshBasicMaterial color="#4d9ff7" wireframe />
          </mesh>
        )}
      </group>
      {shadow.on && (
        <mesh ref={shadowMesh} renderOrder={-1}>
          <planeGeometry args={[shadow.size, shadow.size]} />
          <meshBasicMaterial
            map={shadowTex}
            transparent
            opacity={shadow.opacity}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
    </>
  );
}

// A black rounded square, blurred: the die's drop-shadow blob.
function shadowTexture(blur: number): THREE.Texture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const px = blur * S * 0.18;
  const side = S * 0.6 - px;
  ctx.filter = `blur(${px}px)`;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect((S - side) / 2, (S - side) / 2, side, side, side * 0.12);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Renders the scene once at the requested width (same framing as on screen),
// copies the pixels out before the browser composites, then optionally crops to
// the dice's alpha bounding box. The on-screen canvas is resized only for the
// duration of that one synchronous draw.
function Exporter({
  rig,
  dice,
  shadow,
}: {
  rig: LabRig;
  dice: DieSpec[];
  shadow: DropShadow;
}) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    rig.setSvgFn((opts) =>
      diceSvg(dice, rig.poses, get().camera.quaternion, shadow, opts),
    );
    return () => rig.setSvgFn(null);
  }, [get, rig, dice, shadow]);
  useEffect(() => {
    rig.setExportFn(async ({ width, crop, pad }) => {
      const { gl, scene, camera, size } = get();
      const w = Math.max(64, Math.min(MAX_EXPORT, Math.round(width)));
      const h = Math.round((w * size.height) / size.width);
      const hidden: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.name === "ui" && o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      });
      const dpr = gl.getPixelRatio();
      const full = document.createElement("canvas");
      full.width = w;
      full.height = h;
      // render at 2× where the GPU allows and scale down: smoother edges than
      // the canvas's own multisampling alone
      const ss = Math.max(
        1,
        Math.min(
          2,
          Math.floor(gl.capabilities.maxTextureSize / Math.max(w, h)),
        ),
      );
      try {
        gl.setPixelRatio(1);
        gl.setSize(w * ss, h * ss, false);
        gl.render(scene, camera);
        const ctx = full.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(gl.domElement, 0, 0, w, h);
      } finally {
        gl.setPixelRatio(dpr);
        gl.setSize(size.width, size.height, false);
        hidden.forEach((o) => (o.visible = true));
      }

      let out = full;
      if (crop) {
        const ctx = full.getContext("2d")!;
        const data = ctx.getImageData(0, 0, w, h).data;
        let x0 = w,
          y0 = h,
          x1 = -1,
          y1 = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] !== 0) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 >= x0) {
          x0 = Math.max(0, x0 - pad);
          y0 = Math.max(0, y0 - pad);
          x1 = Math.min(w - 1, x1 + pad);
          y1 = Math.min(h - 1, y1 + pad);
          out = document.createElement("canvas");
          out.width = x1 - x0 + 1;
          out.height = y1 - y0 + 1;
          out
            .getContext("2d")!
            .drawImage(
              full,
              x0,
              y0,
              out.width,
              out.height,
              0,
              0,
              out.width,
              out.height,
            );
        }
      }
      return new Promise<Blob>((resolve, reject) =>
        out.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/png",
        ),
      );
    });
    return () => {
      rig.setExportFn(null);
    };
  }, [get, rig]);
  return null;
}
