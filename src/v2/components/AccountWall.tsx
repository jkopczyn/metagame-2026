import Link from "next/link";
import ContentPage from "./ContentPage";

/**
 * Stands in for a page the viewer can't see yet.
 *
 * Callers must decide to show this *before* looking the resource up, so a
 * signed-out visitor gets the same page for every URL and it confirms nothing
 * about what exists. Where being seen matters — someone else's session — a
 * signed-in viewer still gets notFound().
 */
export default function AccountWall({
  title,
  body,
  next,
}: {
  title: string;
  body: string;
  /** Where /login sends them back to, or null for no sign-in offer. */
  next: string | null;
}) {
  return (
    <ContentPage title={title}>
      <div className="flex max-w-[520px] flex-col items-start gap-6">
        <p className="text-base text-ink/70">{body}</p>
        {next && (
          <>
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="rounded-lg bg-meeple px-5 py-2.5 font-roboto font-semibold text-white transition-colors hover:bg-meeple-dark"
            >
              Sign in or create an account
            </Link>
            <p className="text-sm text-ink/55">
              Signing in with your email creates an account if you don&rsquo;t
              have one yet — no password needed.
            </p>
          </>
        )}
      </div>
    </ContentPage>
  );
}
