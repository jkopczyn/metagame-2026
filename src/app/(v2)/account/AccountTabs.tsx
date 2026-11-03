"use client";

import { useState, type ReactNode } from "react";
import { Tabs } from "radix-ui";
import { ACCOUNT_TABS, type AccountTab } from "./tabs";

const LABELS: Record<AccountTab, string> = {
  profile: "Profile",
  tickets: "Tickets",
  sessions: "Sessions",
  megagame: "Megagame",
};

export default function AccountTabs({
  initial,
  tabs = ACCOUNT_TABS,
  panels,
  trailing,
}: {
  initial: AccountTab;
  /** Which tabs to show, in order; a tab with nothing to show is left out. */
  tabs?: readonly AccountTab[];
  panels: Record<AccountTab, ReactNode>;
  /** Sits at the right end of the tab row; not a tab. */
  trailing?: ReactNode;
}) {
  const [tab, setTab] = useState(initial);

  const select = (value: string) => {
    const next = value as AccountTab;
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.delete("notice");
    if (next === "profile") params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  };

  return (
    <Tabs.Root value={tab} onValueChange={select}>
      <Tabs.List
        aria-label="Account"
        className="mb-10 flex max-w-[960px] gap-2 border-b border-line max-sm:[scrollbar-width:none] max-sm:overflow-x-auto sm:gap-6"
      >
        {tabs.map((t) => (
          <Tabs.Trigger
            key={t}
            value={t}
            className="-mb-px border-b-2 border-transparent pb-2.5 font-grotesk text-[15px] font-bold text-ink/50 transition-colors outline-none hover:text-navy focus-visible:text-navy data-[state=active]:border-meeple data-[state=active]:text-navy sm:text-lg"
          >
            {LABELS[t]}
          </Tabs.Trigger>
        ))}
        {trailing && (
          <div className="ml-auto self-center pb-2.5">{trailing}</div>
        )}
      </Tabs.List>
      {tabs.map((t) => (
        <Tabs.Content key={t} value={t} className="outline-none">
          {panels[t]}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
