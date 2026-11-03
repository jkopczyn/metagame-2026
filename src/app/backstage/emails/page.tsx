import Link from "next/link";
import { connection } from "next/server";
import ToolSignIn from "@/components/ToolSignIn";
import { can } from "@/lib/access";
import { listEmails, type SavedEmail } from "@/lib/sent-emails";

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

function EmailList({ emails }: { emails: SavedEmail[] }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-white">
      {emails.map((e) => (
        <li
          key={e.slug}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
        >
          <div className="min-w-0">
            <Link
              href={`/backstage/emails/${e.slug}`}
              className="font-semibold text-navy underline-offset-2 hover:text-meeple hover:underline"
            >
              {e.subject}
            </Link>
            <p className="text-sm text-ink/60">
              <code>
                {e.status === "draft" && "drafts/"}
                {e.slug}.html
              </code>
              {e.variants.includes("txt") && " · plain text"}
              {e.variants.includes("min") && " · minified copy"}
            </p>
          </div>
          <span className="text-sm whitespace-nowrap text-ink/50">
            {kb(e.bytes)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function BackstageEmailsPage() {
  await connection();

  if (!(await can("emails.view")))
    return <ToolSignIn title="Emails" next="/backstage/emails" />;

  const emails = await listEmails();
  const drafts = emails.filter((e) => e.status === "draft");
  const sent = emails.filter((e) => e.status === "sent");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      {drafts.length > 0 && (
        <section>
          <h2 className="font-bebas text-2xl tracking-wide text-navy">
            Drafts
          </h2>
          <p className="mb-3 text-sm text-ink/60">
            Saved in <code>emails/drafts/</code>; these haven&rsquo;t been sent
            yet.
          </p>
          <EmailList emails={drafts} />
        </section>
      )}
      <section>
        <h2 className="font-bebas text-2xl tracking-wide text-navy">Sent</h2>
        <p className="mb-3 text-sm text-ink/60">
          The emails we&rsquo;ve sent to the mailing list, as saved in the
          repo&rsquo;s <code>emails/</code> folder. Sending stays in
          EmailOctopus, so dates and recipients live there.
        </p>
        {sent.length === 0 ? (
          <p className="text-sm text-ink/60">No emails sent yet.</p>
        ) : (
          <EmailList emails={sent} />
        )}
      </section>
    </div>
  );
}
