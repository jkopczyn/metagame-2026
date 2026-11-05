import { BOX, NOTE, TABLE, TD, TDN, TH, THN } from "./styles";
import { dayLabel, formatDuration } from "./view";
import { CLASS_LABELS } from "@/lib/megagame-levels";
import type { Transitions } from "@/lib/megagame-progress";
import { CONFERENCE_DAYS } from "@/lib/schedule";

export default function TransitionsSection({ data }: { data: Transitions }) {
  return (
    <>
      <h3 className="font-semibold text-navy">Level-ups</h3>
      <div className={BOX}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Class</th>
              <th className={TH}>Step</th>
              <th className={THN}>Made</th>
              <th className={THN}>Skipped past</th>
              <th className={THN}>25th percentile</th>
              <th className={THN}>Median</th>
              <th className={THN}>75th percentile</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={`${row.class}-${row.from}`}>
                <td className={TD}>
                  {data.rows[i - 1]?.class === row.class
                    ? ""
                    : CLASS_LABELS[row.class]}
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  {row.from} → {row.to}
                </td>
                <td className={TDN}>{row.made}</td>
                <td className={TDN}>{row.skipped}</td>
                <td className={TDN}>{formatDuration(row.q25)}</td>
                <td className={TDN}>{formatDuration(row.median)}</td>
                <td className={TDN}>{formatDuration(row.q75)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="font-semibold text-navy">Time at the current level</h3>
      <div className={BOX}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Class</th>
              <th className={THN}>Level</th>
              <th className={THN}>Players</th>
              <th className={THN}>With a level-up record</th>
              <th className={THN}>Median time at level</th>
            </tr>
          </thead>
          <tbody>
            {data.current.map((row, i) => (
              <tr key={`${row.class}-${row.level}`}>
                <td className={TD}>
                  {data.current[i - 1]?.class === row.class
                    ? ""
                    : CLASS_LABELS[row.class]}
                </td>
                <td className={TDN}>{row.level}</td>
                <td className={TDN}>{row.players}</td>
                <td className={TDN}>{row.withEvent}</td>
                <td className={TDN}>{formatDuration(row.medianSince)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={NOTE}>
        Times count from the later of the earlier level-up and the start of the
        con (midnight Pacific, {dayLabel(CONFERENCE_DAYS[0].key)}), so time at
        level 1 means time at the con before the first level-up. Skipped past
        counts players who went from this level straight to a higher one than
        the next; they are left out of the times. Players whose current level
        has no level-up record are counted but left out of the median. Deleted
        accounts are left out.
      </p>
    </>
  );
}
