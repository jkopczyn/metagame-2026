import { randomUUID } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs only against a scratch database with the migrations applied, since the
// mocked tests cannot see these races. Never point this at a shared branch.
const URL = process.env.MEGAGAME_SCRATCH_DATABASE_URL;

describe.skipIf(!URL)("megagame store against a scratch database", () => {
  let store: typeof import("./megagame-store");
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const players = [`it-${tag}-a`, `it-${tag}-b`];
  const volunteers = [`it-${tag}-v`, `it-${tag}-w`];
  const questId = randomUUID();
  const raceQuestId = randomUUID();
  const quests = [questId, raceQuestId];

  const progress = async (quest: string, userId: string) => {
    const { rows } = await pool.query(
      `select id, status, confirmed_by, undone_at, undone_by, undo_reason
       from quest_progress where quest_id = $1 and user_id = $2`,
      [quest, userId],
    );
    return rows;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    store = await import("./megagame-store");
    pool = new Pool({ connectionString: URL });
    for (const id of [...players, ...volunteers]) {
      await pool.query(
        `insert into "user" (id, name, email) values ($1, $1, $1 || '@example.test')`,
        [id],
      );
    }
    for (const [id, suffix] of [
      [questId, "A"],
      [raceQuestId, "B"],
    ]) {
      await pool.query(
        `insert into quests (id, code, title, kind)
         values ($1, $2, 'Integration test quest', 'evidence')`,
        [id, `IT${tag}${suffix}`],
      );
    }
  });

  afterAll(async () => {
    if (!pool) return;
    const users = [...players, ...volunteers];
    await pool.query(
      `delete from quest_progress where quest_id = any($1::uuid[])`,
      [quests],
    );
    await pool.query(`delete from quests where id = any($1::uuid[])`, [quests]);
    await pool.query(
      `delete from level_events where user_id = any($1::text[])`,
      [users],
    );
    await pool.query(`delete from "user" where id = any($1::text[])`, [users]);
    await pool.end();
  });

  it("records one completion when two volunteers confirm the same player at once", async () => {
    const results = await Promise.all(
      volunteers.map((confirmedBy) =>
        store.confirmCompletions({
          questId: raceQuestId,
          userIds: [players[0]],
          confirmedBy,
        }),
      ),
    );
    const counts = results.map((r) =>
      r.status === "ok"
        ? [r.recorded.length, r.alreadyCompleted.length]
        : r.status,
    );
    expect(counts).toContainEqual([1, 0]);
    expect(counts).toContainEqual([0, 1]);
    const rows = await progress(raceQuestId, players[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("completed");
    const winner = results.find(
      (r) => r.status === "ok" && r.recorded.length === 1,
    );
    expect(winner).toMatchObject({ recorded: [{ id: rows[0].id }] });
  });

  it("treats a retry as a no-op, and completes the row again after an undo", async () => {
    const input = {
      questId,
      userIds: players,
      confirmedBy: volunteers[0],
    };
    const first = await store.confirmCompletions(input);
    expect(first).toMatchObject({ status: "ok", alreadyCompleted: [] });
    if (first.status !== "ok") return;
    expect(first.recorded.map((r) => r.userId)).toEqual([...players].sort());
    const ids = first.recorded.map((r) => r.id);

    expect(await store.confirmCompletions(input)).toMatchObject({
      recorded: [],
      alreadyCompleted: first.recorded,
    });

    const undone = await store.undoCompletions({
      ids,
      by: volunteers[1],
      reason: "integration test",
    });
    expect(undone.sort()).toEqual([...ids].sort());
    expect(
      await store.undoCompletions({ ids, by: volunteers[1], reason: null }),
    ).toEqual([]);
    expect(await progress(questId, players[0])).toEqual([
      expect.objectContaining({
        status: "attempted",
        undone_by: volunteers[1],
        undo_reason: "integration test",
      }),
    ]);

    const retried = await store.confirmCompletions(input);
    expect(retried).toMatchObject({ recorded: first.recorded });
    expect(await progress(questId, players[0])).toEqual([
      expect.objectContaining({
        status: "completed",
        confirmed_by: volunteers[0],
        undone_at: null,
        undone_by: null,
        undo_reason: null,
      }),
    ]);
  });

  it("records one live event when the same level-up is sent twice at once", async () => {
    const results = await Promise.all(
      [randomUUID(), randomUUID()].map((id) =>
        store.recordLevelUp({
          id,
          userId: players[1],
          class: "pirate",
          level: 2,
          awardedBy: volunteers[0],
          checksPassed: true,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      "already-awarded",
      "awarded",
    ]);
    const { rows } = await pool.query(
      `select
         (select count(*)::int from level_events
          where user_id = $1 and class = 'pirate' and voided_at is null) as n,
         (select pirate_level from profiles where user_id = $1) as level`,
      [players[1]],
    );
    expect(rows[0]).toEqual({ n: 1, level: 2 });
  });
});
