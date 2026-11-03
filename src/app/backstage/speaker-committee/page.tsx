import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { setSchedulePane } from "./actions";
import { schedulePaneOn } from "./pane";
import ScheduleBoard, { type Group, type QueueRow } from "./ScheduleBoard";
import {
  byShepherd,
  compare,
  groupLabel,
  GROUPINGS,
  myCounts,
  stepsOf,
  tabRows,
  TABS,
  type Grouping,
  type Tab,
  type TabKey,
} from "./pipeline";
import {
  PATH,
  SORTS,
  SubmissionGroup,
  type Row,
  type SortKey,
  type SortState,
  type TableMeta,
} from "./SubmissionTable";
import { smallButtonClass } from "@/app/backstage/ui";
import ToolSignIn from "@/components/ToolSignIn";
import { can } from "@/lib/access";
import { durationMinutes } from "@/lib/rfp-fields";
import { pipelineOptions, toRow } from "@/lib/rfp-pipeline";
import { committeeAccounts, listRfpSessions } from "@/lib/rfp-sessions";
import { DEFAULT_DRAFT_MINUTES, END_GAP_MINUTES } from "@/lib/schedule";
import { loadRsvpCounts, loadSchedule } from "@/lib/schedule-store";

const MODES = [
  { key: "mine", label: "Assigned to me" },
  { key: "all", label: "All" },
] as const;
type Mode = (typeof MODES)[number]["key"];

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

