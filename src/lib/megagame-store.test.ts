import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Chain = Record<string, ReturnType<typeof vi.fn>> & {
  calls: unknown[][];
};

const { db } = vi.hoisted(() => {
  const queue: unknown[] = [];
  const chain = () => {
    const c: Record<string, unknown> = { calls: [] };
    for (const m of [
      "from",
      "where",
      "limit",
      "set",
      "values",
      "innerJoin",
      "leftJoin",
      "orderBy",
      "groupBy",
      "onConflictDoNothing",
      "onConflictDoUpdate",
      "returning",
    ])
      c[m] = vi.fn((...args: unknown[]) => {
        (c.calls as unknown[][]).push([m, ...args]);
        return c;
      });
    c.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve(queue.length ? queue.shift() : []).then(ok, bad);
    return c;
  };
  const db = {
    queue,
    select: vi.fn(() => chain()),
    insert: vi.fn(() => chain()),
    update: vi.fn(() => chain()),
    execute: vi.fn(async () => ({ rows: (queue.shift() as unknown[]) ?? [] })),
    batch: vi.fn(async (qs: unknown[]) => qs.map(() => queue.shift() ?? [])),
  };
  return { db };
});
vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return { getDb: () => db, schema };
});

import { schema } from "@/db";
import {
  claimedTicketHolderIds,
  liveCompletionLog,
  liveLevelEventLog,
  progressPlayers,
  completionSeries,
  completionsInClass,
  exportEventTable,
  levelEventSeries,
  recentVoids,
  confirmQuest,
  confirmationOutcome,
  ensurePlayerCode,
  findLevelEvent,
  findPlayerByCode,
  playersByIds,
  findQuestByCode,
  hasVolunteerLevelEvent,
  importQuests,
  listQuests,
  liveCompletions,
  recentConfirmations,
  recentLevelUps,
  recordLevelUp,
  recordPickerJoin,
  recordQuestAttempt,
  searchPlayers,
  voidCompletion,
  voidConfirmation,
  voidLevelEvent,
} from "./megagame-store";

const dialect = new PgDialect({ casing: "snake_case" });
const render = (q: unknown) => dialect.sqlToQuery(q as SQL).sql;

const chainOf = (mock: ReturnType<typeof vi.fn>, i: number) =>
  mock.mock.results[i].value as Chain;
const arg = (c: Chain, method: string, n = 0) =>
  c.calls.filter((call) => call[0] === method)[n]?.[1];

const queue = (...results: unknown[]) => db.queue.push(...results);

beforeEach(() => {
  vi.clearAllMocks();
  db.queue.length = 0;
});

