import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { snapToCube } from "./labPhysics";

const d = THREE.MathUtils.degToRad;
const euler = (x: number, y: number, z: number) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(d(x), d(y), d(z)));

describe("snapToCube", () => {
  it("leaves an axis-aligned orientation alone", () => {
    const q = euler(0, 90, 0);
    expect(snapToCube(q).angleTo(q)).toBeLessThan(1e-6);
  });

  it("snaps a slightly-off orientation to the nearest cube pose", () => {
    const q = euler(4, 87, -3);
    expect(snapToCube(q).angleTo(euler(0, 90, 0))).toBeLessThan(1e-6);
  });

  it("always returns a proper rotation", () => {
    for (let i = 0; i < 200; i++) {
      const q = new THREE.Quaternion().random();
      const s = snapToCube(q);
      const m = new THREE.Matrix4().makeRotationFromQuaternion(s);
      expect(m.determinant()).toBeCloseTo(1, 6);
      // every entry is 0 or ±1
      for (let k = 0; k < 12; k++)
        expect(
          Math.abs(Math.round(m.elements[k]) - m.elements[k]),
        ).toBeLessThan(1e-6);
      // greedy, so not always the true nearest pose — but never far off
      expect(s.angleTo(q)).toBeLessThan(d(90));
    }
  });
});
