import * as THREE from "three";
import {
  COLORS,
  GLYPH,
  HI,
  PIP_MAP,
} from "@/v2/components/dice/dice3d/faceTexture";
import { letterPaths } from "@/v2/lib/dice-letter-paths";
import type { DieSpec, Face } from "./labDice";
import type { DropShadow } from "./labLayout";
import type { Pose } from "./labPhysics";

// A flat-vector take on the scene: each visible cube face becomes a polygon
// shaded by the key light, with the letter outline or pips mapped onto it.
// Always an orthographic projection along the camera's view direction (a
// perspective face isn't an affine image of its texture, so it can't be an
// SVG transform). No bevels, no cast shadows — the drop shadow comes along as
// a blurred rounded square.

const SIZE = 1;
const HALF = SIZE / 2;
const TEX = 512;
// Bevel radius (DieBody RADIUS). A rounded cube is the sharp inner cube
// (side SIZE - 2R) inflated by R, and inflation commutes with orthographic
// projection: drawing the inner cube's faces with a 2R-wide round-joined
// stroke of their own color gives exactly the rounded silhouette.
const R = SIZE * 0.06;
const IH = HALF - R; // inner cube half-side
// the printed panel covers the flat face inside the bevel (DieBody PANEL)
const PANEL = SIZE - 2 * R;
const PH = PANEL / 2;
const KEY_LIGHT = new THREE.Vector3(7, 12, 10).normalize();
const FILL_LIGHT = new THREE.Vector3(-5, 2, 2).normalize();

// Same six faces, same order and orientation as DieBody's FACES.
const FACES: { pos: THREE.Vector3; rot: THREE.Euler }[] = [
  { pos: new THREE.Vector3(0, 0, HALF), rot: new THREE.Euler(0, 0, 0) },
  { pos: new THREE.Vector3(0, 0, -HALF), rot: new THREE.Euler(0, Math.PI, 0) },
  {
    pos: new THREE.Vector3(HALF, 0, 0),
    rot: new THREE.Euler(0, Math.PI / 2, 0),
  },
  {
    pos: new THREE.Vector3(-HALF, 0, 0),
    rot: new THREE.Euler(0, -Math.PI / 2, 0),
  },
  {
    pos: new THREE.Vector3(0, HALF, 0),
    rot: new THREE.Euler(-Math.PI / 2, 0, 0),
  },
  {
    pos: new THREE.Vector3(0, -HALF, 0),
    rot: new THREE.Euler(Math.PI / 2, 0, 0),
  },
];

export type SvgOpts = { width: number; pad: number };

type Pt = { x: number; y: number };

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

const f = (n: number) => +n.toFixed(4);

