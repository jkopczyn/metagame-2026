import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { loadProfileView } from "./data";
import { scheduleViewer } from "../../schedule/data";
import { currentSession } from "@/lib/auth";
import { activeClasses } from "@/lib/megagame-levels";
import { loadMegagameLevels } from "@/lib/megagame-store";
import { loadSchedule } from "@/lib/schedule-store";
import {
  PUBLIC_AUDIENCE,
  userSessions,
  websiteLabel,
} from "@/lib/user-profile";
import AccountWall from "@/v2/components/AccountWall";
import Avatar from "@/v2/components/Avatar";
import ContentPage from "@/v2/components/ContentPage";
import ClassBadges from "@/v2/components/megagame/ClassBadges";
import UserSessions from "@/v2/components/schedule/UserSessions";
import { HEADING } from "@/v2/components/styles";

// An attendee's profile. Signed-in only, and everything on it is either
// something the person typed into their own profile form or a session they're
// hosting; see PUBLIC_AUDIENCE in src/lib/user-profile.ts for what's left out.

const NOTICE = "mb-8 rounded-xl border px-4 py-3 text-sm";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold tracking-wide text-ink/50 uppercase">
        {label}
      </dt>
      <dd className="text-base text-ink">{children}</dd>
    </div>
  );
}

export async function generateMetadata(
  props: PageProps<"/u/[id]">,
): Promise<Metadata> {
  await connection();
  const view = await loadProfileView((await props.params).id);
  return {
    title: view ? `${view.profile.name} — Metagame 2026` : "Metagame 2026",
    // Attendees opted in to being visible to other attendees, not to search.
    robots: { index: false, follow: false },
  };
}

export default async function PublicProfilePage(props: PageProps<"/u/[id]">) {
  await connection();
  const { id } = await props.params;
  // Before the lookup, deliberately: every signed-out visitor gets this same
  // page whatever the id, so it says nothing about whose profiles exist.
  if (!(await currentSession())) {
    return (
      <AccountWall
        title="Profiles"
        body="Attendee profiles are only visible to people with an account."
        next={`/u/${id}`}
      />
    );
  }
  const view = await loadProfileView(id);
  if (!view) notFound();
  const { profile, access } = view;

  const [schedule, viewer, levels] = await Promise.all([
    loadSchedule(),
    scheduleViewer(),
    access === "private" ? null : loadMegagameLevels(id),
  ]);
  const { sessions, locations } = userSessions(
    id,
    schedule,
    null,
    PUBLIC_AUDIENCE,
    viewer,
  );

  return (
    <ContentPage title="Profile" wide>
      {access === "own-preview" && (
        <p className={`${NOTICE} border-tan/60 bg-peach/30 text-ink/80`}>
          Other attendees only see your name here. Tick “Show my profile to
          other attendees” on your{" "}
          <Link href="/account" className="underline underline-offset-2">
            account
          </Link>{" "}
          to show them the rest.
        </p>
      )}
      {access === "private" && (
        <p className={`${NOTICE} border-line bg-sky/40 text-ink/80`}>
          {profile.name} hasn’t shown their profile to other attendees.
        </p>
      )}
      {access === "team-private" && (
        <p className={`${NOTICE} border-line bg-sky/40 text-ink/80`}>
          {profile.name} hasn’t shown this profile to other attendees. You can
          see it because of your role.
        </p>
      )}
      <div className="flex max-w-[820px] flex-col gap-8 sm:flex-row sm:gap-10">
        <Avatar
          imageUrl={profile.imageUrl}
          name={profile.name}
          className="size-40 text-5xl"
        />
        <dl className="flex min-w-0 flex-1 flex-col gap-5">
          <Field label="Name">
            <span className="font-grotesk text-2xl font-bold text-navy">
              {profile.name}
            </span>
          </Field>
          {profile.pronouns && (
            <Field label="Pronouns">{profile.pronouns}</Field>
          )}
          {levels && activeClasses(levels).length > 0 && (
            <Field label="Megagame classes">
              <ClassBadges levels={levels} />
            </Field>
          )}
          {profile.website && (
            <Field label="Website">
              <a
                href={profile.website}
                rel="noopener nofollow ugc"
                className="break-all text-navy underline underline-offset-2 hover:text-meeple"
              >
                {websiteLabel(profile.website)}
              </a>
            </Field>
          )}
          {profile.bio && (
            <Field label="Bio">
              <span className="whitespace-pre-line">{profile.bio}</span>
            </Field>
          )}
        </dl>
      </div>
      <section className="mt-14 flex flex-col gap-5">
        <h2 className={`${HEADING} text-[clamp(24px,3vw,32px)] text-navy`}>
          Hosting
        </h2>
        <UserSessions
          sessions={sessions}
          locations={locations}
          roles={["hosting"]}
          linkable
          emptyLabel={`${profile.name} isn't hosting any sessions yet.`}
        />
      </section>
    </ContentPage>
  );
}
