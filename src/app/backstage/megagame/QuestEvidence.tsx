import { CLASS_LABELS } from "@/lib/megagame-levels";
import { stampList, stampsOf } from "@/lib/megagame-quests";
import type { Quest } from "@/lib/megagame-store";

const stampLabel = (c: "wizard" | "pirate" | "alien" | "any") =>
  c === "any" ? "any class" : CLASS_LABELS[c];

/**
 * What the volunteer compares the players' work against, and what to hand
 * out once it checks out. The quest's own text sits behind a toggle for
 * when a player's question needs it.
 */
export default function QuestEvidence({ quest }: { quest: Quest }) {
  const stamps = stampList(stampsOf(quest));
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-line bg-white p-4">
        <p className="text-sm font-medium text-ink/80">
          Look for evidence that
        </p>
        <p className="mt-1 text-lg whitespace-pre-line text-ink">
          {quest.evidence || "No description given."}
        </p>
        {quest.evidenceImage && (
          <a
            href={quest.evidenceImage}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Blob URL, any size */}
            <img
              src={quest.evidenceImage}
              alt="What the solution looks like"
              className="max-h-80 rounded-lg border border-line object-contain"
            />
          </a>
        )}
      </div>
      <p className="text-sm text-ink/80">
        <span className="font-medium">Reward:</span>{" "}
        {stamps.length === 0
          ? "no stamps"
          : stamps
              .map(
                (s) =>
                  `${s.n} ${stampLabel(s.class)} stamp${s.n === 1 ? "" : "s"}`,
              )
              .join(", ")}
        {quest.minPlayers > 1 && ` · group of ${quest.minPlayers}+`}
      </p>
      {(quest.bodyText || quest.bodyImages.length > 0) && (
        <details className="rounded-xl border border-line bg-white">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-navy">
            Quest text, as printed
          </summary>
          <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
            {quest.bodyText && (
              <p className="whitespace-pre-line text-ink/80">
                {quest.bodyText}
              </p>
            )}
            {quest.bodyImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {quest.bodyImages.map((src) => (
                  <a key={src} href={src} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- Blob URL, any size */}
                    <img
                      src={src}
                      alt=""
                      className="h-28 rounded-lg border border-line object-contain"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
