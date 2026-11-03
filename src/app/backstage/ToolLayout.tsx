import Link from "next/link";
import BackToTools from "./BackToTools";
import SessionBar from "./SessionBar";

/** Header + column shared by the tools under /backstage; the schema pages size their own. */
export default function ToolLayout({
  title,
  href,
  nav,
  wide,
  fluid,
  children,
}: {
  title: string;
  href: string;
  /** Extra links after the title. */
  nav?: React.ReactNode;
  /** For tools with many columns. */
  wide?: boolean;
  /** The whole viewport, for side-by-side panes. */
  fluid?: boolean;
  children: React.ReactNode;
}) {
  const width = fluid ? "max-w-none" : wide ? "max-w-7xl" : "max-w-5xl";
  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream text-ink">
      {/* Below the corner nav (z-40); the left padding is its corner. */}
      <header className="sticky top-0 z-30 border-b border-line bg-cream/95 backdrop-blur">
        <div
          className={`mx-auto flex ${width} items-center justify-between gap-3 py-3 pr-4 pl-20 md:pl-24`}
        >
          <nav className="flex min-w-0 items-center gap-3 sm:gap-4">
            {href !== "/backstage" && <BackToTools />}
            <Link
              href={href}
              className="font-bebas truncate text-xl tracking-wide whitespace-nowrap text-navy"
            >
              {title}
            </Link>
            {nav}
          </nav>
          <SessionBar next={href} />
        </div>
      </header>
      {/* The site's gutter, so the column clears the nav; fluid tools keep the viewport. */}
      <main className={`w-full px-4 py-8 ${fluid ? "" : "md:px-20 lg:px-24"}`}>
        <div className={`mx-auto w-full ${width}`}>{children}</div>
      </main>
    </div>
  );
}
