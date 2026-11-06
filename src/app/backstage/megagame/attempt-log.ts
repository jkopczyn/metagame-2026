import { normalizeAnswer } from "@/lib/megagame-rules";

/** Decides which checker inputs to log: not blanks, and not the same answer twice in a row. */
export function attemptLog() {
  let last = "";
  return {
    take(entered: string): boolean {
      const normalized = normalizeAnswer(entered);
      if (normalized === "" || normalized === last) return false;
      last = normalized;
      return true;
    },
  };
}
