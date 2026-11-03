import type { Metadata } from "next";
import Link from "next/link";
import BackToTools from "../BackToTools";
import SessionBar from "../SessionBar";
import ViewToggle from "./ViewToggle";
import { toolAccess } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Database Schema — Metagame",
  robots: { index: false, follow: false },
};

export default async function AdminSchemaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await toolAccess("schema.view");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-cream/95 backdrop-blur">
        {/* Fixed height: the diagram page sizes its iframe to the viewport minus this bar. */}
        <div className="flex h-14 items-center justify-between gap-4 pr-4 pl-20 md:pl-24">
          <nav className="flex items-center gap-4">
            <BackToTools />
            <Link
              href="/backstage/schema"
              className="font-bebas text-xl tracking-wide text-navy"
            >
              Database Schema
            </Link>
            {access && <ViewToggle />}
          </nav>
          <SessionBar next="/backstage/schema" />
        </div>
      </header>
      {/* Pages pick their own width: the diagram is full-bleed, the list is a column. */}
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
