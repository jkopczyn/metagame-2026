import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import AccessPanel, { type AccessView } from "./AccessPanel";
import {
  PersonLink,
  shortDate,
  StatusTag,
  TAG,
  TestTag,
} from "../../tickets/parts";
import { scheduleViewer } from "@/app/(v2)/schedule/data";
import ToolSignIn from "@/components/ToolSignIn";
import { getDb, schema } from "@/db";
import { teamAccess } from "@/lib/access";
import { ticketPeople, ticketRoles } from "@/lib/admin-tickets";
import { ticketAccounts } from "@/lib/admin-store";
import { listRoles, userAccess } from "@/lib/permission-store";
import { explainPermissions, isPermission } from "@/lib/permissions";
import { loadSchedule, loadViewerPlans } from "@/lib/schedule-store";
import { formatTicketCode } from "@/lib/ticket-code-format";
import { ticketLabel, ticketsForUser } from "@/lib/ticket-store";
import { SESSION_ROLES, TEAM_AUDIENCE, userSessions } from "@/lib/user-profile";
import UserSessions from "@/v2/components/schedule/UserSessions";

const yesNo = (v: boolean | null | undefined) =>
  v == null ? "—" : v ? "Yes" : "No";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs tracking-wide text-ink/50 uppercase">{label}</dt>
      <dd className="break-words">{children || "—"}</dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-6 shadow-sm">
      <h2 className="font-bebas mb-4 text-xl tracking-wide text-navy">
        {title}
      </h2>
      {children}
    </section>
  );
}

// Admin role and ban changes stay on the users table; roles and per-user
// grants are edited here.
export default async function AdminUserProfilePage(
  props: PageProps<"/backstage/users/[id]">,
) {
  await connection();
  const { id } = await props.params;

  const viewer = await teamAccess();
  if (!viewer?.permissions.has("users.view"))
    return <ToolSignIn title="Users" next={`/backstage/users/${id}`} />;
  const { session } = viewer;

  const db = getDb();
  const [row] = await db
    .select({ user: schema.user, profile: schema.profiles })
    .from(schema.user)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.user.id))
    .where(eq(schema.user.id, id))
    .limit(1);
  if (!row) notFound();
  const { user, profile } = row;

  const admin = user.role === "admin";
  const [tickets, schedule, plans, roles, held] = await Promise.all([
    ticketsForUser(user.id, user.email),
    loadSchedule(),
    loadViewerPlans(user.id),
    listRoles(),
    userAccess(user.id, admin),
  ]);
  const access: AccessView = {
    userId: user.id,
    admin,
    self: user.id === session.user.id,
    editable:
      viewer.permissions.has("users.edit") && user.id !== session.user.id,
    roles: roles
      .filter((r) => !r.auto)
      .map((r) => ({
        id: r.id,
        name: r.name,
        assigned: held.roleIds.includes(r.id),
      })),
    auto: held.roles.filter((r) => r.auto).map((r) => `${r.name} (${r.auto})`),
    grants: held.grants.filter(isPermission),
    explanation: explainPermissions(held),
  };
  const { accounts, byEmail } = await ticketAccounts(tickets);
  // Room visibility follows the viewer's schedule permissions here too, so a
  // team tool doesn't become a way around them.
  const sessions = userSessions(
    user.id,
    schedule,
    plans,
    TEAM_AUDIENCE,
    await scheduleViewer(),
  );
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="size-16 shrink-0 overflow-hidden rounded-full bg-ink/10">
          {profile?.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- already avatar-sized
            <img
              src={profile.imageUrl}
              alt=""
              className="size-full object-cover"
            />
          )}
        </div>
        <div>
          <h1 className="font-bebas text-3xl tracking-wide text-navy">
            {user.name.trim() || user.email}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink/60">
            <span className="font-mono text-xs">{user.email}</span>
            {!user.emailVerified && <span>unverified</span>}
            {user.role === "admin" && (
              <span className={`${TAG} bg-navy/10 text-navy`}>Admin</span>
            )}
            {user.banned && (
              <span className={`${TAG} bg-meeple/10 text-meeple`}>Banned</span>
            )}
          </p>
        </div>
      </div>

      <Section title="Profile">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <Field label="Name">{user.name || null}</Field>
          <Field label="Pronouns">{profile?.pronouns}</Field>
          <Field label="Discord">{profile?.discordHandle}</Field>
          <Field label="Shown to attendees">
            <Link
              href={`/u/${encodeURIComponent(user.id)}`}
              className="text-navy hover:text-meeple hover:underline"
            >
              {profile?.isPublic ? "Yes — open /u" : "No — open /u anyway"}
            </Link>
          </Field>
          <Field label="Website">{profile?.website}</Field>
          <Field label="Adult">{yesNo(profile?.isAdult)}</Field>
          <Field label="Bringing children">
            {yesNo(profile?.bringingChildren)}
          </Field>
          <Field label="Share with recruiters">
            {yesNo(profile?.shareWithRecruiters)}
          </Field>
          <Field label="Role">{user.role}</Field>
          <Field label="Ban">
            {user.banned
              ? [
                  "Banned",
                  user.banReason,
                  user.banExpires &&
                    `until ${shortDate.format(user.banExpires)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Not banned"}
          </Field>
          <Field label="Joined">{shortDate.format(user.createdAt)}</Field>
          {profile?.imageUrl && (
            <Field label="Picture">
              <a
                href={profile.imageUrl}
                className="text-navy hover:text-meeple hover:underline"
              >
                Open image
              </a>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Bio">
              {profile?.bio ? (
                <span className="whitespace-pre-line">{profile.bio}</span>
              ) : null}
            </Field>
          </div>
        </dl>
      </Section>

      <Section title="Access">
        <AccessPanel access={access} />
      </Section>

      <Section title="Tickets">
        {tickets.length === 0 ? (
          <p className="text-sm text-ink/50">
            No tickets bought, held or claimed.
          </p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {tickets.map((t) => {
              const people = ticketPeople(t, accounts, byEmail);
              return (
                <li key={t.paymentId} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{ticketLabel(t.tier)}</span>
                    <StatusTag status={t.status} />
                    {t.test && <TestTag />}
                    <span className="font-mono text-xs text-ink/60">
                      {formatTicketCode(t.ticketCode)}
                    </span>
                    {ticketRoles(t, user.id, user.email).map((r) => (
                      <span key={r} className={`${TAG} bg-sky text-navy`}>
                        {r}
                      </span>
                    ))}
                  </div>
                  <div className="grid gap-2 text-xs text-ink/60 sm:grid-cols-3">
                    <div>
                      Buyer <PersonLink person={people.buyer} />
                    </div>
                    <div>
                      Holder{" "}
                      {people.holderIsBuyer ? (
                        <span className="block">Buyer</span>
                      ) : (
                        <PersonLink person={people.holder} />
                      )}
                    </div>
                    <div>
                      Claimer <PersonLink person={people.claimer} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href={`/backstage/tickets?user=${encodeURIComponent(user.id)}`}
          className="mt-3 inline-block text-sm text-navy hover:text-meeple hover:underline"
        >
          Open in the tickets table
        </Link>
      </Section>

      <Section title="Sessions">
        <UserSessions
          sessions={sessions.sessions}
          locations={sessions.locations}
          roles={[...SESSION_ROLES]}
          linkable
          emptyLabel="Not hosting, shepherding or attending anything."
        />
      </Section>
    </div>
  );
}
