import { CLASS_COLORS, Legend } from "../over-time/charts";
import { levelsText, when } from "../format";
import { LineChart, LorenzPlot } from "./charts";
import { ALERT, BOX, NOTE, TABLE, TD, TDN, TH, THN } from "./styles";
import { EMPTY_RANGE, decimal, endLabel, percent } from "./view";
import {
  CLASS_LABELS,
  MEGAGAME_CLASSES,
  type MegagameClass,
} from "@/lib/megagame-levels";
import type { BucketSize } from "@/lib/megagame-rules";
import type { Concentration, ShareSummary } from "@/lib/megagame-progress";

const OVERALL_COLOR = "#173059";
const GINI_COLOR = "#C2410C";

function Headline({
  title,
  playersLabel,
  s,
}: {
  title: string;
  playersLabel: string;
  s: ShareSummary;
}) {
  const rows: [string, string][] = [
    [playersLabel, String(s.players)],
    ["Total", String(s.total)],
    ["Top 10%", percent(s.top10)],
    ["Top 20%", percent(s.top20)],
    ["Top 50%", percent(s.top50)],
    ["Gini", decimal(s.gini, 2)],
  ];
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-white p-3">
      <h3 className="font-semibold text-navy">{title}</h3>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink/60">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OverTime({
  data,
  ends,
  size,
  tooMany,
  rangeLabel,
}: {
  data: Concentration;
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
  const series = [
    {
      name: "Top 20% share",
      color: OVERALL_COLOR,
      values: data.series.map((p) => p.top20),
    },
    {
      name: "Gini",
      color: GINI_COLOR,
      values: data.series.map((p) => p.gini),
    },
  ];
  return (
    <>
      <LineChart
        label="Top 20% share and Gini of completions as of the end of each bucket"
        series={series}
        first={endLabel(ends[0], size)}
        last={endLabel(ends.at(-1)!, size)}
      />
      <Legend series={series} />
      <p className={NOTE}>
        The top 20% share and the Gini coefficient are both fractions of 1, so a
        share of 0.5 on the chart is 50% in the table.
      </p>
      <div className={BOX}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>As of</th>
              <th className={THN}>Players</th>
              <th className={THN}>Completions</th>
              <th className={THN}>Top 20%</th>
              <th className={THN}>Gini</th>
            </tr>
          </thead>
          <tbody>
            {data.series.map((p) => (
              <tr key={p.end.getTime()}>
                <td className={TD}>{endLabel(p.end, size)}</td>
                <td className={TDN}>{p.players}</td>
                <td className={TDN}>{p.completions}</td>
                <td className={TDN}>{percent(p.top20)}</td>
                <td className={TDN}>{decimal(p.gini, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ConcentrationSection({
  data,
  ends,
  size,
  tooMany,
  rangeLabel,
}: {
  data: Concentration;
  ends: Date[];
  size: BucketSize;
  tooMany: boolean;
  rangeLabel: string;
}) {
  const lorenzLines = [
    { name: "All quests", color: OVERALL_COLOR, points: data.lorenz.overall },
    ...MEGAGAME_CLASSES.map((c: MegagameClass) => ({
      name: CLASS_LABELS[c],
      color: CLASS_COLORS[c],
      points: data.lorenz.byClass[c],
    })),
  ];
  const lorenzRows: [string, ShareSummary][] = [
    ["All quests", data.completions],
    ...MEGAGAME_CLASSES.map((c): [string, ShareSummary] => [
      CLASS_LABELS[c],
      data.byClass[c],
    ]),
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Headline
          title="Quest completions"
          playersLabel="Active players"
          s={data.completions}
        />
        <Headline
          title="Volunteer level-ups"
          playersLabel="Players leveling"
          s={data.levelUps}
        />
      </div>
      <p className={NOTE}>
        The top 20% of active players hold {percent(data.completions.top20)} of
        completions.
      </p>

      <h3 className="font-semibold text-navy">Completions per player</h3>
      <figure className="flex flex-col gap-2">
        <LorenzPlot
          label="Lorenz curve of completions per player, overall and by class"
          lines={lorenzLines}
        />
        <Legend series={lorenzLines} />
      </figure>
      <div className={BOX}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Quests</th>
              <th className={THN}>Players</th>
              <th className={THN}>Completions</th>
              <th className={THN}>Top 20%</th>
              <th className={THN}>Gini</th>
            </tr>
          </thead>
          <tbody>
            {lorenzRows.map(([name, s]) => (
              <tr key={name}>
                <td className={TD}>{name}</td>
                <td className={TDN}>{s.players}</td>
                <td className={TDN}>{s.total}</td>
                <td className={TDN}>{percent(s.top20)}</td>
                <td className={TDN}>{decimal(s.gini, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={NOTE}>
        The dashed diagonal is an even split. The further a curve is below it,
        the larger the share of completions held by the most active players.
      </p>

      <h3 className="font-semibold text-navy">Over time</h3>
      <OverTime
        data={data}
        ends={ends}
        size={size}
        tooMany={tooMany}
        rangeLabel={rangeLabel}
      />

      <h3 className="font-semibold text-navy">Most active</h3>
      {data.mostActive.length === 0 ? (
        <p className={NOTE}>No completions yet.</p>
      ) : (
        <div className={BOX}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Player</th>
                <th className={TH}>Levels</th>
                <th className={THN}>Completions</th>
                {MEGAGAME_CLASSES.map((c) => (
                  <th key={c} className={THN}>
                    {CLASS_LABELS[c]}
                  </th>
                ))}
                <th className={THN}>Any class</th>
                <th className={THN}>Level-ups</th>
                <th className={TH}>First</th>
                <th className={TH}>Last</th>
              </tr>
            </thead>
            <tbody>
              {data.mostActive.map((row) => (
                <tr key={row.key}>
                  <td className={TD}>{row.name ?? "Deleted account"}</td>
                  <td className={TD}>{levelsText(row.levels)}</td>
                  <td className={TDN}>{row.completions}</td>
                  {MEGAGAME_CLASSES.map((c) => (
                    <td key={c} className={TDN}>
                      {row.byClass[c]}
                    </td>
                  ))}
                  <td className={TDN}>{row.anyClass}</td>
                  <td className={TDN}>{row.levelUps}</td>
                  <td className={TD}>{when(row.firstActivity)}</td>
                  <td className={TD}>{when(row.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
