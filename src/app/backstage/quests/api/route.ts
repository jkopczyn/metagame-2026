import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { toolAccess } from "@/lib/admin-auth";

export const runtime = "nodejs";

// Quest images (card pictures and the evidence photo) are Vercel Blob client
// uploads: the editor asks here for a token and PUTs the file to Blob
// itself, so a bundle's worth of pictures never passes through a server
// action (bodies there are capped at 1 MB). The browser has already
// downscaled each picture; the size cap is a backstop.

const headers = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });

export const QUEST_IMAGE_FOLDER = "megagame-quests/";
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
const UPLOAD_EXT = /\.(png|jpe?g|webp)$/i;

export async function POST(request: Request) {
  if (!(await toolAccess("megagame.manage")))
    return json({ error: "Forbidden." }, 403);
  const body = (await request
    .json()
    .catch(() => null)) as HandleUploadBody | null;
  if (!body || typeof body !== "object")
    return json({ error: "Bad body." }, 400);
  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (
          !pathname.startsWith(QUEST_IMAGE_FOLDER) ||
          !UPLOAD_EXT.test(pathname)
        )
          throw new Error("Use a PNG, JPEG or WebP image.");
        return {
          allowedContentTypes: ["image/png", "image/jpeg", "image/webp"],
          maximumSizeInBytes: UPLOAD_MAX_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
        };
      },
      // The URL goes into the quest row when the form or import saves.
      onUploadCompleted: async () => {},
    });
    return json(result);
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
}
