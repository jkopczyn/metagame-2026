import type { LeaderRow } from "@/lib/hat-tricks-score";
import { HEADING } from "@/v2/components/styles";

const HEAD =
  "px-3 py-2 font-space-mono text-[13px] tracking-[0.12em] text-ink/70 uppercase";

export default function Leaderboard({
  title,
  rows,
}: {
  title: string;
  rows: LeaderRow[];
}) {
  return (
    <div>
      <h3 className={`${HEADING} mb-3 text-[22px] text-navy`}>{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/70">No steals yet.</p>
      ) : (
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} w-16 text-left`}>
                Rank
              </th>
              <th scope="col" className={`${HEAD} text-left`}>
                Name
              </th>
              <th scope="col" className={`${HEAD} w-24 text-right`}>
                Steals
              </th>
              <th scope="col" className={`${HEAD} w-24 text-right`}>
                Points
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-t border-line">
                <td className="px-3 py-2">{row.rank}</td>
                <td className="px-3 py-2 font-semibold text-ink">{row.name}</td>
                <td className="px-3 py-2 text-right">{row.steals}</td>
                <td className="px-3 py-2 text-right">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