export function diceSvg(
  dice: DieSpec[],
  poses: Pose[],
  camera: THREE.Quaternion,
  shadow: DropShadow,
  opts: SvgOpts,
): string {
  // world → view: x right, y up, z toward the viewer
  const toView = camera.clone().invert();
  const viewDir = new THREE.Vector3(0, 0, 1).applyQuaternion(camera);
  const project = (p: THREE.Vector3): Pt => {
    const v = p.clone().applyQuaternion(toView);
    return { x: v.x, y: -v.y };
  };

  const items: { depth: number; svg: string }[] = [];
  const pts: Pt[] = [];
  const paths = letterPaths(GLYPH);

  dice.forEach((spec, i) => {
    const pose = poses[i];
    if (!pose) return;

    if (shadow.on) {
      const c = pose.p
        .clone()
        .add(
          new THREE.Vector3(shadow.dx, -shadow.dy, 0).applyQuaternion(camera),
        );
      const v = project(c);
      const side = (0.6 - shadow.blur * 0.18) * shadow.size;
      const sigma = shadow.blur * 0.18 * shadow.size;
      items.push({
        depth: -Infinity,
        svg:
          `<rect x="${f(v.x - side / 2)}" y="${f(v.y - side / 2)}" width="${f(side)}" height="${f(side)}" rx="${f(side * 0.12)}"` +
          ` fill="#000" opacity="${shadow.opacity}" filter="url(#sh)"/>` +
          `<!--sigma=${f(sigma)}-->`,
      });
      pts.push(
        { x: v.x - side, y: v.y - side },
        { x: v.x + side, y: v.y + side },
      );
    }

    FACES.forEach((face, k) => {
      const faceQ = new THREE.Quaternion().setFromEuler(face.rot);
      const q = pose.q.clone().multiply(faceQ);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      if (normal.dot(viewDir) <= 0.001) return;

      // the printed panel sits on the real surface; the ink square is the
      // inner cube's face, R further in, so neighbours share edges
      const center = face.pos.clone().applyQuaternion(pose.q).add(pose.p);
      const inner = face.pos
        .clone()
        .multiplyScalar(IH / HALF)
        .applyQuaternion(pose.q)
        .add(pose.p);
      // panel-local (x right, y up, on the face plane) → world
      const local = (x: number, y: number, at = center) =>
        new THREE.Vector3(x, y, 0).applyQuaternion(q).add(at);
      const corners = [
        local(-IH, -IH, inner),
        local(IH, -IH, inner),
        local(IH, IH, inner),
        local(-IH, IH, inner),
      ].map(project);
      // the stroke reaches R past the inner corners
      pts.push(
        ...corners.flatMap((c) => [
          { x: c.x - R, y: c.y - R },
          { x: c.x + R, y: c.y + R },
        ]),
      );

      const k1 = Math.max(0, normal.dot(KEY_LIGHT));
      const k2 = Math.max(0, normal.dot(FILL_LIGHT));
      const light = Math.min(1.15, 0.55 + 0.5 * k1 + 0.15 * k2);
      const depth = center.clone().applyQuaternion(toView).z;

      // texture pixel (px, py) → world: canvas y runs down, panel y runs up
      const o = project(local(-PH, PH));
      const ax = project(local(-PH + PANEL / TEX, PH));
      const ay = project(local(-PH, PH - PANEL / TEX));
      const m = [ax.x - o.x, ax.y - o.y, ay.x - o.x, ay.y - o.y, o.x, o.y].map(
        f,
      );

      const poly = corners.map((c) => `${f(c.x)},${f(c.y)}`).join(" ");
      const ink = shade(COLORS.ink, light);
      let svg = `<polygon points="${poly}" fill="${ink}" stroke="${ink}" stroke-width="${f(2 * R)}" stroke-linejoin="round"/>`;
      svg += `<g transform="matrix(${m.join(" ")})">${faceArt(spec.faces[k], paths, light)}</g>`;
      items.push({ depth, svg });
    });
  });

  items.sort((a, b) => a.depth - b.depth);

  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0;
  const padW = (opts.pad / opts.width) * (x1 - x0 || 1);
  x0 -= padW;
  y0 -= padW;
  x1 += padW;
  y1 += padW;
  const w = x1 - x0 || 1;
  const h = y1 - y0 || 1;
  const sigma = shadow.on ? shadow.blur * 0.18 * shadow.size : 0;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}"` +
    ` width="${Math.round(opts.width)}" height="${Math.round((opts.width * h) / w)}">` +
    `<defs><filter id="sh" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${f(sigma)}"/></filter></defs>` +
    items.map((it) => it.svg).join("") +
    `</svg>`
  );
}

// What's printed on one face, in the 512-px texture space.
function faceArt(
  face: Face,
  paths: Record<string, string>,
  light: number,
): string {
  if (face.kind === "pips") {
    const pad = TEX * 0.22;
    const cell = (TEX - pad * 2) / 2;
    const r = TEX * 0.095;
    const fill = shade(COLORS.white, light);
    return (PIP_MAP[face.value] ?? [])
      .map((idx) => {
        const x = pad + (idx % 3) * cell;
        const y = pad + Math.floor(idx / 3) * cell;
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
      })
      .join("");
  }
  const d = paths[face.letter.toLowerCase()];
  if (!d) return "";
  const color =
    face.color in COLORS
      ? COLORS[face.color as keyof typeof COLORS]
      : face.color;
  const s = (TEX - 2 * HI) / TEX;
  return `<path d="${d}" fill="${shade(color, light)}" fill-rule="evenodd" transform="translate(${HI} ${HI}) scale(${f(s)})"/>`;
}
