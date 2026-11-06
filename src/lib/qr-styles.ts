import type { Options } from "qr-code-styling";
import {
  arc,
  circle,
  rect,
  rotation,
  transform,
  type Cmd,
} from "@/lib/vector-path";

type DotType = NonNullable<Options["dotsOptions"]>["type"];
type EyeType = NonNullable<Options["cornersSquareOptions"]>["type"];
type EyeDotType = NonNullable<Options["cornersDotOptions"]>["type"];
type Shape = { label: string; dots: DotType; eye: EyeType; eyeDot: EyeDotType };

const SHAPES = {
  square: { label: "Square", dots: "square", eye: "square", eyeDot: "square" },
  dots: { label: "Dots", dots: "dots", eye: "extra-rounded", eyeDot: "dot" },
  rounded: {
    label: "Rounded",
    dots: "rounded",
    eye: "extra-rounded",
    eyeDot: "square",
  },
  blobby: {
    label: "Blobby",
    dots: "extra-rounded",
    eye: "extra-rounded",
    eyeDot: "dot",
  },
  classy: {
    label: "Classy",
    dots: "classy-rounded",
    eye: "extra-rounded",
    eyeDot: "dot",
  },
} as const satisfies Record<string, Shape>;

/** The links tool's catalog (rendered by qr-code-styling in the browser). */
export const LINK_QR_STYLES = {
  ...SHAPES,
  logo: { ...SHAPES.dots, label: "Logo", image: "/images/logo_square.png" },
  wifi: { ...SHAPES.dots, label: "Wi-Fi", image: "/images/wifi.svg" },
} as const;

// Posters pick dots, corners and a centre logo independently, and draw them
// as vectors with `qrShapes` (PDF and previews alike).
export const QR_DOTS = {
  square: { label: "Square", type: "square" },
  dots: { label: "Dots", type: "dots" },
  blobby: { label: "Blobby", type: "extra-rounded" },
  classy: { label: "Classy", type: "classy-rounded" },
} as const;
// A rounded frame needs a round centre: square centres in rounded frames
// failed jsQR's finder check on most 150 dpi poster renders.
export const QR_CORNERS = {
  square: { label: "Square" },
  rounded: { label: "Rounded" },
  dice: { label: "Dice" },
} as const;
export const QR_LOGOS = {
  none: { label: "None" },
  mg2: { label: "MG2 die" },
  die: { label: "MG die, color" },
} as const;
export type QrDots = keyof typeof QR_DOTS;
export type QrCorners = keyof typeof QR_CORNERS;
export type QrLogo = keyof typeof QR_LOGOS;
export type PosterQr = { dots: QrDots; corners: QrCorners; logo: QrLogo };
export const DEFAULT_POSTER_QR: PosterQr = {
  dots: "square",
  corners: "square",
  logo: "none",
};
export const QR_PARAMS = {
  dots: "qrDots",
  corners: "qrCorners",
  logo: "qrLogo",
} as const;
const CHOICES = { dots: QR_DOTS, corners: QR_CORNERS, logo: QR_LOGOS };

/** What /backstage/qr accepts: well inside a version-40 code, and still scannable. */
export const MAX_QR_TEXT = 1000;

/** The background value for no background. */
export const TRANSPARENT = "none";
export const DEFAULT_QR_COLORS = { ink: "#000000", bg: "#ffffff" };
/** `#rrggbb`, lowercased, or null. */
export function hexColor(value: string | null): string | null {
  const v = value?.trim().toLowerCase() ?? "";
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

export const isPlainQr = (qr: PosterQr) =>
  qr.dots === "square" && qr.corners === "square" && qr.logo === "none";

/** The QR choice in `params`, or null if any part is unknown. */
export function parsePosterQr(params: URLSearchParams): PosterQr | null {
  const qr = { ...DEFAULT_POSTER_QR };
  for (const key of Object.keys(QR_PARAMS) as (keyof PosterQr)[]) {
    const value = params.get(QR_PARAMS[key]);
    if (value === null) continue;
    if (!Object.hasOwn(CHOICES[key], value)) return null;
    (qr as Record<string, string>)[key] = value;
  }
  return qr;
}

/** Query entries for `qr`, leaving defaults out. */
export function posterQrQuery(qr: PosterQr): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(QR_PARAMS) as (keyof PosterQr)[])
      .filter((key) => qr[key] !== DEFAULT_POSTER_QR[key])
      .map((key) => [QR_PARAMS[key], qr[key]]),
  );
}