function PipelineTabs({
  active,
  mode,
  grouping,
  counts,
}: {
  active: TabKey;
  mode: Mode;
  grouping: Grouping;
  counts: Record<TabKey, number>;
}) {
  return (
    <nav aria-label="Pipeline" className="-mx-4 overflow-x-auto px-4 pb-1">
      <ol className="flex min-w-max">
        {TABS.map((t, i) => {
          const on = t.key === active;
          const n = counts[t.key];
          // Chevrons: each step notched on the left and pointed on the right,
          // overlapping its neighbour so the row reads as one flow.
          const shape =
            i === 0
              ? "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)"
              : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)";
          return (
            <li key={t.key} className={i > 0 ? "-ml-1.5" : ""}>
              <Link
                href={{
                  pathname: PATH,
                  query: { who: mode, tab: t.key, group: grouping },
                }}
                aria-current={on ? "page" : undefined}
                style={{ clipPath: shape }}
                className={`flex items-center gap-1.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  i === 0 ? "pr-6 pl-4" : "pr-6 pl-6"
                } ${on ? "bg-navy text-cream" : "bg-ink/8 text-ink/70 hover:bg-ink/14"} ${
                  // "All" stands apart from the steps that follow it.
                  i === 0 ? "mr-2" : ""
                }`}
              >
                {t.label}
                <span
                  title={`${n} assigned to you`}
                  className={`min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums ${
                    n > 0
                      ? "bg-meeple text-white"
                      : on
                        ? "bg-cream/20 text-cream/70"
                        : "bg-ink/8 text-ink/40"
                  }`}
                >
                  {n}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default async function SpeakerCommitteePage(
  props: PageProps<"/backstage/speaker-committee">,
) {
  // Per-request on every branch, or the sign-in branch gets baked in as
  // static at build time.
  await connection();

  // Accounts only: the /grade password cookie is scoped to /grade.
  const account = await can("schedule.manage");
  if (!account) {
    return <ToolSignIn title="Speaker committee" next={PATH} />;
  }
  const me = account.user.id;

  // The schedule comes along on every tab now: each row names the slot it
  // sits in, which needs the room names.
  const [rfpSessions, committee, pane, schedule, grader] = await Promise.all([
    listRfpSessions(),
    committeeAccounts(),
    schedulePaneOn(),
    loadSchedule(),
    can("submissions.grade"),
  ]);
  const rows = rfpSessions.map(toRow);

  const params = await props.searchParams;
  // Someone with nothing assigned lands on All rather than an empty board.
  const hasMine = rows.some(
    (r) => r.graderIds.includes(me) || r.shepherdId === me,
  );
  const mode: Mode =
    first(params.who) === "all" || (!first(params.who) && !hasMine)
      ? "all"
      : "mine";
  const mineOnly = mode === "mine";
  const tab: Tab = TABS.find((t) => t.key === first(params.tab)) ?? TABS[0];
  const rawQuery = first(params.q);
  const query = rawQuery.trim().toLowerCase();
  const sort = (SORTS.find((s) => s === first(params.sort)) ??
    "proposal") as SortKey;
  const dir = first(params.dir) === "desc" ? "desc" : "asc";
  const grouping: Grouping =
    first(params.group) === "shepherd" ? "shepherd" : "step";
  const state: SortState = {
    sort,
    dir,
    q: rawQuery,
    base: { who: mode, tab: tab.key, group: grouping },
  };

  const meta: TableMeta = {
    options: pipelineOptions(committee.map((a) => a.committeeName)),
    rooms: Object.fromEntries(schedule.locations.map((l) => [l.id, l.name])),
    linkSessions: true,
    // The pills save through the grading actions, so a scheduler who can't
    // grade sees them but can't open them.
    editable: grader !== null,
  };

  const visible = tabRows(rows, tab, me, mineOnly)
    .filter(
      (s) =>
        !query ||
        s.title.toLowerCase().includes(query) ||
        s.host.toLowerCase().includes(query),
    )
    .sort((a, b) => (dir === "asc" ? 1 : -1) * compare(a, b, sort));

  const header = (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <Link
            key={m.key}
            href={{
              pathname: PATH,
              query: { who: m.key, tab: tab.key, group: grouping },
            }}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              m.key === mode
                ? "bg-navy text-cream"
                : "bg-ink/6 text-ink/70 hover:bg-ink/12"
            }`}
          >
            {m.label}
          </Link>
        ))}
        {/* Desktop only: the side-by-side view has no room on a phone. */}
        <form
          action={setSchedulePane.bind(null, !pane)}
          className="ml-auto hidden md:block"
        >
          <button
            type="submit"
            className={`${smallButtonClass} inline-flex items-center gap-1.5`}
          >
            {pane ? (
              <PanelRightCloseIcon className="size-4" aria-hidden="true" />
            ) : (
              <PanelRightOpenIcon className="size-4" aria-hidden="true" />
            )}
            {pane ? "Hide schedule" : "Show schedule"}
          </button>
        </form>
      </nav>
      <PipelineTabs
        active={tab.key}
        mode={mode}
        grouping={grouping}
        counts={myCounts(rows, me)}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-ink/60">{tab.blurb}</p>
        {/* Only All groups; every other tab is one step already. */}
        {tab.key === "all" && (
          <nav aria-label="Grouping" className="flex items-center gap-1.5">
            {GROUPINGS.map((g) => (
              <Link
                key={g.key}
                href={{
                  pathname: PATH,
                  query: { who: mode, tab: tab.key, group: g.key },
                }}
                aria-current={g.key === grouping ? "true" : undefined}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  g.key === grouping
                    ? "bg-navy/10 text-navy"
                    : "text-ink/50 hover:bg-ink/6 hover:text-ink/70"
                }`}
              >
                {g.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );

  // The grid shows on the schedule tab, or beside every tab with the pane on.
  const withGrid = tab.key === "schedule" || pane;
  const rsvps = withGrid ? await loadRsvpCounts() : null;

  const groups: { title: string; rows: Row[] }[] =
    tab.key === "all"
      ? grouping === "shepherd"
        ? byShepherd(visible)
        : stepsOf(visible).map((step) => ({
            title: groupLabel(step),
            rows: visible.filter((s) => s.nextSteps === step),
          }))
      : tab.key === "schedule"
        ? [
            {
              title: "Needs a slot",
              rows: visible.filter((r) => !r.placed),
            },
            { title: "Placed", rows: visible.filter((r) => r.placed) },
          ]
        : [{ title: tab.label, rows: visible }];

  const list = (
    <>
      {/* Plain GET form: filtering needs no client JS. */}
      <form action={PATH} className="flex gap-2">
        <input type="hidden" name="who" value={mode} />
        <input type="hidden" name="tab" value={tab.key} />
        <input type="hidden" name="group" value={grouping} />
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <input
          type="search"
          name="q"
          defaultValue={rawQuery}
          placeholder="Search title or host"
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-navy"
        />
        <button
          type="submit"
          className="rounded-lg border border-line px-4 text-sm hover:bg-ink/5"
        >
          Search
        </button>
      </form>
      {visible.length === 0 && (
        <p className="py-8 text-center text-sm text-ink/55">
          {query
            ? "No proposals match. Try clearing the search."
            : mineOnly
              ? "Nothing here is assigned to you."
              : "Nothing at this step."}
        </p>
      )}
    </>
  );

  if (rsvps) {
    const byId = new Map(rfpSessions.map((s) => [s.sessionId, s]));
    const forGrid = (r: Row): QueueRow => {
      const row = byId.get(r.id)?.row;
      return {
        ...r,
        minutes:
          durationMinutes(row?.requestedDuration) ??
          DEFAULT_DRAFT_MINUTES - END_GAP_MINUTES,
        category: row?.category ?? null,
      };
    };
    const gridGroups: Group[] = groups.map((g) => ({
      ...g,
      rows: g.rows.map(forGrid),
    }));
    return (
      <div className="space-y-6">
        {header}
        <ScheduleBoard
          sessions={schedule.sessions}
          groups={gridGroups}
          locations={schedule.locations}
          going={Object.fromEntries(
            Object.entries(rsvps).map(([id, c]) => [id, c.going]),
          )}
          proposals={Object.fromEntries(rows.map((r) => [r.id, r]))}
          mutedIds={
            mineOnly
              ? schedule.sessions
                  .filter((s) => s.shepherd?.userId !== me)
                  .map((s) => s.id)
              : []
          }
          state={state}
          meta={meta}
          split={pane}
        >
          {list}
        </ScheduleBoard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {list}
      {groups.map((g) => (
        <SubmissionGroup
          key={g.title}
          title={g.title}
          rows={g.rows}
          state={state}
          meta={meta}
        />
      ))}
    </div>
  );
}
