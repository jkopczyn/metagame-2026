import { CLASS_COLORS, Legend } from "../over-time/charts";
import { ClassLevelBars } from "./charts";
import { ALERT, BOX, NOTE, TABLE, TD, TDN, TH, THN } from "./styles";
import { EMPTY_RANGE, bucketLabel, endLabel, percent } from "./view";
import {
  CLASS_LABELS,
  MEGAGAME_CLASSES,
  type MegagameClass,
} from "@/lib/megagame-levels";
import type { BucketSize } from "@/lib/megagame-rules";
import type { ClassCell, ClassTable } from "@/lib/megagame-progress";

const GROUP = "border-l border-line";

function Cells({ cell }: { cell: ClassCell }) {
  return (
    <>
      <td className={`${TDN} ${GROUP}`}>{cell.completions}</td>
      <td className={TDN}>{cell.levelUps}</td>
      <td className={TDN}>{cell.activePlayers}</td>
      <td className={TDN}>{percent(cell.memberShare)}</td>
    </>
  );
}

export default function ClassesSection({
  table,
  cumulative,
  ends,
  size,
  tooMany,
  rangeLabel,
}: {
  table: ClassTable;
  cumulative: Record<MegagameClass, number[]>[];
  ends: Date[];
  size: BucketSize;
  tooMany: boolean;
  rangeLabel: string;
}) {
  if (tooMany)
    return (
      <p role="alert" className={ALERT}>
        {rangeLabel} in {size} buckets is too many rows to show. Pick a bigger
        bucket.
      </p>
    );
  if (ends.length === 0) return <p className={NOTE}>{EMPTY_RANGE}</p>;

  const legend = MEGAGAME_CLASSES.map((c) => ({
    name: CLASS_LABELS[c],
    color: CLASS_COLORS[c],
  }));
  const barRows = cumulative.map((byClass, i) => ({
    label: endLabel(ends[i], size),
    byClass,
  }));
  const first = barRows[0]?.label;
  const last = barRows.at(-1)?.label;

  return (
    <>
      <div className={BOX}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH} rowSpan={2}>
                Bucket start
              </th>
              {MEGAGAME_CLASSES.map((c) => (
                <th
                  key={c}
                  className={`${TH} ${GROUP} text-center`}
                  colSpan={4}
                >
                  {CLASS_LABELS[c]}
                </th>
              ))}
              <th className={`${THN} ${GROUP}`} rowSpan={2}>
                Any class
              </th>
            </tr>
            <tr>
              {MEGAGAME_CLASSES.map((c) => (
                <ClassHeads key={c} />
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.start.getTime()}>
                <td className={TD}>{bucketLabel(row.start, size)}</td>
                {MEGAGAME_CLASSES.map((c) => (
                  <Cells key={c} cell={row.byClass[c]} />
                ))}
                <td className={`${TDN} ${GROUP}`}>{row.anyClass}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={TD}>Total</td>
              {MEGAGAME_CLASSES.map((c) => (
                <Cells key={c} cell={table.totals.byClass[c]} />
              ))}
              <td className={`${TDN} ${GROUP}`}>{table.totals.anyClass}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={NOTE}>
        Active means a completion of one of the class&apos;s quests or a
        volunteer level-up in the class; faction picks do not count. Members are
        players at level 1 or higher in the class now: wizard{" "}
        {table.members.wizard}, pirate {table.members.pirate}, alien{" "}
        {table.members.alien}. Any-class quests count only in their own column.
      </p>

      <h3 className="font-semibold text-navy">Levels over time</h3>
      <Legend series={legend} />
      <figure className="flex flex-col gap-1">
        <ClassLevelBars
          label="Players at each level by class as of the end of each bucket"
          rows={barRows}
        />
        <figcaption className="flex justify-between text-xs text-ink/50">
          <span>{first}</span>
          {last !== first && <span>{last}</span>}
        </figcaption>
      </figure>
      <div className={BOX}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>As of</th>
              {MEGAGAME_CLASSES.map((c) => (
                <th key={c} className={TH} colSpan={2}>
                  {CLASS_LABELS[c]}
                </th>
              ))}
            </tr>
            <tr>
              <th className={TH} />
              {MEGAGAME_CLASSES.map((c) => (
                <LevelHeads key={c} />
              ))}
            </tr>
          </thead>
          <tbody>
            {barRows.map((row, i) => (
              <tr key={i}>
                <td className={TD}>{row.label}</td>
                {MEGAGAME_CLASSES.map((c) => {
                  const counts = row.byClass[c].slice(1);
                  return (
                    <LevelCells
                      key={c}
                      text={counts.join(" / ")}
                      total={counts.reduce((a, b) => a + b, 0)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={NOTE}>
        Players at each level as of the end of each bucket, counted from the
        level-up log rather than the current level columns, so the last row can
        differ slightly from the level grid at the top. Undone level-ups are
        left out of every row, so a player who switched class through the picker
        shows only in the new class, even in rows from before the switch.
        Faction picks count as level 1 from the time of the pick.
      </p>
    </>
  );
}

function ClassHeads() {
  return (
    <>
      <th className={`${THN} ${GROUP}`}>Completions</th>
      <th className={THN}>Level-ups</th>
      <th className={THN}>Active</th>
      <th className={THN}>% of members</th>
    </>
  );
}

function LevelHeads() {
  return (
    <>
      <th className={TH}>Levels 1 to 5</th>
      <th className={THN}>In class</th>
    </>
  );
}

function LevelCells({ text, total }: { text: string; total: number }) {
  return (
    <>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>{text}</td>
      <td className={TDN}>{total}</td>
    </>
  );
}
