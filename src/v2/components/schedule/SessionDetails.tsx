import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  FaMapMarkerAlt,
  FaRegClock,
  FaUserFriends,
  FaUsers,
} from "react-icons/fa";
import { toolAccess } from "@/lib/admin-auth";
import { editSessionAccess } from "@/lib/session-ownership";
import { currentSession } from "@/lib/auth";
import { airtableRfpLink, gradeLink } from "@/lib/rfp-links";
import { gradingSummary } from "@/lib/rfp-sessions";
import {
  formatPacificDay,
  formatPacificTime,
  linkedSession,
  onGuestList,
  planConflicts,
  viewerSessionIds,
  type Ages,
  type Category,
} from "@/lib/schedule";
import { loadSessionRsvps, loadViewerPlans } from "@/lib/schedule-store";
import {
  loadPublicSchedule,
  loadRawSchedule,
  rsvpTicket,
} from "@/app/(v2)/schedule/data";
import SessionPlans from "@/v2/components/schedule/SessionPlans";
import SessionSignIn from "@/v2/components/schedule/SessionSignIn";
import { blockStyle } from "@/v2/components/schedule/SessionBits";
import { SESSION_TITLE_ID } from "@/lib/session-link";
import ProfileLink from "@/v2/components/ProfileLink";
import { HEADING } from "@/v2/components/styles";

const CATEGORY_LABEL: Record<Category, string> = {
  talk: "Talk",
  workshop: "Workshop",
  game: "Game",
  other: "Other",
};

const AGES_LABEL: Record<Ages, string> = {
  all: "All ages",
  kids: "Kid-friendly",
  adults: "18+",
};

/** The shown (or link-only) session with that slug and its room, or null. */
export async function lookupSession(slug: string) {
  const { sessions, locations } = await loadPublicSchedule();
  const session = sessions.find((s) => s.slug === slug);
  const room = session && locations.find((l) => l.id === session.locationId);
  if (session && room) return { session, room };
  return linkedSession(await loadRawSchedule(), slug);
}

async function findSession(slug: string) {
  const found = await lookupSession(slug);
  if (!found) notFound();
  return found;
}

export async function sessionMetadata(slug: string): Promise<Metadata> {
  const { session } = await findSession(slug);
  return {
    title: `${session.title} — Metagame 2026`,
    robots: { index: false },
  };
}

const MUTED = "text-sm text-[#1b1530]/60";

