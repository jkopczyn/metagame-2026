import type { CSSProperties, ReactNode } from "react";
import { ArmchairIcon } from "lucide-react";
import { hostNames, type Ages, type Category } from "@/lib/schedule";
import { CATEGORY_STYLES, LEGEND } from "@/v2/lib/schedule-styles";

// Pieces of a schedule session block shared by the admin editor and the
// public schedule.

export function AgeMark({ ages }: { ages: Ages | null }) {
  if (ages === "adults")
    return (
      <span aria-label="18+" className="shrink-0">
        🔞
      </span>
    );
  if (ages === "kids")
    return (
      <span aria-label="Kid-friendly" className="shrink-0">
        🐥
      </span>
    );
  return null;
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="w-fit shrink-0 rounded border border-[#1b1530]/40 bg-white/70 px-1.5 py-0.5 text-[10px] leading-none font-semibold tracking-wide text-[#1b1530] uppercase">
      {children}
    </span>
  );
}

export function SponsorTag() {
  return <Tag>Sponsor</Tag>;
}

export const LIMITED_SPOTS = "Limited spots: RSVP is a commitment";

/**
 * A commitment session: RSVPs claim one of a limited number of spots. Sits
 * by the title like the age marks, on a pill so it reads on a coloured block;
 * a vector icon rather than an emoji so it looks the same on every device.
 */
export function LimitedSpotsMark() {
  return (
    <span
      role="img"
      aria-label={LIMITED_SPOTS}
      title={LIMITED_SPOTS}
      className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-[#1b1530]/40 bg-white/80 text-[#1b1530]"
    >
      <ArmchairIcon aria-hidden className="size-3" strokeWidth={2.25} />
    </span>
  );
}

export type Flagged = { rsvpIsCommitment: boolean; sponsored: boolean };

/** The marks beside a session's title wherever it's listed. */
export function SessionMarks({
  session,
}: {
  session: Flagged & { ages: Ages | null };
}) {
  return (
    <>
      <AgeMark ages={session.ages} />
      {session.rsvpIsCommitment && <LimitedSpotsMark />}
    </>
  );
}

export const blockStyle = (s: { category: Category | null }): CSSProperties =>
  CATEGORY_STYLES[s.category ?? "other"];

export function LegendItem({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-1.5 text-xs">{children}</span>;
}

/** Category swatches and the marks above; `children` adds page-specific entries. */
export function ScheduleLegend({
  className = "justify-center",
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className}`}
    >
      {LEGEND.slice(0, 4).map((entry) => (
        <LegendItem key={entry.label}>
          <span
            aria-hidden
            className="h-3.5 w-3.5 rounded-sm border"
            style={entry.style}
          />
          {entry.label}
        </LegendItem>
      ))}
      <LegendItem>
        <LimitedSpotsMark />
        <span className="sm:hidden">RSVP = commitment</span>
        <span className="hidden sm:inline">{LIMITED_SPOTS}</span>
      </LegendItem>
      <LegendItem>
        <AgeMark ages="adults" />
        18+
      </LegendItem>
      <LegendItem>
        <AgeMark ages="kids" />
        Kid-friendly
      </LegendItem>
      {children}
    </div>
  );
}

/** Flag tags, title, age mark and hosts, as a grid block shows them. */
export function BlockSummary({
  session,
  titleLines = 3,
}: {
  session: Flagged & {
    title: string;
    ages: Ages | null;
    hosts: { name: string }[];
  };
  /** How many title lines fit the block; longer titles are clamped. */
  titleLines?: number;
}) {
  return (
    <>
      {/* Above the title, so a short block's overflow can't clip it. */}
      {session.sponsored && (
        <span className="mb-0.5 flex">
          <SponsorTag />
        </span>
      )}
      <span className="flex items-start gap-1 text-[13px] leading-tight font-semibold">
        <span className="line-clamp-3" style={{ WebkitLineClamp: titleLines }}>
          {session.title}
        </span>
        <SessionMarks session={session} />
      </span>
      {session.hosts.length > 0 && (
        <span className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-[#1b1530]/70">
          {hostNames(session)}
        </span>
      )}
    </>
  );
}
