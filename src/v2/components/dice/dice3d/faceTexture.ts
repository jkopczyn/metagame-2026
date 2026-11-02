import * as THREE from "three";
import { letterSvg } from "@/v2/lib/dice-letter-paths";

// Design tokens (mirror DiceHero / the CSS dice)
export const COLORS = {
  blue: "#1ea1ff",
  orange: "#ffab3f",
  dark: "#222227",
  ink: "#141417",
  white: "#ffffff",
} as const;

// 3x3 pip grid positions (0-8). Opposite faces sum to 7; 7 = a 6-layout plus
// a center pip (renders opposite the blank).
export const PIP_MAP: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
  7: [0, 2, 3, 4, 5, 6, 8],
};

const TEX = 512; // per-face texture resolution

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = TEX;
  canvas.height = TEX;
  const ctx = canvas.getContext("2d")!;
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Letter face rasterized from the shared LETTER_PATHS glyph (same shapes as the
// LogoDice wordmark). The glyph rasterizes black, then a source-in fill repaints
// every opaque pixel in the die color while preserving alpha, so the counters
// stay transparent for the panel material's alphaTest keying.
// Async like any image load: the face starts blank and pops in onload.
// Highlight: a white copy of the glyph offset up-and-outward behind the colored
// one (mirrored per face so the implied light is consistent across the cube
// edge), peeking through the cutouts — same illusion as the LogoDice wordmark.
const LETTER_HIGHLIGHT = false;
// Cutout width / corner radius for the 3D faces (the wordmark uses 52 / 48).
export const GLYPH = { slot: 40, r: 48 };
export const HI = 8;

function tintedGlyph(img: HTMLImageElement, fill: string): HTMLCanvasElement {
  const [c, cx] = makeCanvas();
  cx.drawImage(img, HI, HI, TEX - 2 * HI, TEX - 2 * HI);
  cx.globalCompositeOperation = "source-in";
  cx.fillStyle = fill;
  cx.fillRect(0, 0, TEX, TEX);
  return c;
}

// `color` is a brand key (blue / orange) or any CSS color (dice-lab tints).
export function letterTexture(
  letter: string,
  color: string,
  onLoad?: () => void,
): THREE.CanvasTexture {
  const fill = color in COLORS ? COLORS[color as keyof typeof COLORS] : color;
  const [canvas, ctx] = makeCanvas();
  const tex = toTexture(canvas);
  const img = new Image();
  const url = URL.createObjectURL(
    new Blob([letterSvg(letter, GLYPH)], { type: "image/svg+xml" }),
  );
  img.src = url;
  img.onload = () => {
    URL.revokeObjectURL(url);
    // browser rasterizes the vector at TEX; inset by HI so the offset copy fits
    if (LETTER_HIGHLIGHT) {
      const dx = color === "blue" ? HI : -HI;
      ctx.drawImage(tintedGlyph(img, COLORS.white), dx, -HI);
    }
    ctx.drawImage(tintedGlyph(img, fill), 0, 0);
    tex.needsUpdate = true;
    onLoad?.();
  };
  return tex;
}

// A pip face for the given die value. Flat ink fill (no baked gradient, body color)
// so the panel reads as the same material as the cube — only the white pips stand out.
export function pipTexture(value: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas();
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, TEX, TEX);

  const on = PIP_MAP[value] ?? [];
  const pad = TEX * 0.22;
  const cell = (TEX - pad * 2) / 2; // gaps between the 3x3 centers
  const r = TEX * 0.095;

  for (const idx of on) {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = pad + col * cell;
    const y = pad + row * cell;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.white;
    ctx.fill();
  }

  return toTexture(canvas);
}
