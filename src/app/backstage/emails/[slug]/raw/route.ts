import { can } from "@/lib/access";
import { isEmailVariant, previewEmail, readEmail } from "@/lib/sent-emails";

export const runtime = "nodejs";

// One saved email's source, for the viewer's iframe. The HTML is served
// under a CSP that allows only inline styles and hotlinked images, which is
// all an email can use anyway.
export async function GET(
  request: Request,
  ctx: RouteContext<"/backstage/emails/[slug]/raw">,
) {
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (!(await can("emails.view")))
    return new Response("Not found", { status: 404, headers });

  const { slug } = await ctx.params;
  const v = new URL(request.url).searchParams.get("v");
  const variant = isEmailVariant(v) ? v : "html";
  const source = await readEmail(slug, variant);
  if (source == null)
    return new Response("Not found", { status: 404, headers });

  if (variant === "txt")
    return new Response(source, {
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  return new Response(previewEmail(source), {
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:",
    },
  });
}
