import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleSnapshot } from "@/app/(v2)/schedule/data";
import { MIN_ATTEMPT_GAP_MS, STALE_AFTER_MS } from "@/lib/schedule-freshness";

// No DOM in these tests: effects run on the spot and the browser is stubbed.
vi.mock("react", () => ({
  startTransition: (run: () => void) => run(),
  useEffect: (run: () => void) => run(),
  useRef: <T>(current: T) => ({ current }),
}));
vi.mock("./NoteBoard", () => ({
  noteWritesInFlight: () => 0,
  noteWritesStarted: () => 0,
}));

type Reply = { ok: boolean; json: () => Promise<unknown> };

const T0 = 10_000_000;
const snapshot = (name: string) => ({ name }) as unknown as ScheduleSnapshot;

let reads: { resolve: (r: Reply) => void }[];
let returnToTab: () => void;

async function mount() {
  // Fresh module: the attempt clock is per page load.
  vi.resetModules();
  const { useScheduleFreshness: runHook } =
    await import("./useScheduleFreshness");
  const applied: ScheduleSnapshot[] = [];
  runHook(T0, (s) => applied.push(s));
  return applied;
}

const respond = async (index: number, body: ScheduleSnapshot) => {
  reads[index].resolve({ ok: true, json: async () => body });
  await vi.advanceTimersByTimeAsync(0);
};

const startSecondRead = async () => {
  vi.advanceTimersByTime(MIN_ATTEMPT_GAP_MS);
  returnToTab();
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toHaveLength(2);
};

describe("useScheduleFreshness with overlapping reads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + STALE_AFTER_MS);
    reads = [];
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("window", { addEventListener: () => {} });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      querySelector: () => null,
      addEventListener: (_: string, listener: () => void) => {
        returnToTab = listener;
      },
    });
    vi.stubGlobal(
      "fetch",
      () => new Promise((resolve) => reads.push({ resolve })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("drops an older response that lands after a newer one", async () => {
    const applied = await mount();
    await startSecondRead();

    await respond(1, snapshot("newer"));
    await respond(0, snapshot("older"));

    expect(applied).toEqual([snapshot("newer")]);
  });

  it("applies the newer response when the two land in order", async () => {
    const applied = await mount();
    await startSecondRead();

    await respond(0, snapshot("older"));
    await respond(1, snapshot("newer"));

    expect(applied).toEqual([snapshot("newer")]);
  });
});
