import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, store } = vi.hoisted(() => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "set", "values"])
      c[m] = vi.fn(() => c);
    c.onConflictDoNothing = vi.fn(async () => undefined);
    c.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(ok, bad);
    return c;
  };
  const state = {
    executeRows: [] as unknown[],
    selects: [] as unknown[][],
  };
  const db = {
    state,
    execute: vi.fn(async () => ({ rows: state.executeRows })),
    select: vi.fn(() => chain(() => state.selects.shift() ?? [])),
    update: vi.fn(() => chain(() => undefined)),
    insert: vi.fn(() => chain(() => undefined)),
  };
  const store = {
    ensureAccount: vi.fn(async (name: string, email: string) => ({
      userId: `id:${email}`,
      name,
      email,
    })),
    findAccount: vi.fn<(email: string) => Promise<unknown>>(async () => null),
    invalidateSchedule: vi.fn(),
    sessionIdBySlug: vi.fn<(slug: string) => Promise<string | null>>(
      async () => null,
    ),
  };
  return { db, store };
});
vi.mock("@/db", () => ({ getDb: () => db }));
vi.mock("./schedule-store", () => store);

import { intakeRfp } from "./rfp-intake-store";

const REC = "recAbCdEfGhIjKlMn";
const fields = {
  Title: "Hidden Roles",
  Category: ["Workshop"],
  "Maximum size": 20,
  "Space needs": "Tables",
  "Speaker tier": "Gold tier",
  Host: "Alex Doe",
  "Email (host)": "alex@example.com",
  "Discord (host)": "@alexdoe",
};

const setCalls = () =>
  db.update.mock.results.map(
    (r) => (r.value.set as ReturnType<typeof vi.fn>).mock.calls[0][0],
  );

describe("intakeRfp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.state.executeRows = [];
    db.state.selects = [];
  });

  it("creates a draft with its host when the record is new", async () => {
    db.state.executeRows = [{ id: "s1", slug: "hidden-roles" }];
    const result = await intakeRfp(REC, fields);
    expect(result).toEqual({
      sessionId: "s1",
      slug: "hidden-roles",
      created: true,
      filled: [],
      hostUserId: "id:alex@example.com",
      warnings: ['Speaker tier: unknown option "Gold tier"'],
    });
    expect(store.ensureAccount).toHaveBeenCalledWith(
      "Alex Doe",
      "alex@example.com",
    );
    expect(store.invalidateSchedule).toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(setCalls()).toEqual([{ discordHandle: "alexdoe" }]);
  });

  it("suffixes the slug with the record id when it's taken", async () => {
    store.sessionIdBySlug.mockResolvedValueOnce("other");
    db.state.executeRows = [{ id: "s1", slug: "hidden-roles-jklmn" }];
    await intakeRfp(REC, fields);
    const query = db.execute.mock.calls[0] as unknown as [
      { queryChunks: unknown[] },
    ];
    expect(JSON.stringify(query[0].queryChunks)).toContain(
      "hidden-roles-jklmn",
    );
  });

  it("only fills empty columns when the session already exists", async () => {
    db.state.selects = [
      [
        {
          id: "s1",
          slug: "hidden-roles",
          description: null,
          category: "game",
          needs: null,
          maxCapacity: null,
          minCapacity: null,
          phase: "deciding",
          marketingConsent: true,
        },
      ],
      [{ userId: "someone" }],
    ];
    const result = await intakeRfp(REC, fields);
    expect(result).toMatchObject({
      sessionId: "s1",
      created: false,
      filled: ["needs", "maxCapacity"],
    });
    expect(setCalls()).toEqual([
      { discordHandle: "alexdoe" },
      { needs: "Tables", maxCapacity: 20 },
    ]);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("links the host to an existing session that has none", async () => {
    db.state.selects = [
      [{ id: "s1", slug: "hidden-roles", category: "workshop", needs: "x" }],
      [],
    ];
    const result = await intakeRfp(REC, { ...fields, "Maximum size": null });
    expect(result.filled).toContain("host");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("maps an alias to the account that exists, never creating Ricki's", async () => {
    db.state.executeRows = [{ id: "s1", slug: "x" }];
    const result = await intakeRfp(REC, {
      ...fields,
      "Email (host)": "ricki@trading.camp",
    });
    expect(store.ensureAccount).not.toHaveBeenCalled();
    expect(result.hostUserId).toBeNull();
    expect(result.warnings).toContain(
      "No account for ricki@metagame.games; no host linked.",
    );

    store.findAccount.mockImplementation(async (email: string) =>
      email === "caseyjonescaseyjones@gmail.com" ? { userId: "casey" } : null,
    );
    await intakeRfp(REC, {
      ...fields,
      "Email (host)": "casey@slaydiumgames.com",
    });
    expect(store.ensureAccount).toHaveBeenCalledWith(
      "Alex Doe",
      "caseyjonescaseyjones@gmail.com",
    );
  });
});
