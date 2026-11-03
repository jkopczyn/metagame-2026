"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import Glyph, { GLYPH_LABELS, type GlyphName } from "./Glyph";

// Token colours from the brand guide, with the glyph colour for each.
const KINDS: { name: GlyphName; bg: string; fg: string }[] = [
  { name: "puzzles", bg: "bg-navy", fg: "text-cream" },
  { name: "video-games", bg: "bg-brand-blue", fg: "text-navy" },
  { name: "larps", bg: "bg-meeple", fg: "text-cream" },
  { name: "dance", bg: "bg-sky", fg: "text-navy" },
  { name: "megagame", bg: "bg-tan", fg: "text-navy" },
  { name: "party-games", bg: "bg-moss", fg: "text-cream" },
  { name: "card-games", bg: "bg-peach", fg: "text-navy" },
  { name: "crosswords", bg: "bg-sky", fg: "text-navy" },
  { name: "workshops", bg: "bg-tan", fg: "text-navy" },
  { name: "escape-rooms", bg: "bg-background", fg: "text-navy" },
  { name: "trivia", bg: "bg-brand-blue", fg: "text-navy" },
  { name: "board-games", bg: "bg-background", fg: "text-navy" },
];

// The web is an icosahedron: twelve corners, one kind of play on each, and
// its thirty edges between them. Drag to spin it; left alone it turns
// slowly. Corners further away draw smaller and their edges fainter.
const PHI = (1 + Math.sqrt(5)) / 2;
const CORNERS = [-1, 1].flatMap((a) =>
  [-1, 1].flatMap((b) => [
    [0, a, b * PHI],
    [a, b * PHI, 0],
    [a * PHI, 0, b],
  ]),
);
const RADIUS = Math.hypot(1, PHI);
// An edge joins corners two units apart.
const EDGES = CORNERS.flatMap((a, i) =>
  CORNERS.flatMap((b, j) =>
    j > i && Math.abs(Math.hypot(...a.map((v, k) => v - b[k])) - 2) < 1e-6
      ? [[i, j] as const]
      : [],
  ),
);

// 3×3 rotation matrices, row-major, mapping the model into screen space
// (x right, y down, z towards the viewer).
type Mat = number[];
const rotX = (t: number): Mat => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
const rotY = (t: number): Mat => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
// Rotation by t about a unit axis (Rodrigues).
const rotAxis = ([x, y, z]: number[], t: number): Mat => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = 1 - c;
  return [
    c + x * x * k,
    x * y * k - z * s,
    x * z * k + y * s,
    y * x * k + z * s,
    c + y * y * k,
    y * z * k - x * s,
    z * x * k - y * s,
    z * y * k + x * s,
    c + z * z * k,
  ];
};
const mul = (a: Mat, b: Mat): Mat =>
  Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3);
    const c = i % 3;
    return a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  });
const apply = (m: Mat, [x, y, z]: number[]) => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];

// The opening pose (rotY(1.955) · rotX(2.897)), turned so no two corners land
// near each other. Literal, so the server and every browser render the same
// first frame.
// prettier-ignore
const START: Mat = [
  -0.374821, 0.224507, -0.899503,
  0, -0.970236, -0.242161,
  -0.927097, -0.090767, 0.363665,
];

// The box, in CSS pixels at the design width; everything is laid out as a
// percentage of it so it scales with the column.
const W = 432;
const H = 400;
const HEX = 50;
const SCALE = (Math.min(W, H) / 2 - HEX * 0.7) / RADIUS;
// Camera distance, in model units: how much nearer corners grow.
const CAMERA = 9;
const HEX_CLIP = "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)";

const DRAG = 0.008;
// The idle turn, in radians per second, about an axis in the screen plane
// that itself sweeps round once per PRECESS_S seconds (vertical, then
// horizontal, then vertical again), so every corner gets a turn at the
// front while each moment is still a single clean rotation.
const IDLE_SPIN = 0.29;
const PRECESS_S = 25;
const IDLE_AFTER_MS = 2500;

