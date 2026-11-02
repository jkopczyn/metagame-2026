import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_LAYOUT, arrangePoses, type Layout } from "./labLayout";

const still: Layout = {
  ...DEFAULT_LAYOUT,
  yaw: 0,
  tilt: 0,
  lean: 0,
  spin: 0,
  scatter: 0,
  depth: 0,
};

describe("arrangePoses", () => {
  it("lays dice out in centered rows when nothing is jittered", () => {
    const poses = arrangePoses(
      ["front", "front", "front", "front", "right", "right"],
      { ...still, perRow: 4, gap: 2, rowGap: 3 },
    );
    expect(poses.map((p) => p.p.toArray().map((v) => v + 0))).toEqual([
      [-3, 1.5, 0],
      [-1, 1.5, 0],
      [1, 1.5, 0],
      [3, 1.5, 0],
      [-1, -1.5, 0],
      [1, -1.5, 0],
    ]);
  });

  it("points the chosen face at the camera", () => {
    const [front, right] = arrangePoses(["front", "right"], still);
    const z = new THREE.Vector3(0, 0, 1);
    expect(z.clone().applyQuaternion(front.q).z).toBeCloseTo(1);
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(right.q).z).toBeCloseTo(
      1,
    );
  });

  it("leans rows toward the middle so their pips show", () => {
    const [top, , bottom] = arrangePoses(["front", "front", "front"], {
      ...still,
      perRow: 1,
      lean: 20,
    });
    const up = new THREE.Vector3(0, 1, 0);
    // top row's top face comes toward the camera, bottom row's goes away
    expect(up.clone().applyQuaternion(top.q).z).toBeGreaterThan(0.3);
    expect(up.clone().applyQuaternion(bottom.q).z).toBeLessThan(-0.3);
  });

  it("is deterministic per seed and stays within the limits", () => {
    const shows = Array<"front">(8).fill("front");
    const lay = { ...DEFAULT_LAYOUT, lean: 0 };
    const a = arrangePoses(shows, { ...lay, seed: 42 });
    const b = arrangePoses(shows, { ...lay, seed: 42 });
    const c = arrangePoses(shows, { ...lay, seed: 43 });
    expect(a.map((p) => p.p.toArray())).toEqual(b.map((p) => p.p.toArray()));
    expect(a[0].p.toArray()).not.toEqual(c[0].p.toArray());
    const maxAngle = THREE.MathUtils.degToRad(
      DEFAULT_LAYOUT.yaw + DEFAULT_LAYOUT.tilt + DEFAULT_LAYOUT.spin,
    );
    const identity = new THREE.Quaternion();
    for (const { p, q } of a) {
      expect(Math.abs(p.z)).toBeLessThanOrEqual(DEFAULT_LAYOUT.depth);
      expect(q.angleTo(identity)).toBeLessThanOrEqual(maxAngle);
    }
  });
});