// Logo codes clear a centred, odd-sized block of modules, so it's symmetric
// about the centre module, at roughly this share of the width. Level H
// recovers ~30% of codewords.
export const LOGO_SHARE = 0.26;
/** White kept between the cleared block's edge and the logo, in modules. */
export const LOGO_PAD = 0.4;

export type QrMatrix = { size: number; get(row: number, col: number): unknown };

export function logoClearing(size: number, share = LOGO_SHARE): number {
  const n = Math.round(size * share);
  return n % 2 ? n : n + 1;
}

/** Faces (top-left, top-right, bottom-left) and pip radius of dice corners. */
export const DICE = { faces: [2, 2, 6], pip: 0.38 };

/**
 * Filled outlines for a QR code in module units (top-left of the symbol at
 * 0,0, y down, no quiet zone), matching qr-code-styling's figures. Everything
 * winds the same way so a nonzero fill unions it (die pips wind the other way
 * to cut holes). `clear` blanks a centred block of that many modules.
 */
export function qrShapes(matrix: QrMatrix, qr: PosterQr, clear = 0): Cmd[] {
  const dots = QR_DOTS[qr.dots].type;
  const count = matrix.size;
  const lo = (count - clear) / 2;
  const hi = (count + clear) / 2;
  const inEye = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);
  const visible = (r: number, c: number) =>
    r >= 0 &&
    c >= 0 &&
    r < count &&
    c < count &&
    !inEye(r, c) &&
    !(clear && r >= lo && r < hi && c >= lo && c < hi) &&
    !!matrix.get(r, c);
  const out: Cmd[] = [];
  for (let r = 0; r < count; r++)
    for (let c = 0; c < count; c++)
      if (visible(r, c))
        out.push(...dot(dots, c, r, (dx, dy) => visible(r + dy, c + dx)));
  const corners = [
    [0, 0],
    [count - 7, 0],
    [0, count - 7],
  ];
  corners.forEach(([col, row], i) => {
    out.push(
      ...eyeFrame(
        qr.corners === "square" ? "square" : "extra-rounded",
        col,
        row,
      ),
      ...(qr.corners === "dice"
        ? dieFace(DICE.faces[i], DICE.pip, col + 2, row + 2)
        : eyeCenter(
            qr.corners === "square" ? "square" : "dot",
            col + 2,
            row + 2,
          )),
    );
  });
  return out;
}

// qr-code-styling's figure primitives, unit module at (x,y).
const turned = (cmds: Cmd[], angle: number, x: number, y: number, size = 1) =>
  angle ? transform(cmds, rotation(angle, x + size / 2, y + size / 2)) : cmds;
const square = (x: number, y: number) => rect(x, y, 1, 1);
const sideRounded = (x: number, y: number, a: number) =>
  turned(
    [
      ["M", x, y],
      ["L", x, y + 1],
      ["L", x + 0.5, y + 1],
      ...arc(x + 0.5, y + 1, 0.5, 0, x + 0.5, y),
      ["Z"],
    ],
    a,
    x,
    y,
  );
const cornerExtraRounded = (x: number, y: number, a: number) =>
  turned(
    [
      ["M", x, y],
      ["L", x, y + 1],
      ["L", x + 1, y + 1],
      ...arc(x + 1, y + 1, 1, 0, x, y),
      ["Z"],
    ],
    a,
    x,
    y,
  );
const cornersRounded = (x: number, y: number, a: number) =>
  turned(
    [
      ["M", x, y],
      ["L", x, y + 0.5],
      ...arc(x, y + 0.5, 0.5, 0, x + 0.5, y + 1),
      ["L", x + 1, y + 1],
      ["L", x + 1, y + 0.5],
      ...arc(x + 1, y + 0.5, 0.5, 0, x + 0.5, y),
      ["Z"],
    ],
    a,
    x,
    y,
  );

const Q = Math.PI / 2;

type PosterDot = (typeof QR_DOTS)[QrDots]["type"];