describe("findQuestByCode", () => {
  it("does not query for an incomplete code", async () => {
    expect(await findQuestByCode("A2C")).toBeNull();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("normalizes a typed or pasted code before the lookup", async () => {
    const quest = { id: "q1", code: "A2C4EF" };
    queue([quest]);
    expect(await findQuestByCode("https://x.test/q/a2c-4ef")).toEqual(quest);
    const where = arg(chainOf(db.select, 0), "where");
    expect(dialect.sqlToQuery(where as SQL).params).toEqual(["A2C4EF"]);
  });
});

describe("listQuests", () => {
  it("returns every quest, oldest first", async () => {
    queue([{ id: "q1" }, { id: "q2" }]);
    expect(await listQuests()).toEqual([{ id: "q1" }, { id: "q2" }]);
    expect(db.select).toHaveBeenCalledTimes(1);
    const order = chainOf(db.select, 0).calls.find((c) => c[0] === "orderBy");
    expect(order?.slice(1).map(render)).toEqual([
      '"quests"."created_at" asc',
      '"quests"."code" asc',
    ]);
  });
});

describe("importQuests", () => {
  const row = (
    code: string | null,
    title: string,
    active: boolean | null = null,
  ) => ({
    code,
    title,
    class: "wizard" as const,
    kind: "answer" as const,
    answers: ["Fire"],
    evidence: null,
    hint: null,
    minLevel: 1,
    maxLevel: 2,
    active,
  });
  /** What reaches the insert: a blank active is left to the column default. */
  const inserted = (r: ReturnType<typeof row>) => {
    const { active, ...rest } = r;
    return active === null ? rest : { ...rest, active };
  };

  it("upserts rows that carry a code and counts the ones that existed", async () => {
    queue([{ code: "A2C4EF" }], []);
    expect(
      await importQuests([row("A2C4EF", "Old"), row("B3D5F7", "New")]),
    ).toEqual({ created: 1, updated: 1 });
    expect(db.insert).toHaveBeenCalledTimes(1);
    const c = chainOf(db.insert, 0);
    expect(arg(c, "values")).toStrictEqual([
      inserted(row("A2C4EF", "Old")),
      inserted(row("B3D5F7", "New")),
    ]);
    const conflict = arg(c, "onConflictDoUpdate") as {
      target: unknown;
      set: Record<string, unknown>;
    };
    expect(conflict.target).toBe(schema.quests.code);
    expect(render(conflict.set.title)).toBe("excluded.title");
    expect(render(conflict.set.minLevel)).toBe("excluded.min_level");
    expect(Object.keys(conflict.set)).not.toContain("active");
    expect(Object.keys(conflict.set)).not.toContain("code");
  });

  /** An insert whose returning() echoes back the codes `keep` lets through. */
  const freshInsert = (keep = (v: { code: string }[]) => v) =>
    db.insert.mockImplementationOnce(() => {
      const c: Record<string, unknown> = { calls: [] };
      let values: { code: string }[] = [];
      const record =
        (m: string) =>
        (...a: unknown[]) => {
          (c.calls as unknown[][]).push([m, ...a]);
          if (m === "values") values = a[0] as { code: string }[];
          if (m === "returning")
            return Promise.resolve(keep(values).map(({ code }) => ({ code })));
          return c;
        };
      for (const m of ["values", "onConflictDoNothing", "returning"])
        c[m] = vi.fn(record(m));
      return c as never;
    });

  it("gives rows without a code fresh codes in one insert", async () => {
    freshInsert();
    expect(await importQuests([row(null, "A"), row(null, "B")])).toEqual({
      created: 2,
      updated: 0,
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledTimes(1);
    const c = chainOf(db.insert, 0);
    expect(arg(c, "onConflictDoNothing")).toEqual({
      target: schema.quests.code,
    });
    const values = arg(c, "values") as { code: string; title: string }[];
    expect(values.map((v) => v.title)).toEqual(["A", "B"]);
    for (const v of values) expect(v.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(values[0].code).not.toBe(values[1].code);
  });

  it("retries only the rows whose fresh code was taken", async () => {
    freshInsert((v) => v.slice(0, 1));
    freshInsert();
    expect(await importQuests([row(null, "A"), row(null, "B")])).toEqual({
      created: 2,
      updated: 0,
    });
    expect(db.insert).toHaveBeenCalledTimes(2);
    const retry = arg(chainOf(db.insert, 1), "values") as { title: string }[];
    expect(retry.map((v) => v.title)).toEqual(["B"]);
  });

  it("gives up after five attempts", async () => {
    for (let i = 0; i < 5; i++) freshInsert(() => []);
    await expect(importQuests([row(null, "A")])).rejects.toThrow();
    expect(db.insert).toHaveBeenCalledTimes(5);
  });

  it("sets active on upsert only for rows that give it", async () => {
    queue([{ code: "A2C4EF" }, { code: "C4E6G8" }]);
    expect(
      await importQuests([
        row("A2C4EF", "Withdrawn", false),
        row("B3D5F7", "Untouched"),
        row("C4E6G8", "Back", true),
      ]),
    ).toEqual({ created: 1, updated: 2 });
    expect(db.insert).toHaveBeenCalledTimes(2);
    const withActive = chainOf(db.insert, 0);
    expect(arg(withActive, "values")).toStrictEqual([
      inserted(row("A2C4EF", "Withdrawn", false)),
      inserted(row("C4E6G8", "Back", true)),
    ]);
    const set1 = (
      arg(withActive, "onConflictDoUpdate") as { set: Record<string, unknown> }
    ).set;
    expect(render(set1.active)).toBe("excluded.active");
    const without = chainOf(db.insert, 1);
    expect(arg(without, "values")).toStrictEqual([
      inserted(row("B3D5F7", "Untouched")),
    ]);
    const set2 = (
      arg(without, "onConflictDoUpdate") as { set: Record<string, unknown> }
    ).set;
    expect(Object.keys(set2)).not.toContain("active");
  });

  it("inserts a code-less row as active unless it says otherwise", async () => {
    freshInsert();
    await importQuests([row(null, "A"), row(null, "B", false)]);
    const values = arg(chainOf(db.insert, 0), "values") as {
      active?: boolean;
    }[];
    expect(values[0]).not.toHaveProperty("active");
    expect(values[1].active).toBe(false);
  });

  it("writes nothing for an empty list", async () => {
    expect(await importQuests([])).toEqual({ created: 0, updated: 0 });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("player lookup", () => {
  it("finds a player by badge code with levels and profile fields", async () => {
    queue([
      {
        id: "u1",
        name: "Ada",
        pronouns: "she/her",
        imageUrl: null,
        wizard: 2,
        pirate: 0,
        alien: 0,
        code: "B3D5F7",
      },
    ]);
    expect(await findPlayerByCode("b3d 5f7")).toEqual({
      id: "u1",
      name: "Ada",
      pronouns: "she/her",
      imageUrl: null,
      levels: { wizard: 2, pirate: 0, alien: 0 },
      code: "B3D5F7",
    });
  });

  it("returns null for an unknown code", async () => {
    queue([]);
    expect(await findPlayerByCode("B3D5F7")).toBeNull();
  });

  it("searches names with LIKE wildcards escaped and a row limit", async () => {
    queue([]);
    await searchPlayers("  50%_a ");
    const c = chainOf(db.select, 0);
    expect(dialect.sqlToQuery(arg(c, "where") as SQL).params).toEqual([
      "%50\\%\\_a%",
    ]);
    expect(arg(c, "limit")).toBe(10);
  });

  it("does not search on fewer than two characters", async () => {
    expect(await searchPlayers(" a ")).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("playersByIds", () => {
  const row = (id: string, name: string) => ({
    id,
    name,
    pronouns: null,
    imageUrl: null,
    wizard: 1,
    pirate: 0,
    alien: 0,
    code: null,
  });

  it("skips the query for an empty list", async () => {
    expect(await playersByIds([])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns players in the order asked for, once each, dropping unknown ids", async () => {
    queue([row("u2", "Bea"), row("u1", "Ada")]);
    const players = await playersByIds(["u1", "u3", "u2", "u1"]);
    expect(players.map((p) => p.id)).toEqual(["u1", "u2"]);
    expect(players[0].levels).toEqual({ wizard: 1, pirate: 0, alien: 0 });
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.params).toEqual(["u1", "u3", "u2"]);
  });
});

describe("findLevelEvent", () => {
  it("returns the event or null", async () => {
    queue([{ id: "e1", awardedBy: "v1" }], []);
    expect(await findLevelEvent("e1")).toEqual({ id: "e1", awardedBy: "v1" });
    expect(await findLevelEvent("e2")).toBeNull();
  });
});

describe("ensurePlayerCode", () => {
  it("returns an existing code without writing", async () => {
    queue([{ code: "B3D5F7" }]);
    expect(await ensurePlayerCode("u1")).toBe("B3D5F7");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates a code when there is none", async () => {
    queue([], [{ code: "NEWCOD" }]);
    expect(await ensurePlayerCode("u1")).toBe("NEWCOD");
    expect(db.insert).toHaveBeenCalledWith(schema.playerCodes);
    const values = arg(chainOf(db.insert, 0), "values") as {
      userId: string;
      code: string;
    };
    expect(values.userId).toBe("u1");
    expect(values.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it("reads back the code a concurrent request wrote", async () => {
    queue([], [], [{ code: "OTHER1" }]);
    expect(await ensurePlayerCode("u1")).toBe("OTHER1");
  });
});

describe("confirmQuest", () => {
  const input = {
    id: "c1",
    questId: "q1",
    requestedUserIds: ["u2", "u1", "u1"],
    confirmedBy: "v1",
  };
  const row = {
    id: "c1",
    questId: "q1",
    requestedUserIds: ["u1", "u2"],
    confirmedBy: "v1",
    voidedAt: null,
  };

  it("refuses an empty player list without writing", async () => {
    expect(await confirmQuest({ ...input, requestedUserIds: [] })).toEqual({
      status: "no-players",
    });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("claims the id, inserts completions in one guarded statement, and reports each player", async () => {
    queue(
      [],
      [row],
      [{ user_id: "u1" }],
      [{ userId: "u1" }],
      [{ userId: "u2" }],
    );
    const result = await confirmQuest(input);
    expect(result).toEqual({
      status: "ok",
      confirmation: row,
      recorded: ["u1"],
      alreadyCompleted: ["u2"],
      notRecorded: [],
    });

    expect(db.insert).toHaveBeenCalledWith(schema.confirmations);
    const claim = chainOf(db.insert, 0);
    expect(arg(claim, "values")).toEqual({
      id: "c1",
      questId: "q1",
      requestedUserIds: ["u1", "u2"],
      confirmedBy: "v1",
    });
    expect(arg(claim, "onConflictDoNothing")).toEqual({
      target: schema.confirmations.id,
    });

    expect(db.execute).toHaveBeenCalledTimes(1);
    const sqlText = render(
      (db.execute.mock.calls[0] as unknown as [SQL])[0],
    ).replace(/\s+/g, " ");
    expect(sqlText).toContain("insert into quest_completions");
    expect(sqlText).toContain("unnest(c.requested_user_ids)");
    expect(sqlText).toContain('join "user" u on u.id = r.id');
    expect(sqlText).toContain("c.voided_at is null");
    // Locks the confirmation so a concurrent undo either waits for this insert
    // or is seen by it.
    expect(sqlText).toContain("for share of c");
    // A player voided out of this confirmation stays voided on a retry.
    expect(sqlText).toContain(
      "not exists (select 1 from quest_completions q where q.confirmation_id = c.id and q.user_id = u.id)",
    );
    expect(sqlText).toContain(
      "on conflict (quest_id, user_id) where voided_at is null and user_id is not null do nothing",
    );
  });

  it("is idempotent on a retry: the stored row drives the insert", async () => {
    queue([], [row], [], [{ userId: "u1" }, { userId: "u2" }]);
    const result = await confirmQuest(input);
    expect(result).toMatchObject({
      status: "ok",
      recorded: ["u1", "u2"],
      alreadyCompleted: [],
    });
  });

  it("reports players whose account is gone as not recorded", async () => {
    queue([], [row], [], [{ userId: "u1" }], []);
    expect(await confirmQuest(input)).toMatchObject({
      recorded: ["u1"],
      alreadyCompleted: [],
      notRecorded: ["u2"],
    });
  });

  it("returns voided and inserts nothing when the confirmation was undone", async () => {
    queue([], [{ ...row, voidedAt: new Date() }]);
    expect(await confirmQuest(input)).toEqual({ status: "voided" });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses a reused id whose quest differs", async () => {
    queue([], [{ ...row, questId: "q9" }]);
    expect(await confirmQuest(input)).toEqual({ status: "quest-mismatch" });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses a reused id whose players differ", async () => {
    queue([], [{ ...row, requestedUserIds: ["u1"] }]);
    expect(await confirmQuest(input)).toEqual({ status: "players-mismatch" });
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("confirmationOutcome", () => {
  it("returns null for an unknown id", async () => {
    queue([]);
    expect(await confirmationOutcome("nope")).toBeNull();
  });

  it("reports a voided confirmation as voided", async () => {
    const row = {
      id: "c1",
      questId: "q1",
      requestedUserIds: ["u1"],
      voidedAt: new Date(),
    };
    queue([row]);
    expect(await confirmationOutcome("c1")).toEqual({
      status: "voided",
      confirmation: row,
    });
  });
});

describe("voidConfirmation", () => {
  it("voids the confirmation and its completions in one batch, live rows only", async () => {
    queue([{ id: "c1" }], []);
    expect(
      await voidConfirmation({ id: "c1", voidedBy: "v1", reason: "wrong" }),
    ).toBe(true);
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenNthCalledWith(1, schema.confirmations);
    expect(db.update).toHaveBeenNthCalledWith(2, schema.questCompletions);
    for (const i of [0, 1]) {
      const c = chainOf(db.update, i);
      expect(arg(c, "set")).toMatchObject({
        voidedBy: "v1",
        voidReason: "wrong",
      });
      expect(render(arg(c, "where"))).toContain('"voided_at" is null');
    }
  });

  it("reports false when it was already voided", async () => {
    queue([], []);
    expect(
      await voidConfirmation({ id: "c1", voidedBy: "v1", reason: null }),
    ).toBe(false);
  });
});

describe("recordLevelUp", () => {
  const input = {
    id: "e1",
    userId: "u1",
    class: "wizard" as const,
    level: 2,
    awardedBy: "v1",
    checksPassed: false,
    overrideReason: "Card game won",
  };

  it("writes a volunteer event with an untargeted on-conflict, then raises the column", async () => {
    queue([{ id: "e1" }], []);
    expect(await recordLevelUp(input)).toEqual({ status: "awarded" });
    expect(db.insert).toHaveBeenCalledWith(schema.levelEvents);
    const insert = chainOf(db.insert, 0);
    expect(arg(insert, "values")).toMatchObject({
      id: "e1",
      userId: "u1",
      class: "wizard",
      level: 2,
      source: "volunteer",
      awardedBy: "v1",
      checksPassed: false,
      overrideReason: "Card game won",
    });
    expect(arg(insert, "onConflictDoNothing")).toBeUndefined();
    expect(db.update).toHaveBeenCalledWith(schema.user);
    const set = arg(chainOf(db.update, 0), "set") as Record<string, unknown>;
    expect(Object.keys(set)).toEqual(["wizardLevel"]);
    expect(render(set.wizardLevel)).toBe('greatest("user"."wizard_level", $1)');
  });

  it("treats a retry of the same event as success and repairs the column", async () => {
    queue(
      [],
      [{ id: "e1", userId: "u1", class: "wizard", level: 2, voidedAt: null }],
      [],
    );
    expect(await recordLevelUp(input)).toEqual({ status: "retry" });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("refuses a reused id with different values", async () => {
    queue(
      [],
      [{ id: "e1", userId: "u1", class: "pirate", level: 2, voidedAt: null }],
    );
    expect(await recordLevelUp(input)).toEqual({ status: "id-reused" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("reports a retry of an undone event as voided without touching the column", async () => {
    queue(
      [],
      [
        {
          id: "e1",
          userId: "u1",
          class: "wizard",
          level: 2,
          voidedAt: new Date(),
        },
      ],
    );
    expect(await recordLevelUp(input)).toEqual({ status: "voided" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("reports a level that another event already awarded", async () => {
    queue([], []);
    expect(await recordLevelUp(input)).toEqual({ status: "already-awarded" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses a level outside 1 to the maximum without writing", async () => {
    expect(await recordLevelUp({ ...input, level: 6 })).toEqual({
      status: "invalid",
    });
    expect(await recordLevelUp({ ...input, level: 0 })).toEqual({
      status: "invalid",
    });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("recordQuestAttempt", () => {
  it("inserts one attempt row", async () => {
    await recordQuestAttempt({
      questId: "q1",
      enteredBy: "v1",
      enteredAnswer: "Fire!",
      correct: true,
    });
    expect(db.insert).toHaveBeenCalledWith(schema.questAttempts);
    expect(arg(chainOf(db.insert, 0), "values")).toEqual({
      questId: "q1",
      enteredBy: "v1",
      enteredAnswer: "Fire!",
      correct: true,
    });
  });
});

describe("voidLevelEvent", () => {
  it("voids a volunteer event and recomputes that class in SQL, then repairs upward", async () => {
    queue([{ userId: "u1", class: "wizard" }], [], [{ level: 2 }]);
    expect(
      await voidLevelEvent({ id: "e3", voidedBy: "v1", reason: "typo" }),
    ).toEqual({ status: "voided", level: 2 });
    const where = render(arg(chainOf(db.update, 0), "where"));
    expect(where).toContain('"level_events"."voided_at" is null');
    expect(where).toContain('"level_events"."source" = $');

    expect(db.update).toHaveBeenCalledTimes(3);
    const recompute = arg(chainOf(db.update, 1), "set") as Record<string, SQL>;
    expect(Object.keys(recompute)).toEqual(["wizardLevel"]);
    const recomputeSql = render(recompute.wizardLevel);
    expect(recomputeSql).toContain('max("level_events"."level")');
    expect(recomputeSql).toContain('"level_events"."voided_at" is null');
    expect(recomputeSql).not.toContain("greatest");

    // A second statement with a fresh snapshot can only raise the column, so
    // an award that committed while the recompute ran is not lost.
    const repair = arg(chainOf(db.update, 2), "set") as Record<string, SQL>;
    expect(Object.keys(repair)).toEqual(["wizardLevel"]);
    const repairSql = render(repair.wizardLevel);
    expect(repairSql).toContain('greatest("user"."wizard_level"');
    expect(repairSql).toContain('max("level_events"."level")');
  });

  it("reports 0 when no live event remains", async () => {
    queue([{ userId: "u1", class: "alien" }], [], [{ level: 0 }]);
    expect(
      await voidLevelEvent({ id: "e3", voidedBy: "v1", reason: null }),
    ).toEqual({ status: "voided", level: 0 });
    expect(Object.keys(arg(chainOf(db.update, 1), "set") as object)).toEqual([
      "alienLevel",
    ]);
  });

  it("recomputes again on a repeated undo, which repairs a crash between the two writes", async () => {
    queue(
      [],
      [
        {
          userId: "u1",
          class: "wizard",
          source: "volunteer",
          voidedAt: new Date(),
        },
      ],
      [],
      [{ level: 1 }],
    );
    expect(
      await voidLevelEvent({ id: "e3", voidedBy: "v1", reason: null }),
    ).toEqual({ status: "already-voided", level: 1 });
    expect(db.update).toHaveBeenCalledTimes(3);
  });

  it("refuses to void a picker event", async () => {
    queue(
      [],
      [{ userId: "u1", class: "wizard", source: "picker", voidedAt: null }],
    );
    expect(
      await voidLevelEvent({ id: "e3", voidedBy: "v1", reason: null }),
    ).toEqual({ status: "not-volunteer" });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown event", async () => {
    queue([], []);
    expect(
      await voidLevelEvent({ id: "e3", voidedBy: "v1", reason: null }),
    ).toEqual({ status: "not-found" });
  });
});

describe("recordPickerJoin", () => {
  it("voids earlier picker joins in other classes and writes the new join in one batch", async () => {
    queue([], []);
    await recordPickerJoin("u1", "pirate");
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledWith(schema.levelEvents);
    const update = chainOf(db.update, 0);
    expect(arg(update, "set")).toMatchObject({
      voidedBy: "u1",
      voidReason: "Switched class on /account",
    });
    const where = dialect.sqlToQuery(arg(update, "where") as SQL);
    expect(where.sql).toContain('"level_events"."source" = $');
    expect(where.sql).toContain('"level_events"."class" <> $');
    expect(where.sql).toContain('"level_events"."voided_at" is null');
    expect(where.params).toEqual(["u1", "picker", "pirate"]);

    const insert = chainOf(db.insert, 0);
    expect(arg(insert, "values")).toMatchObject({
      userId: "u1",
      class: "pirate",
      level: 1,
      source: "picker",
      awardedBy: "u1",
      checksPassed: true,
    });
    expect((arg(insert, "values") as { id: string }).id.length).toBeGreaterThan(
      0,
    );
    expect(insert.calls.map((c) => c[0])).toContain("onConflictDoNothing");
  });
});

describe("hasVolunteerLevelEvent", () => {
  it("looks only at live volunteer events", async () => {
    queue([{ id: "e1" }]);
    expect(await hasVolunteerLevelEvent("u1")).toBe(true);
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.sql).toContain('"level_events"."voided_at" is null');
    expect(where.params).toEqual(["u1", "volunteer"]);
  });

  it("is false with none", async () => {
    queue([]);
    expect(await hasVolunteerLevelEvent("u1")).toBe(false);
  });
});

describe("completion reads", () => {
  it("voids one completion only while it is live", async () => {
    queue([{ id: "k1" }]);
    expect(
      await voidCompletion({ id: "k1", voidedBy: "m1", reason: "dup" }),
    ).toBe(true);
    expect(db.update).toHaveBeenCalledWith(schema.questCompletions);
    expect(render(arg(chainOf(db.update, 0), "where"))).toContain(
      '"quest_completions"."voided_at" is null',
    );
  });

  it("skips the query for an empty player list", async () => {
    expect(await liveCompletions("q1", [])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns live completions for the listed players", async () => {
    const at = new Date();
    queue([
      {
        id: "k1",
        userId: "u1",
        confirmationId: "c1",
        confirmedAt: at,
        confirmedByName: "Vol",
      },
    ]);
    expect(await liveCompletions("q1", ["u1", "u2"])).toHaveLength(1);
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.params).toEqual(["q1", "u1", "u2"]);
    expect(where.sql).toContain('"quest_completions"."voided_at" is null');
  });

  it("counts live completions of quests in one class", async () => {
    queue([{ n: 3 }]);
    expect(await completionsInClass("u1", "wizard")).toBe(3);
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.params).toEqual(["u1", "wizard"]);
  });
});

describe("recentConfirmations", () => {
  it("counts the completions a confirmation recorded, not the players requested", async () => {
    queue([]);
    await recentConfirmations("v1");
    const fields = (
      db.select.mock.calls[0] as unknown as [{ players: SQL }]
    )[0];
    const players = render(fields.players);
    expect(players).not.toContain("cardinality");
    expect(players).toContain("from quest_completions q");
    expect(players).toContain('q.confirmation_id = "confirmations"."id"');
  });

  it("filters to one volunteer when given one", async () => {
    queue([]);
    await recentConfirmations("v1");
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.sql).toContain('"confirmations"."confirmed_by" = $');
    expect(where.params).toEqual(["v1"]);
  });

  it("lists every volunteer's confirmations with who made them when given null", async () => {
    queue([]);
    await recentConfirmations(null, 30);
    const c = chainOf(db.select, 0);
    expect(arg(c, "where")).toBeUndefined();
    expect(arg(c, "limit")).toBe(30);
    const fields = (
      db.select.mock.calls[0] as unknown as [Record<string, unknown>]
    )[0];
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["confirmedBy", "confirmedByName"]),
    );
  });
});

describe("recentLevelUps", () => {
  it("lists live and voided volunteer level-ups from every volunteer, newest first", async () => {
    queue([]);
    await recentLevelUps(30);
    const c = chainOf(db.select, 0);
    const where = dialect.sqlToQuery(arg(c, "where") as SQL);
    expect(where.sql).toContain('"level_events"."source" = $');
    expect(where.params).toEqual(["volunteer"]);
    expect(where.sql).not.toContain("voided_at");
    expect(render(arg(c, "orderBy"))).toContain(
      '"level_events"."awarded_at" desc',
    );
    expect(arg(c, "limit")).toBe(30);
  });
});

describe("liveCompletionLog", () => {
  it("reads every live completion with its quest's class", async () => {
    const at = new Date("2026-11-06T18:00:00.000Z");
    queue([{ userId: null, class: "wizard", confirmedAt: at }]);
    expect(await liveCompletionLog()).toEqual([
      { userId: null, class: "wizard", confirmedAt: at },
    ]);
    const c = chainOf(db.select, 0);
    expect(c.calls.find((call) => call[0] === "innerJoin")?.[1]).toBe(
      schema.quests,
    );
    const where = render(arg(c, "where"));
    expect(where).toBe('"quest_completions"."voided_at" is null');
  });
});

describe("liveLevelEventLog", () => {
  it("reads every live level event, deleted accounts included", async () => {
    queue([]);
    await liveLevelEventLog();
    const where = render(arg(chainOf(db.select, 0), "where"));
    expect(where).toBe('"level_events"."voided_at" is null');
    const fields = Object.keys(
      (db.select.mock.calls[0] as unknown as [Record<string, unknown>])[0],
    );
    expect(fields).toEqual(["userId", "class", "level", "source", "awardedAt"]);
  });
});

describe("progressPlayers", () => {
  it("reads players in any class plus the given ids, once each", async () => {
    queue([{ id: "u1", name: "Ada", wizard: 2, pirate: 0, alien: 1 }]);
    expect(await progressPlayers(["u1", "u1", "u2"])).toEqual([
      { id: "u1", name: "Ada", levels: { wizard: 2, pirate: 0, alien: 1 } },
    ]);
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.sql).toContain('"user"."wizard_level" > $');
    expect(where.sql).toContain('"user"."id" in ($');
    expect(where.params).toEqual([0, 0, 0, "u1", "u2"]);
  });

  it("skips the id list when there are no ids", async () => {
    queue([]);
    await progressPlayers([]);
    const where = render(arg(chainOf(db.select, 0), "where"));
    expect(where).not.toContain('"user"."id" in');
  });
});

describe("claimedTicketHolderIds", () => {
  it("lists distinct owners of paid tickets", async () => {
    queue([{ id: "u1" }, { id: null }, { id: "u2" }]);
    expect(await claimedTicketHolderIds()).toEqual(["u1", "u2"]);
    const c = chainOf(db.select, 0);
    const where = dialect.sqlToQuery(arg(c, "where") as SQL);
    expect(where.sql).toContain('"tickets"."owner_user_id" is not null');
    expect(where.params).toContain("paid");
    expect(c.calls.some((call) => call[0] === "groupBy")).toBe(true);
  });
});

describe("completionSeries", () => {
  const from = new Date("2026-11-07T08:00:00.000Z");
  const to = new Date("2026-11-07T18:07:00.000Z");

  it("refuses a bucket size outside the whitelist before querying", async () => {
    await expect(completionSeries("2h", from, to)).rejects.toThrow();
    await expect(
      completionSeries("1 hour'); drop table quests; --", from, to),
    ).rejects.toThrow();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("bins live completions with date_bin from the shared origin", async () => {
    queue([{ bucket: "2026-11-07T10:00:00.000Z", class: "wizard", n: 2 }]);
    const rows = await completionSeries("1h", from, to);
    expect(rows).toEqual([
      { bucket: new Date("2026-11-07T10:00:00.000Z"), class: "wizard", n: 2 },
    ]);
    const fields = (db.select.mock.calls[0] as unknown as [{ bucket: SQL }])[0];
    const bucket = dialect.sqlToQuery(fields.bucket);
    expect(bucket.sql).toBe(
      'date_bin($1::interval, "quest_completions"."confirmed_at", $2::timestamptz)',
    );
    expect(bucket.params).toEqual(["1 hour", "2026-01-01T08:00:00.000Z"]);
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.sql).toContain('"quest_completions"."voided_at" is null');
    expect(where.sql).toContain('"quest_completions"."confirmed_at" >= $');
    expect(where.sql).toContain('"quest_completions"."confirmed_at" < $');
    expect(where.params).toEqual([from.toISOString(), to.toISOString()]);
  });
});

describe("levelEventSeries", () => {
  it("bins live level events by class and source", async () => {
    queue([
      {
        bucket: "2026-11-07T10:00:00.000Z",
        class: "pirate",
        source: "volunteer",
        n: 1,
      },
    ]);
    const rows = await levelEventSeries(
      "15m",
      new Date("2026-11-07T08:00:00.000Z"),
      new Date("2026-11-07T18:00:00.000Z"),
    );
    expect(rows[0].bucket).toEqual(new Date("2026-11-07T10:00:00.000Z"));
    const fields = (db.select.mock.calls[0] as unknown as [{ bucket: SQL }])[0];
    expect(dialect.sqlToQuery(fields.bucket).params[0]).toBe("15 minutes");
    expect(render(arg(chainOf(db.select, 0), "where"))).toContain(
      '"level_events"."voided_at" is null',
    );
  });
});

describe("recentVoids", () => {
  it("merges voided confirmations, single completions and level-ups, newest first", async () => {
    const t = (m: number) => new Date(Date.UTC(2026, 10, 7, 10, m));
    queue(
      [{ id: "c1", kind: "confirmation", voidedAt: t(1) }],
      [{ id: "qc1", kind: "completion", voidedAt: t(3) }],
      [{ id: "l1", kind: "level", voidedAt: t(2) }],
    );
    const rows = await recentVoids(2);
    expect(rows.map((r) => r.id)).toEqual(["qc1", "l1"]);
    const completionWhere = render(arg(chainOf(db.select, 1), "where"));
    expect(completionWhere).toContain(
      '"quest_completions"."voided_at" is not null',
    );
    expect(completionWhere).toContain(
      '("confirmations"."voided_at" is null or "quest_completions"."voided_at" < "confirmations"."voided_at")',
    );
    const levelWhere = dialect.sqlToQuery(
      arg(chainOf(db.select, 2), "where") as SQL,
    );
    expect(levelWhere.sql).toContain('"level_events"."voided_at" is not null');
    expect(levelWhere.params).toEqual(["volunteer"]);
  });
});

describe("exportEventTable", () => {
  it("exports every confirmation, voided ones included, oldest first", async () => {
    const at = new Date("2026-11-07T10:00:00.000Z");
    queue([
      {
        id: "c1",
        questId: "q1",
        requestedUserIds: ["u1"],
        confirmedBy: "v1",
        createdAt: at,
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
      },
    ]);
    const out = await exportEventTable("confirmations");
    expect(out.columns).toEqual([
      "id",
      "quest_id",
      "requested_user_ids",
      "confirmed_by",
      "created_at",
      "voided_at",
      "voided_by",
      "void_reason",
    ]);
    expect(out.rows).toEqual([
      ["c1", "q1", ["u1"], "v1", at, null, null, null],
    ]);
    const c = chainOf(db.select, 0);
    expect(c.calls.some((call) => call[0] === "where")).toBe(false);
  });

  it("exports only the table's own columns, with nothing joined in", async () => {
    queue([], [], []);
    const outs = [
      await exportEventTable("confirmations"),
      await exportEventTable("quest_completions"),
      await exportEventTable("level_events"),
    ];
    for (const i of [0, 1, 2]) {
      const c = chainOf(db.select, i);
      expect(
        c.calls.some(
          (call) => call[0] === "innerJoin" || call[0] === "leftJoin",
        ),
      ).toBe(false);
    }
    for (const out of outs) {
      expect(out.columns.filter((k) => k.endsWith("_name"))).toEqual([]);
      expect(out.columns).not.toContain("quest_code");
    }
    expect(outs[1].columns).toContain("confirmation_id");
    expect(outs[2].columns).toContain("override_reason");
    expect(outs[2].columns).toContain("source");
  });
});
