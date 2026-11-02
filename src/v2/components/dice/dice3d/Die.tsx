"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { COLORS, letterTexture, pipTexture } from "./faceTexture";
import type { IntroDriver } from "./introDriver";
import type { RenderBudget } from "./renderBudget";

export type DieData = {
  front: string; // blue letter (+Z)
  right: string; // orange letter (+X)
  top: number; // dark pip value (+Y)
};

// blue front spells META, orange right spells GAME, dark tops show 2026 in pips
export const DICE: DieData[] = [
  { front: "M", right: "G", top: 2 },
  { front: "E", right: "A", top: 0 },
  { front: "T", right: "M", top: 2 },
  { front: "A", right: "E", top: 6 },
];

export type Phase = "meta" | "game" | "year" | "static";

// In STATIC mode a die can override its two visible faces (front = left glyph,
// right = right glyph at the edge-on yaw) so the row spells METAGAME straight
// across instead of weaving META over GAME.
export type LetterFace = { letter: string; color: "blue" | "orange" };
export type StaticLetters = { front: LetterFace; right: LetterFace };

// Whole-die orientation per phase. META rests with the blue letter forward and a
// gentle tilt; GAME spins the orange face to the front; YEAR tips the pip top up
// toward the camera. STATIC rests edge-on between the two letters and renders
// orthographic (reduced-motion, also pinnable via ?phase=static); construction below.
const d = THREE.MathUtils.degToRad;
const quat = (x: number, y: number, z = 0) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(d(x), d(y), d(z), "YXZ"));

// Camera sits on +Z looking toward -Z. Positive X rotation brings +Y (top) into
// view; negative Y rotation brings +X (right) into view — the classic 3-face die
// pose. META rests showing the blue +Z face; GAME swings the orange +X face to
// front; YEAR tips the pip top (+Y) up to the camera.
// STATIC pose, built as an explicit rotation sequence so each axis is a separate
// dial (tune the three angles): yaw to sit edge-on between the letters, an optional
// roll about the view axis, then a downward pitch.
const staticPose = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(1, 0, 0), d(20)) // pitch down
  .multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), d(0)),
  ) // roll about the view axis
  .multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d(-45)),
  ); // yaw: edge-on between the two letters

// Exported so the roll-in drivers can target the META rest orientation — the
// handoff contract is that the intro ends exactly at (slotX, 0, 0, QUAT.meta).
export const QUAT: Record<Phase, THREE.Quaternion> = {
  static: staticPose,
  meta: quat(-10, -5), // CSS-matched resting tilt: blue META up front, slight underside
  game: quat(-0, -85, -5), // orange +X face turns to front
  year: quat(80, 3), // tips the pip top (+Y) nearly straight-on to read 2026
};

const TURN_S = 1.0; // seconds for a die to complete its turn
const STAGGER = 0.04; // tiny per-die delay — the row turns near-unison, not a wave

const SIZE = 1; // die edge length in world units
const RADIUS = SIZE * 0.06; // bevel radius of the rounded body

// The body's flat (un-beveled) face spans SIZE - 2*RADIUS. The printed panel is
// a rounded square sized to cover that flat region and reach up to where the
// bevel begins; its corner radius matches the bevel so the corners tuck into the
// rounded edge instead of poking past it. PANEL slightly exceeds the flat region
// so the colored area meets the bevel with no dark gap.
const FLAT = SIZE - 2 * RADIUS;
// Panel fills exactly the flat face region (corner radius = bevel radius) and sits
// exactly coplanar with the face, so it reads as painted-on rather than a raised
// sticker. Coplanar on purpose: any physical lift leaves the panel's rim standing
// proud of the bevel, which shows as a notch in the silhouette edge-on.
// polygonOffset (below) resolves the z-fight with the body face instead.
const PANEL = FLAT;
const PANEL_R = RADIUS;

