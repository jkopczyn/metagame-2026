import { notFound } from "next/navigation";
import { readEmail } from "@/lib/sent-emails";

// Dev-only preview for the hand-written emails in emails/ (sent) and
// emails/drafts/. Their image URLs point at the deployed site (as sent mail
// must), which 404s until the site is live — so this serves a copy with the
// host swapped to this dev server.
// Open http://localhost:3000/api/dev/email-preview?file=announcement
export const runtime = "nodejs";

const SITE = /https:\/\/(www\.)?metagame\.games/g;

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") notFound();
  const file = new URL(req.url).searchParams.get("file") ?? "announcement";
  const html = await readEmail(file);
  if (html == null)
    return new Response(
      `no emails/${file}.html or emails/drafts/${file}.html`,
      { status: 404 },
    );
  const origin = new URL(req.url).origin;
  return new Response(html.replace(SITE, origin), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