function dot(
  type: PosterDot,
  x: number,
  y: number,
  near: (dx: number, dy: number) => boolean,
): Cmd[] {
  if (type === "square") return square(x, y);
  if (type === "dots") return circle(x + 0.5, y + 0.5, 0.5);
  const left = near(-1, 0);
  const right = near(1, 0);
  const top = near(0, -1);
  const bottom = near(0, 1);
  const n = +left + +right + +top + +bottom;
  if (type === "classy-rounded") {
    if (n === 0) return cornersRounded(x, y, Q);
    if (!left && !top) return cornerExtraRounded(x, y, -Q);
    if (!right && !bottom) return cornerExtraRounded(x, y, Q);
    return square(x, y);
  }
  if (n === 0) return circle(x + 0.5, y + 0.5, 0.5);
  if (n > 2 || (left && right) || (top && bottom)) return square(x, y);
  if (n === 2) {
    const a =
      left && top ? Q : top && right ? Math.PI : right && bottom ? -Q : 0;
    return cornerExtraRounded(x, y, a);
  }
  const a = top ? Q : right ? Math.PI : bottom ? -Q : 0;
  return sideRounded(x, y, a);
}

function eyeFrame(type: EyeType, x: number, y: number): Cmd[] {
  if (type === "square")
    return [
      ...rect(x, y, 7, 7),
      ["M", x + 1, y + 1],
      ["L", x + 6, y + 1],
      ["L", x + 6, y + 6],
      ["L", x + 1, y + 6],
      ["Z"],
    ];
  // extra-rounded: a 7-module ring with 2.5/1.5-module corner radii
  return [
    ["M", x, y + 2.5],
    ["L", x, y + 4.5],
    ...arc(x, y + 4.5, 2.5, 0, x + 2.5, y + 7),
    ["L", x + 4.5, y + 7],
    ...arc(x + 4.5, y + 7, 2.5, 0, x + 7, y + 4.5),
    ["L", x + 7, y + 2.5],
    ...arc(x + 7, y + 2.5, 2.5, 0, x + 4.5, y),
    ["L", x + 2.5, y],
    ...arc(x + 2.5, y, 2.5, 0, x, y + 2.5),
    ["Z"],
    ["M", x + 2.5, y + 1],
    ["L", x + 4.5, y + 1],
    ...arc(x + 4.5, y + 1, 1.5, 1, x + 6, y + 2.5),
    ["L", x + 6, y + 4.5],
    ...arc(x + 6, y + 4.5, 1.5, 1, x + 4.5, y + 6),
    ["L", x + 2.5, y + 6],
    ...arc(x + 2.5, y + 6, 1.5, 1, x + 1, y + 4.5),
    ["L", x + 1, y + 2.5],
    ...arc(x + 1, y + 2.5, 1.5, 1, x + 2.5, y + 1),
    ["Z"],
  ];
}

// Pip centres on the 3×3 face, spread a little past the usual quarters so
// a six's columns of three stay apart.
const LO = 0.7;
const MID = 1.5;
const HI = 2.3;
const FACES: Record<number, [number, number][]> = {
  1: [[MID, MID]],
  2: [
    [LO, LO],
    [HI, HI],
  ],
  3: [
    [LO, LO],
    [MID, MID],
    [HI, HI],
  ],
  4: [
    [LO, LO],
    [HI, LO],
    [LO, HI],
    [HI, HI],
  ],
  5: [
    [LO, LO],
    [HI, LO],
    [MID, MID],
    [LO, HI],
    [HI, HI],
  ],
  6: [
    [LO, LO],
    [LO, MID],
    [LO, HI],
    [HI, LO],
    [HI, MID],
    [HI, HI],
  ],
};

/** A solid rounded 3×3 die with its pips as holes (wound the other way). */
function dieFace(face: number, pip: number, x: number, y: number): Cmd[] {
  const r = 0.6;
  return [
    ["M", x, y + r],
    ["L", x, y + 3 - r],
    ...arc(x, y + 3 - r, r, 0, x + r, y + 3),
    ["L", x + 3 - r, y + 3],
    ...arc(x + 3 - r, y + 3, r, 0, x + 3, y + 3 - r),
    ["L", x + 3, y + r],
    ...arc(x + 3, y + r, r, 0, x + 3 - r, y),
    ["L", x + r, y],
    ...arc(x + r, y, r, 0, x, y + r),
    ["Z"],
    ...FACES[face].flatMap(([cx, cy]) => circle(x + cx, y + cy, pip, true)),
  ];
}

function eyeCenter(type: EyeDotType, x: number, y: number): Cmd[] {
  return type === "dot" ? circle(x + 1.5, y + 1.5, 1.5) : rect(x, y, 3, 3);
}
