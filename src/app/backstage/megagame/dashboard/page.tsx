import Link from "next/link";
import { connection } from "next/server";
import SignIn from "../../SignIn";
import Section from "../Section";
import AutoRefresh from "./AutoRefresh";
import ClassesSection from "./ClassesSection";
import CohortsSection from "./CohortsSection";
import ConcentrationSection from "./ConcentrationSection";
import LevelGrid from "./LevelGrid";
import TransitionsSection from "./TransitionsSection";
import { NOTE } from "./styles";
import {
  RANGE_LABELS,
  RANGE_PRESETS,
  dashboardView,
  viewHref,
  type DashboardView,
} from "./view";
import { toolAccess } from "@/lib/admin-auth";
import { activeUserIds, computeProgress } from "@/lib/megagame-progress";
import { BUCKET_SIZES, EVENT_TABLES } from "@/lib/megagame-rules";
import {
  claimedTicketHolderIds,
  liveCompletionLog,
  liveLevelEventLog,
  progressPlayers,
} from "@/lib/megagame-store";
import { PACIFIC } from "@/lib/schedule";

const REFRESH_SECONDS = 60;
const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  hour: "numeric",
  minute: "2-digit",
});
const PICK =
  "rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors";
const PICK_ON = `${PICK} border-navy bg-navy text-white`;
const PICK_OFF = `${PICK} border-line bg-white text-navy hover:border-navy`;

export default async function DashboardPage(
  props: PageProps<"/backstage/megagame/dashboard">,
) {
  await connection();
  const sp = await props.searchParams;
  const now = new Date();
  const view = dashboardView(sp, now);

  const access = await toolAccess("megagame.manage");
  if (!access) return <SignIn next={viewHref(view, {})} />;

  const [completions, levelEvents, holderIds] = await Promise.all([
    liveCompletionLog(),
    liveLevelEventLog(),
    claimedTicketHolderIds(),
  ]);
  const players = await progressPlayers(
    activeUserIds(completions, levelEvents),
  );
  const progress = computeProgress({
    completions,
    levelEvents,
    players,
    holderIds,
    buckets: view.buckets,
    size: view.size,
    to: view.to,
    now,
  });

  return (
    <div className="flex w-[min(64rem,calc(100vw-2rem))] flex-col gap-10 self-center">
      <AutoRefresh seconds={REFRESH_SECONDS} />
      <div className="flex flex-col gap-2">
        <h1 className="font-bebas text-3xl tracking-wide text-navy">
          Progress
        </h1>
        <p className={NOTE}>
          Updated {TIME.format(now)}. The page refreshes every minute. Voided
          records are left out. Deleted accounts count as one player.
        </p>
        <Pickers view={view} />
        <p className={NOTE}>
          The range and bucket apply to the over-time tables and charts. Every
          other figure covers all records so far.
        </p>
      </div>

      <Section title="Levels">
        <LevelGrid grid={progress.grid} holders={holderIds.length} />
      </Section>

      <Section title="Concentration">
        <ConcentrationSection
          data={progress.concentration}
          ends={progress.ends}
          size={view.size}
          tooMany={view.tooMany}
          rangeLabel={RANGE_LABELS[view.preset]}
        />
      </Section>

      <Section title="Classes">
        <ClassesSection
          table={progress.classes}
          cumulative={progress.cumulative}
          ends={progress.ends}
          size={view.size}
          tooMany={view.tooMany}
          rangeLabel={RANGE_LABELS[view.preset]}
        />
      </Section>

      <Section title="Level transitions">
        <TransitionsSection data={progress.transitions} />
      </Section>

      <Section title="Cohorts">
        <CohortsSection data={progress.cohorts} />
      </Section>

      <Section title="Export">
        <ul className="flex flex-col gap-2">
          {EVENT_TABLES.map((t) => (
            <li key={t}>
              <a
                href={`/backstage/megagame/dashboard/export/${t}`}
                download={`${t}.csv`}
                className="font-semibold text-navy underline underline-offset-2 hover:text-meeple"
              >
                {t}.csv
              </a>
            </li>
          ))}
        </ul>
        <p className={NOTE}>
          Every row of each table, voided ones included. People and quests
          appear as ids.
        </p>
      </Section>
    </div>
  );
}

function Pickers({ view }: { view: DashboardView }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" aria-label="Range">
        {RANGE_PRESETS.map((p) => (
          <Link
            key={p}
            href={viewHref(view, { range: p })}
            replace
            scroll={false}
            className={p === view.preset ? PICK_ON : PICK_OFF}
          >
            {RANGE_LABELS[p]}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Bucket size">
        {BUCKET_SIZES.map((s) => (
          <Link
            key={s}
            href={viewHref(view, { bucket: s })}
            replace
            scroll={false}
            className={s === view.size ? PICK_ON : PICK_OFF}
          >
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}
