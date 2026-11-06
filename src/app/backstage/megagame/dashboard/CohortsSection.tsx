import { BOX, NOTE, TABLE, TD, TDN, TH, THN } from "./styles";
import { dayLabel, decimal, percent } from "./view";
import type { CohortTable } from "@/lib/megagame-progress";

export default function CohortsSection({ data }: { data: CohortTable }) {
  return (
    <>
      <div className={BOX}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>First active</th>
              <th className={THN}>Players</th>
              <th className={THN}>Completions per player (mean)</th>
              <th className={THN}>(median)</th>
              <th className={THN}>Level-ups per player (mean)</th>
              <th className={THN}>Reached level 2+</th>
              {data.days.map((day) => (
                <th key={day} className={THN}>
                  Active {dayLabel(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.day}>
                <td className={`${TD} whitespace-nowrap`}>
                  {dayLabel(row.day)}
                </td>
                <td className={TDN}>{row.size}</td>
                <td className={TDN}>{decimal(row.completionsMean)}</td>
                <td className={TDN}>{decimal(row.completionsMedian)}</td>
                <td className={TDN}>{decimal(row.levelUpsMean)}</td>
                <td className={TDN}>{percent(row.reachedLevel2Share)}</td>
                {row.retention.map((share, i) => (
                  <td key={data.days[i] ?? i} className={TDN}>
                    {percent(share)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink">
        {data.notYetActive} of {data.holders} claimed-ticket holders have no
        completions or level-ups yet ({percent(data.notYetActiveShare)}).
      </p>
      <p className={NOTE}>
        A player&apos;s cohort is the Pacific day of their first completion or
        volunteer level-up; faction picks do not count. Cohorts cover the whole
        con whatever range is picked above. Activity before the first con day
        appears as its own cohort row and is not counted as not yet active.
        Deleted accounts are left out.
      </p>
    </>
  );
}
