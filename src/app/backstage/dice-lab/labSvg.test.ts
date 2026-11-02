import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { heroDie } from "./labDice";
import { DEFAULT_SHADOW } from "./labLayout";
import { diceSvg } from "./labSvg";

const front = new THREE.Quaternion();
const opts = { width: 1000, pad: 0 };

describe("diceSvg", () => {
  it("shows only the front face of a die seen straight on", () => {
    const svg = diceSvg(
      [heroDie("M", "G", 2)],
      [{ p: new THREE.Vector3(), q: new THREE.Quaternion() }],
      front,
      { ...DEFAULT_SHADOW, on: false },
      opts,
    );
    expect(svg.match(/<polygon/g)).toHaveLength(1);
    expect(svg).toContain("<path"); // the M glyph
    expect(svg).not.toContain("<circle");
    expect(svg).toContain('viewBox="-0.5 -0.5 1 1"');
  });

  it("shows three faces of a die turned toward a corner, pips included", () => {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(30),
        THREE.MathUtils.degToRad(35),
        0,
      ),
    );
    const svg = diceSvg(
      [heroDie("M", "G", 2)],
      [{ p: new THREE.Vector3(), q }],
      front,
      { ...DEFAULT_SHADOW, on: false },
      opts,
    );
    expect(svg.match(/<polygon/g)).toHaveLength(3);
    expect(svg.match(/<circle/g)).toHaveLength(2); // the 2 on top
  });

  it("puts a blurred shadow first when the drop shadow is on", () => {
    const svg = diceSvg(
      [heroDie("M", "G", 2)],
      [{ p: new THREE.Vector3(), q: new THREE.Quaternion() }],
      front,
      { ...DEFAULT_SHADOW, on: true },
      opts,
    );
    expect(svg.indexOf("<rect")).toBeLessThan(svg.indexOf("<polygon"));
    expect(svg).toContain("feGaussianBlur");
  });
});