export default function PlayWeb() {
  const [pose, setPose] = useState<Mat>(START);
  // The nearest corner shows its label; a tapped one takes over until the
  // next tap (hover does the same on desktop).
  const [picked, setPicked] = useState<number | null>(null);
  const moved = useRef(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    x0: number;
    y0: number;
    at: number;
  } | null>(null);
  const velocity = useRef({ x: 0, y: 0 });
  const lastTouch = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const onScreen = useRef(true);

  // Inertia after a drag, and the slow idle turn, unless motion is unwanted.
  // Nothing runs while the box is scrolled out of view.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(([e]) => {
      onScreen.current = e.isIntersecting;
    });
    if (box.current) seen.observe(box.current);
    let frame = 0;
    let last = performance.now();
    let phi = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      if (drag.current || document.hidden || !onScreen.current) return;
      const v = velocity.current;
      const f = dt * 60;
      if (Math.abs(v.x) + Math.abs(v.y) > 0.0004) {
        setPose((p) => mul(mul(rotY(v.x * f), rotX(v.y * f)), p));
        v.x *= 0.94 ** f;
        v.y *= 0.94 ** f;
      } else if (now - lastTouch.current > IDLE_AFTER_MS) {
        phi += ((2 * Math.PI) / PRECESS_S) * dt;
        const axis = [Math.sin(phi), Math.cos(phi), 0];
        setPose((p) => mul(rotAxis(axis, IDLE_SPIN * dt), p));
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
    };
  }, []);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { pointerId: id, clientX: x, clientY: y } = e;
    drag.current = { id, x, y, x0: x, y0: y, at: performance.now() };
    moved.current = false;
    velocity.current = { x: 0, y: 0 };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!moved.current) {
      if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) <= 3) return;
      moved.current = true;
    }
    const dx = (e.clientX - d.x) * DRAG;
    const dy = -(e.clientY - d.y) * DRAG;
    d.x = e.clientX;
    d.y = e.clientY;
    d.at = performance.now();
    velocity.current = { x: dx, y: dy };
    setPose((p) => mul(mul(rotY(dx), rotX(dy)), p));
  };
  // Pointer capture sends the click to the box, not the corner under the
  // finger, so a tap is resolved here: pin the corner it landed on, or clear.
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    drag.current = null;
    const now = performance.now();
    lastTouch.current = now;
    if (now - d.at > 60) velocity.current = { x: 0, y: 0 };
    if (moved.current || e.type === "pointercancel") return;
    const hit = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-corner]");
    const i = hit ? Number(hit.dataset.corner) : null;
    setPicked((p) => (i === null || p === i ? null : i));
  };

  // Rounded, so the server's and the browser's floating point agree and the
  // first paint hydrates cleanly.
  const r = (n: number) => Math.round(n * 100) / 100;
  const nodes = CORNERS.map((c) => {
    const [x, y, z] = apply(pose, c);
    const k = CAMERA / (CAMERA - z);
    const depth = r((z + RADIUS) / (2 * RADIUS));
    return {
      x: r(W / 2 + x * SCALE * k),
      y: r(H / 2 + y * SCALE * k),
      k: r(k),
      depth,
      // Stacking order: nearer corners over further ones, with room between
      // them for the edges.
      z: 1 + Math.round(depth * 1000),
    };
  });

  const front = nodes.reduce(
    (b, n, i) => (n.depth > nodes[b].depth ? i : b),
    0,
  );
  const shown = picked ?? front;

  return (
    <div
      ref={box}
      className="relative isolate w-full cursor-grab touch-pan-y select-none active:cursor-grabbing"
      style={{ aspectRatio: `${W} / ${H}` }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {/* Each edge on its own layer, just under the further of its two
          corners, so a corner at the back sits behind the edges in front of
          it and no edge crosses the face of a corner it joins. */}
      {EDGES.map(([i, j]) => (
        <svg
          key={`${i}-${j}`}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full"
          style={{ zIndex: Math.min(nodes[i].z, nodes[j].z) - 1 }}
        >
          <line
            x1={nodes[i].x}
            y1={nodes[i].y}
            x2={nodes[j].x}
            y2={nodes[j].y}
            className="stroke-navy"
            strokeWidth={1.5}
            strokeOpacity={r(
              0.1 + 0.35 * ((nodes[i].depth + nodes[j].depth) / 2),
            )}
          />
        </svg>
      ))}
      <ul>
        {KINDS.map(({ name, bg, fg }, i) => {
          const { x, y, k, z } = nodes[i];
          return (
            <li
              key={name}
              // The hovered one rises above the rest, so its label is never
              // under a nearer edge.
              className={`group absolute z-(--z) -translate-x-1/2 -translate-y-1/2 hover:z-[2000] ${shown === i ? "z-[2000]!" : ""}`}
              data-corner={i}
              style={
                {
                  left: `${r((x / W) * 100)}%`,
                  top: `${r((y / H) * 100)}%`,
                  width: `${r(((HEX * k) / W) * 100)}%`,
                  "--z": z,
                } as React.CSSProperties
              }
            >
              {/* A navy hex with the coloured one inset, for an outline the
                  clip can't cut. */}
              <span
                className="grid aspect-[1/0.87] w-full place-items-center bg-navy"
                style={{ clipPath: HEX_CLIP }}
              >
                <span
                  className={`grid size-[calc(100%-5px)] place-items-center ${bg} ${fg}`}
                  style={
                    {
                      clipPath: HEX_CLIP,
                      "--glyph-bg": "var(--color-peach)",
                    } as React.CSSProperties
                  }
                >
                  <Glyph
                    name={name}
                    label={GLYPH_LABELS[name]}
                    className="size-[58%]"
                  />
                </span>
              </span>
              <span
                aria-hidden
                className={`pointer-events-none absolute -top-7 left-1/2 z-20 -translate-x-1/2 rounded bg-navy px-2 py-1 font-space-mono text-[10px] font-bold tracking-[0.1em] whitespace-nowrap text-cream uppercase opacity-0 transition-opacity group-hover:opacity-100 ${shown === i ? "opacity-100" : ""}`}
              >
                {GLYPH_LABELS[name]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
