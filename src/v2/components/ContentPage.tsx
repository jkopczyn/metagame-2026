import { EYEBROW, HEADING } from "./styles";

// Shell for the non-home pages (/sponsor, /team, …): clears the fixed
// corner nav, sets the measure, and gives every page the same title block.
export default function ContentPage({
  above,
  eyebrow,
  title,
  intro,
  children,
  wide = false,
}: {
  /** Rendered at the top of the title block, before the eyebrow. */
  above?: React.ReactNode;
  eyebrow?: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  /** Full viewport width (minus the gutter) instead of the reading measure. */
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto px-8 pt-28 pb-20 ${wide ? "max-w-none" : "max-w-[1180px]"}`}
    >
      <header className="mb-10 max-w-[820px]">
        {above}
        {eyebrow && <p className={`${EYEBROW} mb-2 text-meeple`}>{eyebrow}</p>}
        <h1 className={`${HEADING} text-[clamp(34px,5vw,56px)] text-navy`}>
          {title}
        </h1>
        {intro && (
          <div className="mt-4 text-base text-ink/70 md:text-lg">{intro}</div>
        )}
      </header>
      {children}
    </div>
  );
}
