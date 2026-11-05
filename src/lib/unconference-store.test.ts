import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@/db";
import { noticeText, type NoticeDoc } from "./notice-doc";
import { listedPoster } from "./unconference-store";

const client = new PGlite();
const db = drizzle({ client, casing: "snake_case" });

const text = {
  id: "t",
  kind: "text",
  x: 0,
  y: 0,
  w: 100,
  paras: [{ runs: [{ t: "Come join" }] }],
};
const stroke = {
  id: "s",
  kind: "stroke",
  ink: "ink",
  width: 3,
  points: [1, 2],
};
const doc = { v: 1, paper: "cream", items: [stroke, text, stroke] };

async function listed(sessionId: string | null, poster: unknown) {
  await client.query("delete from unconference_notes");
  await client.query(
    "insert into unconference_notes (session_id, poster) values ($1, $2)",
    [sessionId, JSON.stringify(poster)],
  );
  const [row] = await db
    .select({ poster: listedPoster })
    .from(schema.unconferenceNotes);
  return row.poster;
}

describe("listedPoster", () => {
  beforeAll(() =>
    client.exec(
      "create table unconference_notes (session_id uuid, poster jsonb not null)",
    ),
  );
  afterAll(() => client.close());

  it("leaves a plain notice's text and drops its strokes", async () => {
    const poster = await listed(null, doc);
    expect(poster).toEqual({ v: 1, paper: "cream", items: [text] });
    expect(noticeText(poster)).toBe(noticeText(doc as NoticeDoc));
  });

  it("copes with a notice that has no text", async () => {
    const poster = await listed(null, { v: 1, items: [stroke] });
    expect(poster).toEqual({ v: 1, items: [] });
  });

  it("keeps a session poster whole, since the board draws it", async () => {
    const sessionId = "aaaaaaaa-0000-4000-8000-000000000000";
    expect(await listed(sessionId, doc)).toEqual(doc);
  });
});
