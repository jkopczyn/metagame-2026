import type { Metadata } from "next";
import Link from "next/link";
import BackToTools from "../BackToTools";
import SessionBar from "../SessionBar";

export const metadata: Metadata = {
  title: "Dice Lab — Metagame",
  robots: { index: false, follow: false },
};

// Own header rather than ToolLayout: the lab fills the viewport below it
// (DiceLab sizes itself to 100dvh minus this bar's h-14).
export default function DiceLabLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-cream/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-4 px-4">
          <nav className="flex items-center gap-4">
            <BackToTools />
            <Link
              href="/backstage/dice-lab"
              className="font-bebas text-xl tracking-wide text-navy"
            >
              Dice Lab
            </Link>
          </nav>
          <SessionBar next="/backstage/dice-lab" />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
