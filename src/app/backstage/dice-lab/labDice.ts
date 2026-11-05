import * as THREE from "three";
import { DICE } from "@/v2/components/dice/dice3d/Die";
import {
  COLORS,
  letterTexture,
  pipTexture,
} from "@/v2/components/dice/dice3d/faceTexture";
import type { Show } from "./labLayout";

// What's printed on one face of a lab die. Letters are the five METAGAME glyphs
// in a brand color (or any CSS color); pips are a d6 value (0 = blank ink).
export type Face =
  | { kind: "letter"; letter: string; color: string }
  | { kind: "pips"; value: number };

// Six faces in the hero's FACES order.
export const FACE_NAMES = [
  "front",
  "back",
  "right",
  "left",
  "top",
  "bottom",
] as const;
// `show` is the face the Arrange layout points at the camera; `body` is the
// cube's color (brand key or CSS color), ink when absent.
export type DieSpec = { faces: Face[]; show: Show; body?: string };

export function resolveColor(color: string): string {
  return color in COLORS ? COLORS[color as keyof typeof COLORS] : color;
}
export function bodyColor(spec: DieSpec): string {
  return resolveColor(spec.body ?? "ink");
}

export const LETTERS = ["M", "E", "T", "A", "G"];
export const PIP_VALUES = [0, 1, 2, 5, 6, 7];
// Digits a pip face can stand in for (7 is the 6-plus-center oddity, not a digit).
const DIGITS = [0, 1, 2, 5, 6];

// Dice spelling a message, one per character: letters show their front face,
// digits their top pips. Existing dice keep their other faces; new ones start
// as hero dice. Rows break at newlines (via `perRow`); unsupported characters
// are dropped and reported so the caller can say which.
export function spellDice(
  text: string,
  existing: DieSpec[],
  max: number,
): { dice: DieSpec[]; perRow: number; unsupported: string[] } {
  const dice: DieSpec[] = [];
  const unsupported: string[] = [];
  let perRow = 0;
  for (const line of text.split("\n")) {
    let inRow = 0;
    for (const raw of line) {
      const ch = raw.toUpperCase();
      if (ch.trim() === "") continue;
      const i = dice.length;
      if (i >= max) {
        unsupported.push(ch);
        continue;
      }
      // new dice cycle through the hero set so their pips vary
      const hero = DICE[i % DICE.length];
      const base = existing[i]
        ? cloneSpec(existing[i])
        : heroDie(hero.front, hero.right, hero.top);
      if (LETTERS.includes(ch)) {
        const prev = base.faces[0];
        const color = prev.kind === "letter" ? prev.color : "blue";
        base.faces[0] = { kind: "letter", letter: ch, color };
        base.faces[1] = { ...base.faces[0] };
        base.show = "front";
      } else if (DIGITS.includes(Number(ch))) {
        const value = Number(ch);
        base.faces[4] = { kind: "pips", value };
        base.faces[5] = { kind: "pips", value: 7 - value };
        base.show = "top";
      } else {
        unsupported.push(ch);
        continue;
      }
      dice.push(base);
      inRow++;
    }
    perRow = Math.max(perRow, inRow);
  }
  return { dice, perRow, unsupported };
}

// Every letter face on the given dice repainted in one color.
export function recolorLetters(
  dice: DieSpec[],
  color: string,
  pick: (i: number) => boolean,
): DieSpec[] {
  return dice.map((d, i) => {
    if (!pick(i)) return d;
    const c = cloneSpec(d);
    c.faces = c.faces.map((f) => (f.kind === "letter" ? { ...f, color } : f));
    return c;
  });
}

// A hero die: letter on front+back (blue), another on right+left (orange),
// pips top with the complementary value underneath.
export function heroDie(
  front: string,
  right: string,
  top: number,
  colors: { front: string; right: string } = {
    front: "blue",
    right: "orange",
  },
  show: Show = "front",
): DieSpec {
  return {
    show,
    faces: [
      { kind: "letter", letter: front, color: colors.front },
      { kind: "letter", letter: front, color: colors.front },
      { kind: "letter", letter: right, color: colors.right },
      { kind: "letter", letter: right, color: colors.right },
      { kind: "pips", value: top },
      { kind: "pips", value: 7 - top },
    ],
  };
}

export const PRESETS: { name: string; dice: DieSpec[] }[] = [
  {
    // the hero's four dice twice: blue faces spell META, orange faces GAME
    name: "METAGAME (two rows)",
    dice: [
      ...DICE.map((d) => heroDie(d.front, d.right, d.top)),
      ...DICE.map((d) => heroDie(d.front, d.right, d.top, undefined, "right")),
    ],
  },
  {
    name: "Hero (META / GAME / 2026)",
    dice: DICE.map((d) => heroDie(d.front, d.right, d.top)),
  },
  {
    name: "METAGAME edge-on",
    dice: [
      heroDie("M", "E", 2, { front: "blue", right: "blue" }),
      heroDie("T", "A", 0, { front: "blue", right: "blue" }),
      heroDie("G", "A", 2, { front: "orange", right: "orange" }),
      heroDie("M", "E", 6, { front: "orange", right: "orange" }),
    ],
  },
  {
    name: "Single die",
    dice: [heroDie("M", "G", 2)],
  },
];

export function faceTexture(face: Face, spec: DieSpec): THREE.Texture {
  return face.kind === "letter"
    ? letterTexture(face.letter, face.color)
    : pipTexture(face.value, bodyColor(spec));
}

export function cloneSpec(spec: DieSpec): DieSpec {
  return { ...spec, faces: spec.faces.map((f) => ({ ...f })) };
}

export function recolorBodies(
  dice: DieSpec[],
  color: string,
  pick: (i: number) => boolean,
): DieSpec[] {
  return dice.map((d, i) => (pick(i) ? { ...cloneSpec(d), body: color } : d));
}
