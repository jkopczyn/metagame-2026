import Link from "next/link";
import { connection } from "next/server";
import SignIn from "../../SignIn";
import {
  fieldClass,
  selectClass,
  selectStyle,
  smallButtonClass,
} from "../../ui";
import ActiveToggle from "../ActiveToggle";
import { toolAccess } from "@/lib/admin-auth";
import { CLASS_LABELS, isMegagameClass } from "@/lib/megagame-levels";
import { cardBackground, stampList, stampsOf } from "@/lib/megagame-quests";
import {
  completionCountsByQuest,
  listQuests,
  type Quest,
} from "@/lib/megagame-store";
import { formatTicketCode } from "@/lib/ticket-code-format";

const first = (v: string | string[] | undefined) => [v].flat()[0] ?? "";
const PRINT_FORM = "print-selected";

export default async function QuestList(props: PageProps<"/backstage/quests">) {
  await connection();
  const sp = await props.searchParams;
  if (!(await toolAccess("megagame.manage")))
    return <SignIn next="/backstage/quests" />;

  const q = first(sp.q).trim().toLowerCase();
  const cls = first(sp.class);
  const activeFilter = first(sp.active);
  const [all, completions] = await Promise.all([
    listQuests(),
    completionCountsByQuest(),
  ]);
  const quests = all.filter(
    (quest) =>
      (!q ||
        quest.title.toLowerCase().includes(q) ||
        quest.bodyText.toLowerCase().includes(q) ||
        quest.code.toLowerCase().includes(q.replace(/[^a-z0-9]/g, ""))) &&
      (!cls || cardBackground(quest) === cls) &&
      (activeFilter === "" || quest.active === (activeFilter === "1")),
  );
  const activeCount = quests.filter((quest) => quest.active).length;
  const printAll = new URLSearchParams({ active: "1" });
  if (cls) printAll.set("class", cls);

  return (
    <div className="flex flex-col gap-6">
      {first(sp.deleted) && (
        <p role="status" className="text-sm text-moss">
          Quest deleted.
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-bebas text-3xl tracking-wide text-navy">
          Quests <span className="text-ink/50">({quests.length})</span>
        </h1>
        <form className="flex flex-wrap items-center gap-2" method="get">
          <input
            name="q"
            defaultValue={first(sp.q)}
            placeholder="Search title, text or code"
            className={`${fieldClass} w-56`}
          />
          <select
            name="class"
            defaultValue={cls}
            className={selectClass}
            style={selectStyle}
          >
            <option value="">All backgrounds</option>
            <option value="wizard">Wizard</option>
            <option value="pirate">Pirate</option>
            <option value="alien">Alien</option>
            <option value="star">Star (any class)</option>
          </select>
          <select
            name="active"
            defaultValue={activeFilter}
            className={selectClass}
            style={selectStyle}
          >
            <option value="">Active + withdrawn</option>
            <option value="1">Active only</option>
            <option value="0">Withdrawn only</option>
          </select>
          <button className={smallButtonClass}>Filter</button>
        </form>
      </div>

      <div className="flex flex-col gap-3">
        {/* The row checkboxes point at this form; the rows hold their own
            Active forms, so the table can't sit inside it. */}
        <form
          id={PRINT_FORM}
          method="get"
          action="/backstage/quests/print"
          target="_blank"
          className="flex flex-wrap items-center gap-2"
        >
          <button className={smallButtonClass}>Print selected</button>
          <Link
            href={`/backstage/quests/print?${printAll}`}
            target="_blank"
            className={smallButtonClass}
          >
            Print all active{cls ? ` ${cls}` : ""} ({activeCount})
          </Link>
          <span className="text-xs text-ink/60">
            Opens a page with one US Letter card per quest; print it from the
            browser.
          </span>
        </form>
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-cream text-left text-xs tracking-wide text-ink/60 uppercase">
              <tr>
                <th className="p-2" />
                <th className="p-2">Code</th>
                <th className="p-2">Title</th>
                <th className="p-2">Needs</th>
                <th className="p-2">Stamps</th>
                <th className="p-2">Pictures</th>
                <th className="p-2">Done</th>
                <th className="p-2">Active</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {quests.map((quest) => (
                <Row
                  key={quest.id}
                  quest={quest}
                  completions={completions.get(quest.id) ?? 0}
                />
              ))}
              {quests.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-4 text-ink/60">
                    No quests match.{" "}
                    <Link
                      href="/backstage/quests/new"
                      className="text-navy underline"
                    >
                      Add some.
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function needs(quest: Quest): string {
  const parts = [`${quest.minPlayers}+ players`];
  if (quest.class && isMegagameClass(quest.class)) {
    const window =
      quest.minLevel !== null && quest.maxLevel !== null
        ? `Lv ${quest.minLevel}–${quest.maxLevel}`
        : quest.minLevel !== null
          ? `Lv ${quest.minLevel}+`
          : quest.maxLevel !== null
            ? `Lv ≤${quest.maxLevel}`
            : "";
    parts.push(`${CLASS_LABELS[quest.class]} ${window}`.trim());
  }
  return parts.join(", ");
}

function Row({ quest, completions }: { quest: Quest; completions: number }) {
  const stamps = stampList(stampsOf(quest));
  const href = `/backstage/quests/${quest.id}`;
  return (
    <tr className={quest.active ? "" : "text-ink/50"}>
      <td className="p-2">
        <input
          type="checkbox"
          name="id"
          value={quest.id}
          form={PRINT_FORM}
          aria-label={`Select ${quest.title}`}
        />
      </td>
      <td className="p-2 font-mono whitespace-nowrap">
        <Link href={href} className="hover:text-meeple">
          {formatTicketCode(quest.code)}
        </Link>
      </td>
      <td className="p-2">
        <Link href={href} className="font-medium text-navy hover:text-meeple">
          {quest.title}
        </Link>
        {!quest.evidence && !quest.evidenceImage && (
          <span className="ml-2 rounded bg-meeple/10 px-1.5 py-0.5 text-xs text-meeple">
            no evidence
          </span>
        )}
      </td>
      <td className="p-2 whitespace-nowrap">{needs(quest)}</td>
      <td className="p-2 whitespace-nowrap">
        {stamps.length === 0
          ? "—"
          : stamps.map((s) => `${s.n} ${s.class}`).join(", ")}
      </td>
      <td className="p-2 tabular-nums">
        {quest.bodyImages.length}
        {quest.evidenceImage ? " + evidence" : ""}
      </td>
      <td className="p-2 tabular-nums">{completions}</td>
      <td className="p-2">
        <ActiveToggle id={quest.id} active={quest.active} />
      </td>
      <td className="p-2 whitespace-nowrap">
        <Link href={href} className="text-navy underline underline-offset-2">
          Edit
        </Link>{" "}
        <Link
          href={`/backstage/quests/print?id=${quest.id}`}
          target="_blank"
          className="ml-2 text-navy underline underline-offset-2"
        >
          Print
        </Link>
      </td>
    </tr>
  );
}
