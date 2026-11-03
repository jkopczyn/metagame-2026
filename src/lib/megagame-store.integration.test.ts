import { randomUUID } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs only against a scratch Neon branch with the migrations applied, since
// the mocked tests cannot see these races. Never point this at a shared branch.
const URL = process.env.MEGAGAME_SCRATCH_DATABASE_URL;

describe.skipIf(!URL)("megagame store against a scratch database", () => {
  let store: typeof import("./megagame-store");
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const players = [`it-${tag}-a`, `it-${tag}-b`];
  const volunteer = `it-${tag}-v`;
  const questId = randomUUID();
  const otherQuestId = randomUUID();

  const liveCount = async (confirmationId: string) => {
    const { rows } = await pool.query(
      `select count(*)::int as n from quest_completions
       where confirmation_id = $1 and voided_at is null`,
      [confirmationId],
    );
    return rows[0].n as number;
  };

  const waitForBlockedInsert = async () => {
    for (let i = 0; i < 50; i++) {
      const { rows } = await pool.query(
        `select 1 from pg_stat_activity
         where wait_event_type = 'Lock'
           and query ilike '%insert into%'
           and (query ilike '%quest_completions%' or query ilike '%confirmations%')`,
      );
      if (rows.length > 0) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    store = await import("./megagame-store");
    pool = new Pool({ connectionString: URL });
    for (const id of [...players, volunteer]) {
      await pool.query(
        `insert into "user" (id, name, email) values ($1, $1, $1 || '@example.test')`,
        [id],
      );
    }
    for (const [id, suffix] of [
      [questId, "A"],
      [otherQuestId, "B"],
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
    const quests = [questId, otherQuestId];
    await pool.query(
      `delete from quest_completions where quest_id = any($1::uuid[])`,
      [quests],
    );
    await pool.query(
      `delete from confirmations where quest_id = any($1::uuid[])`,
      [quests],
    );
    await pool.query(`delete from quests where id = any($1::uuid[])`, [quests]);
    await pool.query(`delete from "user" where id = any($1::text[])`, [
      [...players, volunteer],
    ]);
    await pool.end();
  });

  it("leaves nothing live when an undo commits while the insert waits on it", async () => {
    const id = randomUUID();
    await pool.query(
      `insert into confirmations (id, quest_id, requested_user_ids, confirmed_by)
       values ($1, $2, $3, $4)`,
      [id, questId, [...players].sort(), volunteer],
    );
    const undo = await pool.connect();
    let blocked = false;
    try {
      await undo.query("begin");
      await undo.query(
        `update confirmations set voided_at = now(), voided_by = $2
         where id = $1 and voided_at is null`,
        [id, volunteer],
      );
      const confirming = store.confirmQuest({
        id,
        questId,
        requestedUserIds: players,
        confirmedBy: volunteer,
      });
      blocked = await waitForBlockedInsert();
      await undo.query(
        `update quest_completions set voided_at = now(), voided_by = $2
         where confirmation_id = $1 and voided_at is null`,
        [id, volunteer],
      );
      await undo.query("commit");
      await confirming;
    } finally {
      undo.release();
    }
    expect(blocked, "the insert waited on the undo's lock").toBe(true);
    expect(await liveCount(id)).toBe(0);
  }, 15_000);

  it("refuses a retry whose quest or players differ, and changes nothing", async () => {
    const id = randomUUID();
    const first = await store.confirmQuest({
      id,
      questId: otherQuestId,
      requestedUserIds: [players[0]],
      confirmedBy: volunteer,
    });
    expect(first).toMatchObject({ status: "ok", recorded: [players[0]] });

    expect(
      await store.confirmQuest({
        id,
        questId,
        requestedUserIds: [players[0]],
        confirmedBy: volunteer,
      }),
    ).toEqual({ status: "quest-mismatch" });
    expect(
      await store.confirmQuest({
        id,
        questId: otherQuestId,
        requestedUserIds: players,
        confirmedBy: volunteer,
      }),
    ).toEqual({ status: "players-mismatch" });
    expect(await liveCount(id)).toBe(1);
  });

  it("keeps one player's undo when the original confirm is retried", async () => {
    await pool.query(
      `update quest_completions set voided_at = now() where quest_id = $1`,
      [otherQuestId],
    );
    const id = randomUUID();
    const input = {
      id,
      questId: otherQuestId,
      requestedUserIds: players,
      confirmedBy: volunteer,
    };
    await store.confirmQuest(input);
    const { rows } = await pool.query(
      `select id from quest_completions
       where confirmation_id = $1 and user_id = $2 and voided_at is null`,
      [id, players[1]],
    );
    expect(
      await store.voidCompletion({
        id: rows[0].id,
        voidedBy: volunteer,
        reason: "integration test",
      }),
    ).toBe(true);

    expect(await store.confirmQuest(input)).toMatchObject({
      status: "ok",
      recorded: [players[0]],
    });
    expect(await liveCount(id)).toBe(1);
  });
});
