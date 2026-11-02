import * as THREE from "three";
import { DICE } from "@/v2/components/dice/dice3d/Die";
import {
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
// `show` is the letter face the Arrange layout points at the camera.
export type DieSpec = { faces: Face[]; show: Show };

export const LETTERS = ["M", "E", "T", "A", "G"];
export const PIP_VALUES = [0, 1, 2, 5, 6, 7];

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

export function faceTexture(face: Face): THREE.Texture {
  return face.kind === "letter"
    ? letterTexture(face.letter, face.color)
    : pipTexture(face.value);
}

export function cloneSpec(spec: DieSpec): DieSpec {
  return { show: spec.show, faces: spec.faces.map((f) => ({ ...f })) };
}
