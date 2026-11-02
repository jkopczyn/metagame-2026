import * as THREE from "three";
import type { Pose } from "./labPhysics";

// A deterministic arrangement: dice in rows, each turned to show its chosen
// letter, then jittered by up to the given amounts. Same seed, same picture,
// so a variant can be revisited; Shuffle just picks a new seed.

export type Layout = {
  perRow: number; // dice per row; 0 = everything on one row
  gap: number; // center spacing along a row, in die widths
  rowGap: number; // vertical spacing between rows, in die widths
  yaw: number; // max degrees turned left/right (reveals the side face)
  tilt: number; // max degrees tipped toward/away from the camera
  lean: number; // degrees rows tip toward the middle: top rows show their
  // top pips, bottom rows their bottom pips
  spin: number; // max degrees rotated in the picture plane
  scatter: number; // max offset along/up the row, in die widths
  depth: number; // max offset toward/away from the camera, in die widths
  seed: number;
};

export const DEFAULT_LAYOUT: Layout = {
  perRow: 4,
  gap: 1.3,
  rowGap: 1.45,
  yaw: 25,
  tilt: 12,
  lean: 15,
  spin: 12,
  scatter: 0.08,
  depth: 0.3,
  seed: 1,
};

export type Show = "front" | "right";

// A soft shadow blob behind and below each die, facing the camera like a
// drop shadow in a graphics app, rather than a floor the dice stand on.
export type DropShadow = {
  on: boolean;
  dx: number; // offset right, in die widths
  dy: number; // offset down, in die widths
  size: number; // blob edge, in die widths
  blur: number; // softness, 0..1
  opacity: number;
};

export const DEFAULT_SHADOW: DropShadow = {
  on: false,
  dx: 0.08,
  dy: 0.25,
  size: 1.3,
  blur: 0.5,
  opacity: 0.45,
};

// Turns the die so the chosen letter face points at the camera (+Z).
const SHOW_QUAT: Record<Show, THREE.Quaternion> = {
  front: new THREE.Quaternion(),
  right: new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -Math.PI / 2,
  ),
};

// mulberry32: tiny seeded PRNG, plenty for picking jitter
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  return Math.floor(Math.random() * 1e6);
}

export function arrangePoses(shows: Show[], l: Layout): Pose[] {
  const n = shows.length;
  const perRow = l.perRow > 0 ? l.perRow : n;
  const rows = Math.ceil(n / perRow);
  const rand = rng(l.seed);
  const pm = (max: number) => (rand() * 2 - 1) * max;
  const d = THREE.MathUtils.degToRad;
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);

  return shows.map((show, i) => {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    const cols = Math.min(perRow, n - r * perRow);
    const p = new THREE.Vector3(
      (c - (cols - 1) / 2) * l.gap + pm(l.scatter),
      ((rows - 1) / 2 - r) * l.rowGap + pm(l.scatter),
      pm(l.depth),
    );
    // positive X rotation brings the top face toward the camera
    const lean = Math.sign((rows - 1) / 2 - r) * l.lean;
    // world-axis jitter applied on top of the base facing, so yaw is always
    // "turn on the table" and spin always "rotate in the picture"
    const q = new THREE.Quaternion()
      .setFromAxisAngle(Y, d(pm(l.yaw)))
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(X, d(lean + pm(l.tilt))),
      )
      .multiply(new THREE.Quaternion().setFromAxisAngle(Z, d(pm(l.spin))))
      .multiply(SHOW_QUAT[show]);
    return { p, q };
  });
}
