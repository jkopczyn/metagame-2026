import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import HostSessionForm from "./HostSessionForm";
import { currentSession } from "@/lib/auth";
import AccountWall from "@/v2/components/AccountWall";
import ContentPage from "@/v2/components/ContentPage";
import { loadSchedule } from "@/lib/schedule-store";
import { editSessionAccess } from "@/lib/session-ownership";
import { formatPacificDay, formatPacificTime, isPlaced } from "@/lib/schedule";

export const metadata: Metadata = {
  title: "Edit your session — Metagame",
  robots: { index: false, follow: false },
};

export default async function EditSessionPage(
  props: PageProps<"/account/sessions/[id]">,
) {
  await connection();
  const { id } = await props.params;
  // Before the lookup: the same page for every id, so a signed-out visitor
  // learns nothing about which sessions exist.
  if (!(await currentSession())) {
    return (
      <AccountWall
        title="Your session"
        body="Sign in to edit a session you're hosting."
        next={`/account/sessions/${id}`}
      />
    );
  }
  // Still a 404 once signed in: not yours is indistinguishable from not there.
  const access = await editSessionAccess(id);
  if (!access) notFound();

  const { sessions, locations } = await loadSchedule();
  const session = sessions.find((s) => s.id === id);
  if (!session) notFound();

  const room = locations.find((l) => l.id === session.locationId) ?? null;
  const when = isPlaced(session)
    ? `${formatPacificDay(session.startsAt)} ${formatPacificTime(session.startsAt)}–${formatPacificTime(session.endsAt)}`
    : "Not scheduled yet";

  return (
    <ContentPage title="Edit your session">
      <p className="text-sm text-ink/60">
        <Link href="/account?tab=sessions" className="hover:text-meeple">
          ← Your sessions
        </Link>
      </p>

      <div className="rounded-xl border border-line bg-cream/40 px-4 py-3 text-sm text-ink/70">
        <p>
          <strong className="text-ink">{when}</strong>
          {room && <> · {room.name}</>}
          {session.status === "draft" && " · Draft"}
        </p>
        <p className="mt-1 text-ink/55">
          When and where it runs, and whether it&rsquo;s published, are set by
          the Metagame team — email us if something needs moving.
        </p>
      </div>

      <HostSessionForm
        sessionId={session.id}
        initial={{
          title: session.title,
          description: session.description ?? "",
          category: session.category ?? "",
          ages: session.ages ?? "",
          needs: session.needs ?? "",
          maxCapacity: session.maxCapacity?.toString() ?? "",
          minCapacity: session.minCapacity?.toString() ?? "",
        }}
        rsvpIsCommitment={session.rsvpIsCommitment}
        hosts={session.hosts.map((h) => ({
          userId: h.userId,
          name: h.name,
          email: h.email,
        }))}
        viewerId={access.userId}
      />
    </ContentPage>
  );
}
