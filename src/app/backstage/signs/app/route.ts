import { readFile } from "node:fs/promises";
import path from "node:path";
import { toolAccess } from "@/lib/admin-auth";

export const runtime = "nodejs";

// Serves the built single-file tool. Rebuild it with
// `python3 assets/signs/build.py` after editing assets/signs/template.html.
export async function GET() {
  const access = await toolAccess("misc.signs");
  if (!access)
    return new Response("Sign in at /backstage/signs", { status: 401 });
  const html = await readFile(
    path.join(process.cwd(), "assets/signs/metagame-signs.html"),
    "utf8",
  );
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
