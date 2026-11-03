import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GiTheaterCurtains } from "react-icons/gi";
import { PasswordForm, ProfileForm, SignOutButton } from "./AccountForms";
import AccountTabs from "./AccountTabs";
import AvatarForm from "./AvatarForm";
import MegagamePanel from "./MegagamePanel";
import MegagameSummary from "./MegagameSummary";
import SessionsPanel from "./SessionsPanel";
import TicketsPanel from "./TicketsPanel";
import { parseAccountTab } from "./tabs";
import { getDb, schema } from "@/db";
import { accountSessions } from "@/lib/account-sessions";
import { can, teamAccess } from "@/lib/access";
import { currentSession, hasPassword } from "@/lib/auth";
import { prefillDiscord } from "@/lib/discord-handle";
import {
  ensurePlayerCode,
  hasVolunteerLevelEvent,
  loadMegagameLevels,
} from "@/lib/megagame-store";
import {
  loadRsvpCounts,
  loadSchedule,
  loadViewerPlans,
} from "@/lib/schedule-store";
import { mintReferralCodes, referrerNames } from "@/lib/referral-store";
import { emailKey, ticketsForUser } from "@/lib/ticket-store";
import { ticketView } from "@/lib/ticket-view";
import { Button } from "@/v2/components/ui/button";

export const metadata: Metadata = {
  title: "Account — Metagame 2026",
  robots: { index: false },
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab = parseAccountTab(tab);
  const session = await currentSession();
  if (!session)
    redirect(
      `/login?next=${encodeURIComponent(initialTab === "profile" ? "/account" : `/account?tab=${initialTab}`)}`,
    );
  const { user } = session;

  const email = emailKey(user.email);
  const [
    [profile],
    passwordSet,
    rows,
    schedule,
    plans,
    counts,
    admin,
    backstage,
    levels,
    playerCode,
    megagameLocked,
  ] = await Promise.all([
    getDb()
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, user.id))
      .limit(1),
    hasPassword(user.id),
    ticketsForUser(user.id, email),
    loadSchedule(),
    loadViewerPlans(user.id),
    loadRsvpCounts(),
    can("schedule.manage"),
    teamAccess().then((a) => a?.team ?? false),
    loadMegagameLevels(user.id),
    ensurePlayerCode(user.id),
    hasVolunteerLevelEvent(user.id),
  ]);
  // Referral codes are minted the first time their holder looks.
  const [, referrers] = await Promise.all([
    mintReferralCodes(rows, user.id, email).catch((err) =>
      console.error("[account] referral codes not minted:", err),
    ),
    referrerNames(
      rows.flatMap((t) =>
        t.referredByPaymentId ? [t.referredByPaymentId] : [],
      ),
    ),
  ]);
  const tickets = rows.map((t) =>
    ticketView(
      t,
      user.id,
      email,
      (t.referredByPaymentId && referrers.get(t.referredByPaymentId)) || null,
    ),
  );

  return (
    // Same measure and top clearance as ContentPage, without its title block.
    <div className="mx-auto max-w-[1180px] px-8 pt-28 pb-20">
      <AccountTabs
        initial={initialTab}
        trailing={
          backstage && (
            <Button
              asChild
              variant="navy"
              size="sm"
              className="max-sm:size-8 max-sm:p-0 max-sm:[&_svg]:size-4"
            >
              <Link href="/backstage">
                <GiTheaterCurtains aria-hidden />
                <span className="sr-only sm:not-sr-only">Backstage</span>
              </Link>
            </Button>
          )
        }
        panels={{
          profile: (
            <div className="flex max-w-[960px] flex-col gap-10">
              <MegagameSummary levels={levels} />
              <AvatarForm
                imageUrl={profile?.imageUrl ?? null}
                name={user.name}
              />
              <div className="grid gap-12 md:grid-cols-2">
                <ProfileForm
                  email={user.email}
                  profileHref={`/u/${encodeURIComponent(user.id)}`}
                  initialValues={{
                    name: user.name,
                    pronouns: profile?.pronouns ?? "",
                    discordHandle: prefillDiscord(
                      profile?.discordHandle,
                      rows,
                      email,
                    ),
                    bio: profile?.bio ?? "",
                    isPublic: profile?.isPublic ?? false,
                  }}
                />
                <div className="flex flex-col gap-10">
                  <PasswordForm hasPassword={passwordSet} email={user.email} />
                  <SignOutButton />
                </div>
              </div>
            </div>
          ),
          // TicketsPanel carries its own top margin from when it sat below the profile.
          tickets: (
            <div className="[&>section]:mt-0">
              <TicketsPanel tickets={tickets} />
            </div>
          ),
          sessions: (
            <SessionsPanel
              linkable
              sessions={accountSessions(
                user.id,
                schedule.sessions,
                schedule.locations,
                plans,
                counts,
                admin !== null,
              )}
            />
          ),
          megagame: (
            <MegagamePanel
              levels={levels}
              playerCode={playerCode}
              locked={megagameLocked}
            />
          ),
        }}
      />
    </div>
  );
}
