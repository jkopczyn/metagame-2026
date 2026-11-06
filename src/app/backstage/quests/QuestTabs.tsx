"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NEW = "/backstage/quests/new";
const TABS = [
  { href: "/backstage/quests", label: "All quests", adding: false },
  { href: NEW, label: "Add quests", adding: true },
];

/** The tool's two tabs; a quest's own edit page counts as "All quests". */
export default function QuestTabs() {
  const adding = usePathname().startsWith(NEW);
  return (
    <nav className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
      {TABS.map((t) => {
        const active = t.adding === adding;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1 transition-colors ${
              active
                ? "bg-navy text-white"
                : "text-ink/70 hover:bg-cream hover:text-navy"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
