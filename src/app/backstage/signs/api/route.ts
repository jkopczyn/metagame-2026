import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { toolAccess } from "@/lib/admin-auth";

export const runtime = "nodejs";

// Shared drafts for the sign maker. Everyone holding misc.signs may list,
// open, save over and delete any draft; created_by / updated_by are credit.
//
//   GET                     list drafts (no sign body)
//   GET ?id=                one draft with its sign
//   POST  { id?, name, sign, thumbnail? }         -> { id }
//   POST  { type: "blob.generate-client-token" }  -> { clientToken }
//   DELETE ?id=
//
// Uploads are Vercel Blob client uploads: the tool asks here for a token and
// then PUTs the file to Blob itself, so a banner photo of any size never
// passes through a function (bodies there are capped at 4.5 MB).
//
// Deleting a draft leaves its Blob files alone: "Save as new" forks share
// the same URLs, so a file can't be tied to one draft.

const headers = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
const forbidden = () => json({ error: "Forbidden." }, 403);

const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
// Browsers send fonts with no or a generic type, so the token allows
// application/* too and the extension check below does the real gating.
const UPLOAD_TYPES = ["image/*", "font/*", "application/*"];
const UPLOAD_EXT = /\.(png|jpe?g|webp|svg|ttf|otf|woff2?)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THUMBNAIL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const THUMBNAIL_MAX_CHARS = 20_000;

export async function GET(request: Request) {
  if (!(await toolAccess("misc.signs"))) return forbidden();
  const db = getDb();
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    if (!UUID.test(id)) return json({ error: "No such draft." }, 404);
    const [row] = await db
      .select()
      .from(schema.signDrafts)
      .where(eq(schema.signDrafts.id, id));
    if (!row) return json({ error: "No such draft." }, 404);
    return json({ draft: row });
  }
  const creator = alias(schema.user, "creator");
  const editor = alias(schema.user, "editor");
  const rows = await db
    .select({
      id: schema.signDrafts.id,
      name: schema.signDrafts.name,
      thumbnail: schema.signDrafts.thumbnail,
      createdBy: creator.name,
      updatedBy: editor.name,
      updatedAt: schema.signDrafts.updatedAt,
    })
    .from(schema.signDrafts)
    .leftJoin(creator, eq(creator.id, schema.signDrafts.createdBy))
    .leftJoin(editor, eq(editor.id, schema.signDrafts.updatedBy))
    .orderBy(desc(schema.signDrafts.updatedAt));
  return json({ drafts: rows });
}

export async function POST(request: Request) {
  const access = await toolAccess("misc.signs");
  if (!access) return forbidden();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return json({ error: "Bad body." }, 400);

  if ((body as { type?: unknown }).type === "blob.generate-client-token") {
    try {
      const result = await handleUpload({
        request,
        body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname) => {
          if (!pathname.startsWith("signs/") || !UPLOAD_EXT.test(pathname))
            throw new Error("Use an image or a font file.");
          return {
            allowedContentTypes: UPLOAD_TYPES,
            maximumSizeInBytes: UPLOAD_MAX_BYTES,
            addRandomSuffix: true,
            allowOverwrite: false,
          };
        },
        // No completion callback: the tool stores the URL in the draft itself.
        onUploadCompleted: async () => {},
      });
      return json(result);
    } catch (err) {
      return json({ error: (err as Error).message }, 400);
    }
  }
  const { id, name, sign, thumbnail } = body as {
    id?: unknown;
    name?: unknown;
    sign?: unknown;
    thumbnail?: unknown;
  };
  if (
    typeof name !== "string" ||
    !name.trim() ||
    !sign ||
    typeof sign !== "object"
  )
    return json({ error: "A draft needs a name and a sign." }, 400);
  if (id !== undefined && (typeof id !== "string" || !UUID.test(id)))
    return json({ error: "Bad draft id." }, 400);
  if (
    thumbnail != null &&
    (typeof thumbnail !== "string" ||
      thumbnail.length > THUMBNAIL_MAX_CHARS ||
      !THUMBNAIL.test(thumbnail))
  )
    return json({ error: "Bad thumbnail." }, 400);
  const thumb = typeof thumbnail === "string" ? thumbnail : null;
  const db = getDb();
  if (typeof id === "string") {
    const [row] = await db
      .update(schema.signDrafts)
      .set({
        name: name.trim(),
        sign,
        thumbnail: thumb,
        updatedBy: access.userId,
      })
      .where(eq(schema.signDrafts.id, id))
      .returning({ id: schema.signDrafts.id });
    if (row) return json({ id: row.id });
  }
  const [row] = await db
    .insert(schema.signDrafts)
    .values({
      name: name.trim(),
      sign,
      thumbnail: thumb,
      createdBy: access.userId,
      updatedBy: access.userId,
    })
    .returning({ id: schema.signDrafts.id });
  return json({ id: row.id });
}

export async function DELETE(request: Request) {
  if (!(await toolAccess("misc.signs"))) return forbidden();
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !UUID.test(id)) return json({ error: "Which draft?" }, 400);
  await getDb().delete(schema.signDrafts).where(eq(schema.signDrafts.id, id));
  return json({ ok: true });
}