// A rounded-rectangle plane centered at the origin in the XY plane, with UVs
// normalized to 0..1 so a full-bleed face texture maps across it cleanly.
function roundedPanelGeometry(
  side: number,
  radius: number,
): THREE.ShapeGeometry {
  const h = side / 2;
  const r = Math.min(radius, h);
  const shape = new THREE.Shape();
  shape.moveTo(-h + r, -h);
  shape.lineTo(h - r, -h);
  shape.quadraticCurveTo(h, -h, h, -h + r);
  shape.lineTo(h, h - r);
  shape.quadraticCurveTo(h, h, h - r, h);
  shape.lineTo(-h + r, h);
  shape.quadraticCurveTo(-h, h, -h, h - r);
  shape.lineTo(-h, -h + r);
  shape.quadraticCurveTo(-h, -h, -h + r, -h);

  const geo = new THREE.ShapeGeometry(shape, 12);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + h) / side; // x -> u
    uv[i * 2 + 1] = (pos.getY(i) + h) / side; // y -> v
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Each printed face: panel center position + the rotation that lays the panel
// flat against that cube face (panel default normal is +Z).
const HALF = SIZE / 2;
const FACES: {
  pos: [number, number, number];
  rot: [number, number, number];
}[] = [
  { pos: [0, 0, HALF], rot: [0, 0, 0] }, // +Z front (blue letter)
  { pos: [0, 0, -HALF], rot: [0, Math.PI, 0] }, // -Z back (blue letter)
  { pos: [HALF, 0, 0], rot: [0, Math.PI / 2, 0] }, // +X right (orange letter)
  { pos: [-HALF, 0, 0], rot: [0, -Math.PI / 2, 0] }, // -X left (orange letter)
  { pos: [0, HALF, 0], rot: [-Math.PI / 2, 0, 0] }, // +Y top (dark pips)
  { pos: [0, -HALF, 0], rot: [Math.PI / 2, 0, 0] }, // -Y bottom (dark pips)
];