function AdminNote({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="mb-1 text-xs tracking-[0.12em] text-[#1b1530]/55 uppercase">
        {title}
      </p>
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-[#1b1530]/85">
        {text}
      </p>
    </div>
  );
}

/** The grading side, for the schedule's managers: links and grader notes. */
async function Grading({
  sessionId,
  recordId,
}: {
  sessionId: string;
  recordId: string | null;
}) {
  let summary = null;
  try {
    summary = await gradingSummary(sessionId);
  } catch (err) {
    console.error("grades read failed", sessionId, err);
  }
  const link = "font-semibold text-navy underline";
  const notes = summary?.notes ?? [];
  return (
    <>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {(recordId || summary?.inPipeline) && (
          <Link href={gradeLink(sessionId)} target="_blank" className={link}>
            Grading page
          </Link>
        )}
        {recordId ? (
          <a
            href={airtableRfpLink(recordId)}
            target="_blank"
            rel="noopener noreferrer"
            className={link}
          >
            Airtable record
          </a>
        ) : (
          <span className={MUTED}>No RFP linked</span>
        )}
      </div>
      {!summary && <p className={MUTED}>Couldn&rsquo;t load the grades</p>}
      {notes.length > 0 && (
        <AdminNote
          title="Grader notes for scheduler"
          text={
            notes.length === 1
              ? notes[0].text
              : notes.map((n) => `${n.grader}: ${n.text}`).join("\n\n")
          }
        />
      )}
    </>
  );
}

async function TeamDetails({
  sessionId,
  manager,
}: {
  sessionId: string;
  /** Holds schedule.manage: also sees the grading side. */
  manager: boolean;
}) {
  const { sessions } = await loadRawSchedule();
  const raw = sessions.find((s) => s.id === sessionId);
  const needs = raw?.needs?.trim() || null;
  const shepherd = raw?.shepherd ?? null;
  if (!manager && !needs && !shepherd) return null;

  return (
    <section className="mt-10 flex flex-col gap-4 border-t border-dashed border-line pt-6">
      <h2 className="font-[family-name:var(--font-bebas)] text-2xl tracking-[0.04em] text-[#1b1530]/55">
        Team only
      </h2>
      {shepherd && (
        <p className="text-[15px] text-[#1b1530]/85">
          <span className="text-[#1b1530]/55">Shepherd:</span> {shepherd.name}
        </p>
      )}
      {needs && <AdminNote title="Needs" text={needs} />}
      {manager && (
        <Suspense fallback={<p className={MUTED}>Loading grades…</p>}>
          <Grading
            sessionId={sessionId}
            recordId={raw?.airtableRfpRecordId ?? null}
          />
        </Suspense>
      )}
    </section>
  );
}

/** The session modal's body, on the session's own page or over another. */
export default async function SessionDetails({ slug }: { slug: string }) {
  const [{ session, room }, account, notes, admin] = await Promise.all([
    findSession(slug),
    currentSession(),
    toolAccess("schedule.session_notes"),
    toolAccess("schedule.manage"),
  ]);
  const viewerId = account?.user.id ?? null;
  const [rsvps, plans, editor, raw, shown, ticket] = await Promise.all([
    loadSessionRsvps(session.id),
    viewerId ? loadViewerPlans(viewerId) : null,
    viewerId ? editSessionAccess(session.id) : null,
    // Host ids and shepherds aren't public, so clashes read the raw schedule.
    viewerId ? loadRawSchedule() : null,
    viewerId ? loadPublicSchedule() : null,
    rsvpTicket(),
  ]);
  // Only sessions this viewer can see, as loadMySessionIds does.
  const visible = new Set(shown?.sessions.map((s) => s.id));
  const rawSession = raw?.sessions.find((s) => s.id === session.id);
  const ownSession =
    !!viewerId &&
    !!rawSession &&
    viewerSessionIds(viewerId, [rawSession], { rsvps: {}, bookmarks: [] })
      .length > 0;
  // The guest list stays server-side; the page only learns whether the
  // viewer is on it.
  const guests = rawSession?.inviteEmails ?? null;
  const invited =
    !session.inviteOnly ||
    (!!account &&
      (account.user.role === "admin" ||
        onGuestList(guests, account.user.email)));

  const tags = [
    session.category ? CATEGORY_LABEL[session.category] : null,
    session.ages ? AGES_LABEL[session.ages] : null,
    session.inviteOnly ? "Invite only" : null,
    session.rsvpIsCommitment ? "Limited spots" : null,
    session.sponsored ? "Sponsor" : null,
  ].filter(Boolean) as string[];
  const cap = session.maxCapacity;

  return (
    <>
      <span
        aria-hidden
        className="block h-2 w-16 rounded-full border"
        style={blockStyle(session)}
      />
      <h2
        id={SESSION_TITLE_ID}
        className={`${HEADING} mt-4 text-[clamp(30px,5vw,48px)] text-navy`}
      >
        {session.title}
      </h2>

      {tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((t) => (
            <span
              key={t}
              className="border-[1.5px] border-[#1b1530]/25 px-2.5 py-0.5 text-xs tracking-[0.12em] text-[#1b1530]/70 uppercase"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <dl className="mt-6 flex flex-col gap-2.5 text-[15px]">
        <div className="flex items-center gap-2.5">
          <dt className="sr-only">When</dt>
          <FaRegClock aria-hidden className="shrink-0 text-[#eaa35a]" />
          <dd>
            {formatPacificDay(session.startsAt)},{" "}
            {formatPacificTime(session.startsAt)}–
            {formatPacificTime(session.endsAt)} PT
          </dd>
        </div>
        <div className="flex items-center gap-2.5">
          <dt className="sr-only">Where</dt>
          <FaMapMarkerAlt aria-hidden className="shrink-0 text-[#eaa35a]" />
          <dd className="flex items-center gap-2.5">
            {room.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- already thumbnail-sized
              <img
                src={room.thumbnailUrl}
                alt=""
                className="h-10 w-14 rounded-sm object-cover"
              />
            )}
            <span>
              {room.name}
              {room.campusLocation && (
                <span className="text-[#1b1530]/60">
                  {" "}
                  · {room.campusLocation}
                </span>
              )}
            </span>
          </dd>
        </div>
        {session.hosts.length > 0 && (
          <div className="flex items-center gap-2.5">
            <dt className="sr-only">Hosts</dt>
            <FaUserFriends aria-hidden className="shrink-0 text-[#eaa35a]" />
            <dd>
              {session.hosts.map((host, i) => (
                <span key={host.userId}>
                  {i > 0 && ", "}
                  <ProfileLink userId={host.userId} name={host.name} />
                </span>
              ))}
            </dd>
          </div>
        )}
        {cap !== null && (
          <div className="flex items-center gap-2.5">
            <dt className="sr-only">Capacity</dt>
            <FaUsers aria-hidden className="shrink-0 text-[#eaa35a]" />
            <dd>Up to {cap}</dd>
          </div>
        )}
      </dl>

      {session.description && (
        <p className="mt-6 text-[15px] leading-relaxed whitespace-pre-line text-[#1b1530]/85">
          {session.description}
        </p>
      )}

      <section className="mt-10 flex flex-col gap-4 border-t border-line pt-6">
        <h2 className="font-[family-name:var(--font-bebas)] text-2xl tracking-[0.04em] text-navy">
          Who&rsquo;s coming
        </h2>
        <SessionPlans
          sessionId={session.id}
          capacity={cap}
          commitment={session.rsvpIsCommitment}
          open={session.rsvpsOpen}
          inviteOnly={session.inviteOnly}
          invited={invited}
          conflicts={
            viewerId && plans && raw
              ? planConflicts(
                  session,
                  raw.sessions.filter((s) => visible.has(s.id)),
                  viewerId,
                  plans.rsvps,
                )
              : []
          }
          rsvps={rsvps}
          // Guests need no ticket, as rsvpTo agrees.
          ticket={
            session.inviteOnly && invited
              ? { has: true, claimable: [] }
              : ticket
          }
          plan={
            plans && {
              status: plans.rsvps[session.id] ?? null,
              bookmarked: plans.bookmarks.includes(session.id),
            }
          }
          ownSession={ownSession}
          signIn={<SessionSignIn />}
        />
      </section>

      {editor && (
        <p className="mt-6 text-sm">
          <Link
            href={
              editor.via === "team"
                ? `/backstage/schedule?edit=${encodeURIComponent(session.slug)}`
                : `/account/sessions/${session.id}`
            }
            className="font-semibold text-navy underline underline-offset-2 hover:text-meeple"
          >
            Edit this session
          </Link>
        </p>
      )}

      {notes && <TeamDetails sessionId={session.id} manager={!!admin} />}
    </>
  );
}
