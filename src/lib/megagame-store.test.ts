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
  completionSeries,
  completionsInClass,
  completionsByIds,
  confirmCompletions,
  findLevelEvent,
  findPlayerByBadgeNumber,
  findQuestByCode,
  hasVolunteerLevelEvent,
  levelEventSeries,
  liveCompletions,
  playersByIds,
  recentCompletions,
  recentLevelUps,
  recentVoids,
  recordLevelUp,
  recordPickerJoin,
  recordQuestAttempt,
  searchPlayers,
  undoCompletions,
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

describe("player lookup", () => {
  it("finds a player by badge number with levels and profile fields", async () => {
    queue([
      {
        id: "u1",
        name: "Ada",
        pronouns: "she/her",
        imageUrl: null,
        wizard: 2,
        pirate: 0,
        alien: 0,
      },
    ]);
    expect(await findPlayerByBadgeNumber(42)).toEqual({
      id: "u1",
      name: "Ada",
      pronouns: "she/her",
      imageUrl: null,
      levels: { wizard: 2, pirate: 0, alien: 0 },
    });
    const c = chainOf(db.select, 0);
    expect(arg(c, "from")).toBe(schema.tickets);
    const where = dialect.sqlToQuery(arg(c, "where") as SQL);
    expect(where.sql).toContain('"tickets"."badge_code" = $');
    expect(where.params).toEqual([42]);
  });

  it("returns null for an unknown badge number", async () => {
    queue([]);
    expect(await findPlayerByBadgeNumber(42)).toBeNull();
  });

  it("does not query for a number no badge can carry", async () => {
    expect(await findPlayerByBadgeNumber(-1)).toBeNull();
    expect(await findPlayerByBadgeNumber(10000)).toBeNull();
    expect(await findPlayerByBadgeNumber(4.2)).toBeNull();
    expect(db.select).not.toHaveBeenCalled();
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
  const row = (id: string, name: string, wizard: number | null = 1) => ({
    id,
    name,
    pronouns: null,
    imageUrl: null,
    wizard,
    pirate: null,
    alien: null,
  });

  it("skips the query for an empty list", async () => {
    expect(await playersByIds([])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns players in the order asked for, once each, dropping unknown ids", async () => {
    queue([row("u2", "Bea", null), row("u1", "Ada")]);
    const players = await playersByIds(["u1", "u3", "u2", "u1"]);
    expect(players.map((p) => p.id)).toEqual(["u1", "u2"]);
    expect(players[0].levels).toEqual({ wizard: 1, pirate: 0, alien: 0 });
    // No profile row yet reads as level 0 everywhere.
    expect(players[1].levels).toEqual({ wizard: 0, pirate: 0, alien: 0 });
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

describe("confirmCompletions", () => {
  const input = {
    questId: "q1",
    userIds: ["u2", "u1", "u1"],
    confirmedBy: "v1",
  };

  it("refuses an empty player list without writing", async () => {
    expect(await confirmCompletions({ ...input, userIds: [] })).toEqual({
      status: "no-players",
    });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("upserts every player in one guarded statement and reports each one", async () => {
    queue([{ id: "p1", user_id: "u1" }], [{ id: "p2", userId: "u2" }]);
    const result = await confirmCompletions(input);
    expect(result).toEqual({
      status: "ok",
      recorded: [{ id: "p1", userId: "u1" }],
      alreadyCompleted: [{ id: "p2", userId: "u2" }],
      notRecorded: [],
    });

    expect(db.execute).toHaveBeenCalledTimes(1);
    const q = dialect.sqlToQuery(
      (db.execute.mock.calls[0] as unknown as [SQL])[0],
    );
    const sqlText = q.sql.replace(/\s+/g, " ");
    expect(sqlText).toContain("insert into quest_progress");
    expect(sqlText).toContain("unnest($3::text[])");
    expect(q.params).toEqual(["q1", "v1", ["u1", "u2"]]);
    expect(sqlText).toContain('join "user" u on u.id = r.id');
    expect(sqlText).toContain(
      "on conflict (user_id, quest_id) do update set status = 'completed'",
    );
    expect(sqlText).toContain(
      "undone_at = null, undone_by = null, undo_reason = null",
    );
    // A player already completed keeps that completion, so a retry is a no-op.
    expect(sqlText).toContain("where quest_progress.status <> 'completed'");
    expect(sqlText).toContain("returning id, user_id");

    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.params).toEqual(["q1", "u2", "completed"]);
  });

  it("writes nothing new on a retry and reports everyone as already completed", async () => {
    queue(
      [],
      [
        { id: "p1", userId: "u1" },
        { id: "p2", userId: "u2" },
      ],
    );
    expect(await confirmCompletions(input)).toEqual({
      status: "ok",
      recorded: [],
      alreadyCompleted: [
        { id: "p1", userId: "u1" },
        { id: "p2", userId: "u2" },
      ],
      notRecorded: [],
    });
  });

  it("reports players whose account is gone as not recorded", async () => {
    queue([{ id: "p1", user_id: "u1" }], []);
    expect(await confirmCompletions(input)).toMatchObject({
      recorded: [{ id: "p1", userId: "u1" }],
      alreadyCompleted: [],
      notRecorded: ["u2"],
    });
  });

  it("skips the follow-up read when every player was recorded", async () => {
    queue([
      { id: "p1", user_id: "u1" },
      { id: "p2", user_id: "u2" },
    ]);
    await confirmCompletions(input);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("undoCompletions", () => {
  it("puts completed rows back to attempted and records who and why", async () => {
    queue([{ id: "p1" }]);
    expect(
      await undoCompletions({ ids: ["p1", "p2", "p1"], by: "v1", reason: "x" }),
    ).toEqual(["p1"]);
    expect(db.update).toHaveBeenCalledWith(schema.questProgress);
    const c = chainOf(db.update, 0);
    expect(arg(c, "set")).toMatchObject({
      status: "attempted",
      undoneBy: "v1",
      undoReason: "x",
    });
    expect((arg(c, "set") as { undoneAt: unknown }).undoneAt).toBeInstanceOf(
      Date,
    );
    const where = dialect.sqlToQuery(arg(c, "where") as SQL);
    expect(where.params).toEqual(["p1", "p2", "completed"]);
  });

  it("does nothing for an empty list", async () => {
    expect(await undoCompletions({ ids: [], by: "v1", reason: null })).toEqual(
      [],
    );
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("completionsByIds", () => {
  it("reads the rows in the order asked for, dropping unknown ids", async () => {
    queue([
      { id: "p2", userId: "u2" },
      { id: "p1", userId: "u1" },
    ]);
    const rows = await completionsByIds(["p1", "p9", "p2"]);
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.params).toEqual(["p1", "p9", "p2"]);
  });

  it("skips the query for an empty list", async () => {
    expect(await completionsByIds([])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
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

  it("writes a volunteer event with an untargeted on-conflict, then raises the profile column", async () => {
    queue([{ id: "e1" }], [{ level: 2 }]);
    expect(await recordLevelUp(input)).toEqual({ status: "awarded" });
    expect(db.insert).toHaveBeenNthCalledWith(1, schema.levelEvents);
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

    expect(db.insert).toHaveBeenNthCalledWith(2, schema.profiles);
    const raise = chainOf(db.insert, 1);
    expect(arg(raise, "values")).toEqual({ userId: "u1", wizardLevel: 2 });
    const conflict = arg(raise, "onConflictDoUpdate") as {
      target: unknown;
      set: Record<string, SQL>;
    };
    expect(conflict.target).toBe(schema.profiles.userId);
    expect(Object.keys(conflict.set)).toEqual(["wizardLevel"]);
    expect(render(conflict.set.wizardLevel)).toBe(
      'greatest("profiles"."wizard_level", $1)',
    );
  });

  it("treats a retry of the same event as success and repairs the column", async () => {
    queue(
      [],
      [{ id: "e1", userId: "u1", class: "wizard", level: 2, voidedAt: null }],
      [{ level: 2 }],
    );
    expect(await recordLevelUp(input)).toEqual({ status: "retry" });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("refuses a reused id with different values", async () => {
    queue(
      [],
      [{ id: "e1", userId: "u1", class: "pirate", level: 2, voidedAt: null }],
    );
    expect(await recordLevelUp(input)).toEqual({ status: "id-reused" });
    expect(db.insert).toHaveBeenCalledTimes(1);
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
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("reports a level that another event already awarded", async () => {
    queue([], []);
    expect(await recordLevelUp(input)).toEqual({ status: "already-awarded" });
    expect(db.insert).toHaveBeenCalledTimes(1);
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
  it("upserts one progress row per player, counting the attempt", async () => {
    await recordQuestAttempt({
      questId: "q1",
      userIds: ["u1", "u2", "u1"],
      correct: false,
      enteredBy: "v1",
    });
    expect(db.insert).toHaveBeenCalledWith(schema.questProgress);
    const c = chainOf(db.insert, 0);
    const values = arg(c, "values") as Record<string, unknown>[];
    expect(values.map((v) => v.userId)).toEqual(["u1", "u2"]);
    expect(values[0]).toMatchObject({
      questId: "q1",
      status: "attempted",
      attemptCount: 1,
    });
    expect(values[0].firstAttemptAt).toBeInstanceOf(Date);
    const conflict = arg(c, "onConflictDoUpdate") as {
      target: unknown[];
      set: Record<string, SQL>;
    };
    expect(conflict.target).toEqual([
      schema.questProgress.userId,
      schema.questProgress.questId,
    ]);
    // Status is left alone, so a completed quest stays completed.
    expect(Object.keys(conflict.set).sort()).toEqual([
      "attemptCount",
      "firstAttemptAt",
      "updatedAt",
    ]);
    expect(render(conflict.set.attemptCount)).toBe(
      '"quest_progress"."attempt_count" + 1',
    );
    expect(render(conflict.set.firstAttemptAt)).toBe(
      'coalesce("quest_progress"."first_attempt_at", now())',
    );
  });

  it("writes nothing with no players", async () => {
    await recordQuestAttempt({
      questId: "q1",
      userIds: [],
      correct: true,
      enteredBy: "v1",
    });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("voidLevelEvent", () => {
  it("voids a volunteer event and recomputes that class in SQL, then repairs upward", async () => {
    queue([{ userId: "u1", class: "wizard" }], [{ level: 2 }], [{ level: 2 }]);
    expect(
      await voidLevelEvent({ id: "e3", voidedBy: "v1", reason: "typo" }),
    ).toEqual({ status: "voided", level: 2 });
    const where = render(arg(chainOf(db.update, 0), "where"));
    expect(where).toContain('"level_events"."voided_at" is null');
    expect(where).toContain('"level_events"."source" = $');

    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledWith(schema.profiles);
    const recompute = arg(chainOf(db.insert, 0), "onConflictDoUpdate") as {
      set: Record<string, SQL>;
    };
    expect(Object.keys(recompute.set)).toEqual(["wizardLevel"]);
    const recomputeSql = render(recompute.set.wizardLevel);
    expect(recomputeSql).toContain('max("level_events"."level")');
    expect(recomputeSql).toContain('"level_events"."voided_at" is null');
    expect(recomputeSql).not.toContain("greatest");

    // A second statement with a fresh snapshot can only raise the column, so
    // an award that committed while the recompute ran is not lost.
    const repair = arg(chainOf(db.insert, 1), "onConflictDoUpdate") as {
      set: Record<string, SQL>;
    };
    expect(Object.keys(repair.set)).toEqual(["wizardLevel"]);
    const repairSql = render(repair.set.wizardLevel);
    expect(repairSql).toContain('greatest("profiles"."wizard_level"');
    expect(repairSql).toContain('max("level_events"."level")');
  });

  it("reports 0 when no live event remains", async () => {
    queue([{ userId: "u1", class: "alien" }], [{ level: 0 }], [{ level: 0 }]);
    expect(
      await voidLevelEvent({ id: "e3", voidedBy: "v1", reason: null }),
    ).toEqual({ status: "voided", level: 0 });
    expect(arg(chainOf(db.insert, 0), "values")).toMatchObject({
      userId: "u1",
    });
    expect(
      Object.keys(
        (arg(chainOf(db.insert, 0), "onConflictDoUpdate") as { set: object })
          .set,
      ),
    ).toEqual(["alienLevel"]);
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
      [{ level: 1 }],
      [{ level: 1 }],
    );
    expect(
      await voidLevelEvent({ id: "e3", voidedBy: "v1", reason: null }),
    ).toEqual({ status: "already-voided", level: 1 });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("refuses to void a picker event", async () => {
    queue(
      [],
      [{ userId: "u1", class: "wizard", source: "picker", voidedAt: null }],
    );
    expect(
      await voidLevelEvent({ id: "e3", voidedBy: "v1", reason: null }),
    ).toEqual({ status: "not-volunteer" });
    expect(db.insert).not.toHaveBeenCalled();
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
  it("skips the query for an empty player list", async () => {
    expect(await liveCompletions("q1", [])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns completed progress rows for the listed players", async () => {
    const at = new Date();
    queue([
      { id: "k1", userId: "u1", confirmedAt: at, confirmedByName: "Vol" },
      { id: "k2", userId: "u2", confirmedAt: null, confirmedByName: null },
    ]);
    expect(await liveCompletions("q1", ["u1", "u2"])).toEqual([
      { id: "k1", userId: "u1", confirmedAt: at, confirmedByName: "Vol" },
    ]);
    const c = chainOf(db.select, 0);
    const where = dialect.sqlToQuery(arg(c, "where") as SQL);
    expect(where.params).toEqual(["q1", "u1", "u2", "completed"]);
    expect(where.sql).toContain('"quest_progress"."status" = $');
    const join = c.calls.find((call) => call[0] === "leftJoin")?.[2];
    expect(render(join)).toContain('"quest_progress"."confirmed_by"');
  });

  it("counts completed quests in one class", async () => {
    queue([{ n: 3 }]);
    expect(await completionsInClass("u1", "wizard")).toBe(3);
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.params).toEqual(["u1", "wizard", "completed"]);
  });
});

describe("recentCompletions", () => {
  it("lists every row that was ever completed, newest first, undone ones included", async () => {
    queue([]);
    await recentCompletions(null, 30);
    const c = chainOf(db.select, 0);
    expect(render(arg(c, "where"))).toBe(
      '"quest_progress"."completed_at" is not null',
    );
    expect(render(arg(c, "orderBy"))).toContain(
      '"quest_progress"."completed_at" desc',
    );
    expect(arg(c, "limit")).toBe(30);
    const fields = (
      db.select.mock.calls[0] as unknown as [Record<string, unknown>]
    )[0];
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "questTitle",
        "playerName",
        "confirmedBy",
        "confirmedByName",
        "undoneAt",
        "undoneByName",
        "undoReason",
      ]),
    );
  });

  it("filters to one volunteer when given one", async () => {
    queue([]);
    await recentCompletions("v1");
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.sql).toContain('"quest_progress"."confirmed_by" = $');
    expect(where.params).toEqual(["v1"]);
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

  it("bins completions with date_bin from the shared origin", async () => {
    queue([{ bucket: "2026-11-07T10:00:00.000Z", class: "wizard", n: 2 }]);
    const rows = await completionSeries("1h", from, to);
    expect(rows).toEqual([
      { bucket: new Date("2026-11-07T10:00:00.000Z"), class: "wizard", n: 2 },
    ]);
    const fields = (db.select.mock.calls[0] as unknown as [{ bucket: SQL }])[0];
    const bucket = dialect.sqlToQuery(fields.bucket);
    expect(bucket.sql).toBe(
      'date_bin($1::interval, "quest_progress"."completed_at", $2::timestamptz)',
    );
    expect(bucket.params).toEqual(["1 hour", "2026-01-01T08:00:00.000Z"]);
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.sql).toContain('"quest_progress"."status" = $');
    expect(where.sql).toContain('"quest_progress"."completed_at" >= $');
    expect(where.sql).toContain('"quest_progress"."completed_at" < $');
    expect(where.params).toEqual([
      "completed",
      from.toISOString(),
      to.toISOString(),
    ]);
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
  it("lists undone volunteer level-ups, newest first", async () => {
    const t = (m: number) => new Date(Date.UTC(2026, 10, 7, 10, m));
    queue([{ id: "l1", voidedAt: t(2) }]);
    const rows = await recentVoids(2);
    expect(rows.map((r) => r.id)).toEqual(["l1"]);
    const c = chainOf(db.select, 0);
    const where = dialect.sqlToQuery(arg(c, "where") as SQL);
    expect(where.sql).toContain('"level_events"."voided_at" is not null');
    expect(where.params).toEqual(["volunteer"]);
    expect(arg(c, "limit")).toBe(2);
  });
});
