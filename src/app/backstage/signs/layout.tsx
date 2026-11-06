import type { Metadata } from "next";
import Link from "next/link";
import BackToTools from "../BackToTools";
import SessionBar from "../SessionBar";

export const metadata: Metadata = {
  title: "Sign Maker — Metagame",
  robots: { index: false, follow: false },
};

// Own header rather than ToolLayout: the tool fills the viewport below it.
export default function SignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-cream/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-4 pr-4 pl-20 md:pl-24">
          <nav className="flex items-center gap-4">
            <BackToTools />
            <Link
              href="/backstage/signs"
              className="font-bebas text-xl tracking-wide text-navy"
            >
              Sign Maker
            </Link>
          </nav>
          <SessionBar next="/backstage/signs" />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
