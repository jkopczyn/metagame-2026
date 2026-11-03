import type { Metadata } from "next";
import { env } from "@/env";
import { loadSteals } from "@/lib/hat-tricks-store";
import { buildHatTricksView, previewOverrides } from "@/lib/hat-tricks-view";
import ContentPage from "@/v2/components/ContentPage";
import { HEADING } from "@/v2/components/styles";
import HatCard from "@/v2/hat-tricks/HatCard";
import HatClock from "@/v2/hat-tricks/HatClock";
import Leaderboard from "@/v2/hat-tricks/Leaderboard";
import Rules from "@/v2/hat-tricks/Rules";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Hat Tricks — Metagame 2026",
  description: "A hat trick is when you trick someone and take their hat.",
};

const SECTION_HEADING = `${HEADING} mb-5 text-[clamp(24px,3vw,34px)] text-navy`;

export default async function HatTricksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const overrides = previewOverrides(params, process.env.VERCEL_ENV);

  const now = overrides?.now ?? new Date();
  const rawSchedule = overrides
    ? overrides.rawSchedule
    : env.HAT_TRICKS_SCHEDULE;
  const { steals, names } = overrides?.data ?? (await loadSteals());

  const view = buildHatTricksView({
    rawSchedule,
    steals,
    names,
    now,
    onScheduleError: (e) => console.error("HAT_TRICKS_SCHEDULE:", e),
  });
  const { state } = view;

  const refreshAt =
    state.kind === "on"
      ? state.endsAt
      : state.kind === "off"
        ? state.nextStartsAt
        : null;

  return (
    <ContentPage
      above={
        // eslint-disable-next-line @next/next/no-img-element -- static line art, decorative
        <img
          src="/images/hat-tricks/stack.svg"
          alt=""
          className="mb-4 h-40 w-auto"
        />
      }
      title="Hat Tricks"
      intro="A hat trick is when you trick someone and take their hat."
    >
      <section className="mb-14">
        <h2 className={SECTION_HEADING}>On shift now</h2>
        {state.kind === "on" ? (
          <div className="grid gap-5 sm:grid-cols-2">
            {state.hats.map((hat) => (
              <HatCard key={hat.id} hat={hat} />
            ))}
          </div>
        ) : (
          <p className="text-base text-ink/70">
            {state.kind === "off"
              ? `No hats can be stolen right now. Next shift starts at ${state.nextStartsAtLabel}.`
              : state.kind === "done"
                ? "The game is over."
                : "The schedule isn't posted yet."}
          </p>
        )}
      </section>

      <section className="mb-14">
        <HatClock
          nowIso={view.nowIso}
          nowLabel={view.nowLabel}
          refreshAt={refreshAt}
          endsAtLabel={state.kind === "on" ? state.endsAtLabel : null}
          nextLine={state.kind === "on" ? state.nextLine : null}
        />
      </section>

      <section className="mb-14">
        <h2 className={SECTION_HEADING}>Leaderboards</h2>
        <div className="space-y-8">
          <Leaderboard title="Overall" rows={view.overall} />
          {view.perHat.map((hat) => (
            <Leaderboard key={hat.id} title={hat.name} rows={hat.rows} />
          ))}
        </div>
        <p className="mt-6 text-sm text-ink/70">
          5 points per theft, plus points for every shift change you hold a hat
          through: 1, then 3, then 5, and so on.
        </p>
      </section>

      <section>
        <h2 className={SECTION_HEADING}>Rules</h2>
        <Rules />
      </section>
    </ContentPage>
  );
}