export default function Die({
  data,
  phase,
  index,
  x,
  intro,
  staticLetters,
  budget,
}: {
  data: DieData;
  phase: Phase;
  index: number; // die's position in the row; also the phase-turn stagger key
  x: number;
  intro?: IntroDriver; // roll-in pose source; Scene ticks it, dice read from it
  staticLetters?: StaticLetters;
  budget?: RenderBudget; // held while this die is turning or a face loads
}) {
  const group = useRef<THREE.Group>(null);
  const mover = useRef<THREE.Group>(null); // outer group: position (roll-in flight path)

  // Per-face textures, built once. Letter faces rasterize async; redraw when
  // they land or an idle (static / reduced-motion) die keeps blank faces.
  const textures = useMemo(() => {
    const onLoad = () => budget?.wake(0);
    const blue = letterTexture(data.front, "blue", onLoad);
    const blueBack = letterTexture(data.front, "blue", onLoad);
    const orange = letterTexture(data.right, "orange", onLoad);
    const orangeLeft = letterTexture(data.right, "orange", onLoad);
    const top = pipTexture(data.top);
    const bottom = pipTexture(7 - data.top);
    return [blue, blueBack, orange, orangeLeft, top, bottom];
  }, [data, budget]);

  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  // STATIC-only face set: the front/right show the overridden letters (back/left
  // mirror them since they're hidden edge-on), pips unchanged.
  const staticTextures = useMemo(() => {
    if (!staticLetters) return null;
    const { front, right } = staticLetters;
    const onLoad = () => budget?.wake(0);
    return [
      letterTexture(front.letter, front.color, onLoad),
      letterTexture(front.letter, front.color, onLoad),
      letterTexture(right.letter, right.color, onLoad),
      letterTexture(right.letter, right.color, onLoad),
      pipTexture(data.top),
      pipTexture(7 - data.top),
    ];
  }, [staticLetters, data.top, budget]);

  useEffect(
    () => () => staticTextures?.forEach((t) => t.dispose()),
    [staticTextures],
  );

  const faceTextures =
    phase === "static" && staticTextures ? staticTextures : textures;

  // Start pose (imperative so re-renders don't snap it back): mid-air off-screen
  // when rolling in, otherwise the resting pose for the starting phase — so a
  // pinned or reduced-motion start lands settled with no intro slerp. Position
  // lives here too — the outer group carries no position prop, so a mid-flight
  // re-render can't teleport the die to its slot.
  const started = useRef(false);
  const introDone = useRef(!intro);
  useEffect(() => {
    if (!group.current || !mover.current || started.current) return;
    started.current = true;
    if (intro) {
      intro.poseOf(index, mover.current.position, group.current.quaternion);
    } else {
      mover.current.position.set(x, 0, 0);
      group.current.quaternion.copy(QUAT[phase]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each phase change eases the die from its current pose to the new one over a
  // fixed duration, after a small per-die delay so the row turns in a wave.
  const target = QUAT[phase];
  const fromQ = useRef(new THREE.Quaternion());
  const prog = useRef(1); // 0..1 along the current turn; 1 = settled
  const wait = useRef(0);
  // The turn holds the render budget until it settles (motion, not a timer,
  // decides when frames stop — so a turn paused off-screen resumes on return).
  const holdRelease = useRef<(() => void) | null>(null);
  const settle = useCallback(() => {
    holdRelease.current?.();
    holdRelease.current = null;
  }, []);
  useEffect(() => {
    if (group.current) fromQ.current.copy(group.current.quaternion);
    prog.current = 0;
    wait.current = index * STAGGER;
    holdRelease.current = budget?.hold() ?? null;
    return settle;
  }, [phase, index, budget, settle]);

  useFrame((_, rawDt) => {
    const g = group.current;
    const m = mover.current;
    if (!g || !m) return;

    // Cap the step: returning to a hidden tab delivers the whole away-stretch as
    // one delta, which would run unstaggered die 0 straight to its target while
    // the others spent it all on their stagger wait.
    const dt = Math.min(rawDt, 0.1);

    // Roll-in owns the pose until it settles; the phase machine takes over from
    // the exact rest pose it lands in. The driver is ticked once per frame by
    // Scene (at an earlier useFrame priority) — dice only read poses here.
    if (!introDone.current && intro) {
      const settled = intro.poseOf(index, m.position, g.quaternion);
      if (settled) {
        introDone.current = true;
        prog.current = 1;
        settle();
      }
      return;
    }

    if (prog.current >= 1) return settle();
    if (wait.current > 0) {
      wait.current -= dt;
      return;
    }
    prog.current = Math.min(1, prog.current + dt / TURN_S);
    // smootherstep ease-in-out → gentle start and settle, no jerk at either end
    const u = prog.current;
    const e = u * u * u * (u * (6 * u - 15) + 10);
    g.quaternion.slerpQuaternions(fromQ.current, target, e);
    if (prog.current >= 1) settle();
  });

  return (
    <group ref={mover}>
      <group ref={group}>
        <DieBody textures={faceTextures} />
      </group>
    </group>
  );
}

// The die itself — ink body plus the six printed panels — with no pose or
// animation of its own, so other scenes (the dice lab) render the exact hero
// die from any texture set. `textures` follow FACES order.
export function DieBody({ textures }: { textures: THREE.Texture[] }) {
  // One rounded-panel geometry shared by all six faces.
  const panelGeo = useMemo(() => roundedPanelGeometry(PANEL, PANEL_R), []);
  useEffect(() => () => panelGeo.dispose(), [panelGeo]);

  return (
    <>
      {/* ink body — its rounded bevel forms the dark edges/frame */}
      <RoundedBox
        args={[SIZE, SIZE, SIZE]}
        radius={RADIUS}
        smoothness={8}
        bevelSegments={8}
        creaseAngle={0.6}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={COLORS.ink}
          roughness={0.9}
          metalness={0}
        />
      </RoundedBox>

      {/* printed faces: rounded panels filling each flat face, lit like the body
          so they read as painted-on rather than stuck-on stickers. */}
      {FACES.map((f, i) => (
        <mesh key={i} geometry={panelGeo} position={f.pos} rotation={f.rot}>
          <meshStandardMaterial
            map={textures[i]}
            // pip faces (top/bottom) get a glossier finish so the white pips catch
            // specular highlights and read brighter; letter faces stay a touch matte
            roughness={i >= 4 ? 0.35 : 0.7}
            metalness={0}
            // letter tiles carry a keyed alpha: the black regions drop out so the
            // die body shows through instead of a flatter, deader pure black
            alphaTest={i < 4 ? 0.5 : 0}
            // Minimal decal offset. `factor` scales with the face's depth slope,
            // so anything bigger punches the panel through the bevel (and the
            // die behind it) whenever a face turns edge-on mid-roll.
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      ))}
    </>
  );
}
