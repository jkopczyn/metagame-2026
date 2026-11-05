// The in-progress player list is the `players` query parameter, so a reload,
// a tab switch or a camera detour keeps it.

export const MAX_LIST = 40;

export function parsePlayerIds(param: string | string[] | undefined): string[] {
  const raw = Array.isArray(param) ? param[0] : param;
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(ids)].slice(0, MAX_LIST);
}

export const withPlayer = (ids: readonly string[], id: string) =>
  ids.includes(id) ? [...ids] : [...ids, id].slice(0, MAX_LIST);

export const withoutPlayer = (ids: readonly string[], id: string) =>
  ids.filter((x) => x !== id);

/** Holds adds made before the URL catches up, so quick scans do not drop each other. */
export function listQueue() {
  let pending: string[] | null = null;
  return {
    add(ids: readonly string[], id: string): string[] {
      pending = withPlayer(pending ?? ids, id);
      return pending;
    },
    current(ids: readonly string[]): string[] {
      return pending ?? [...ids];
    },
    settle() {
      pending = null;
    },
  };
}
