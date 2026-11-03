// A fake Hat Tricks weekend for tests and .env.example. It is shaped like a
// weekend on purpose and must never be edited to resemble the event's
// schedule, which exists only in the HAT_TRICKS_SCHEDULE env var.

import { HAT_IDS, type HatId } from "./hat-tricks-hats";

export type RawShift = { start: string; end: string; hats: HatId[] };

// Friday 2020-01-03 00:00 at offset -08:00.
const BASE_MS = Date.UTC(2020, 0, 3, 8, 0, 0);
const OFFSET_MS = -8 * 60 * 60 * 1000;

function iso(minutesFromBase: number): string {
  const wall = new Date(BASE_MS + minutesFromBase * 60_000 + OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
    "T",
    `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:00`,
    "-08:00",
  ].join("");
}

const h = (hours: number) => hours * 60;

const BLOCKS: { from: number; to: number; lengthMin: number }[] = [
  { from: h(14), to: h(22), lengthMin: 240 }, // Fri 14:00-22:00, 4 h
  { from: h(22), to: h(28), lengthMin: 360 }, // Fri 22:00-Sat 04:00, overnight
  { from: h(32), to: h(46), lengthMin: 120 }, // Sat 08:00-22:00, 2 h
  { from: h(46), to: h(52), lengthMin: 360 }, // Sat 22:00-Sun 04:00, overnight
  { from: h(57), to: h(61), lengthMin: 20 }, // Sun 09:00-13:00, 20 min
];

function hatsFor(index: number): HatId[] {
  const hats: HatId[] = [HAT_IDS[index % HAT_IDS.length]];
  if (index % 3 === 2) hats.push(HAT_IDS[(index + 3) % HAT_IDS.length]);
  return hats;
}

function buildShifts(): RawShift[] {
  const shifts: RawShift[] = [];
  for (const block of BLOCKS) {
    for (let at = block.from; at < block.to; at += block.lengthMin) {
      shifts.push({
        start: iso(at),
        end: iso(at + block.lengthMin),
        hats: hatsFor(shifts.length),
      });
    }
  }
  return shifts;
}

export const DECOY_SHIFTS: RawShift[] = buildShifts();

export const DECOY_JSON: string = JSON.stringify(DECOY_SHIFTS);
