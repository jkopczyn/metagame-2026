import { BOX, NOTE, TABLE, TD, TDN, TH, THN } from "./styles";
import { percent } from "./view";
import {
  CLASS_LABELS,
  MAX_LEVEL,
  MEGAGAME_CLASSES,
  type MegagameClass,
} from "@/lib/megagame-levels";

const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

export default function LevelGrid({
  grid,
  holders,
}: {
  grid: Record<MegagameClass, number[]>;
  holders: number;
}) {
  const share = (n: number) => percent(holders > 0 ? n / holders : null);
  return (
    <>
      <div className={BOX}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Level</th>
              {MEGAGAME_CLASSES.map((c) => (
                <th key={c} className={THN}>
                  {CLASS_LABELS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((level) => (
              <tr key={level}>
                <td className={TD}>{level}</td>
                {MEGAGAME_CLASSES.map((c) => (
                  <td key={c} className={TDN}>
                    {grid[c][level]}{" "}
                    <span className="text-ink/50">
                      ({share(grid[c][level])})
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={TD}>In class</td>
              {MEGAGAME_CLASSES.map((c) => {
                const n = grid[c].reduce((a, b) => a + b, 0);
                return (
                  <td key={c} className={TDN}>
                    {n} <span className="text-ink/50">({share(n)})</span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className={NOTE}>
        Players at each current level. Percentages are of the {holders} accounts
        that have claimed a paid ticket. There is no check-in data, so that is
        not a count of people at the con, and staff without a ticket can push a
        percentage up.
      </p>
    </>
  );
}
