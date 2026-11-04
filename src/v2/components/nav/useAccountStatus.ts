"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import {
  createAccountStatusStore,
  parseAccountStatus,
  type AccountStatus,
} from "./account-status-store";

export type { AccountStatus };

const store = createAccountStatusStore(async () => {
  const res = await fetch("/api/admin-status");
  return res.ok ? parseAccountStatus(await res.json()) : null;
});

/** Re-asks who's signed in, for every reader, e.g. after logging out. */
export function notifyAccountChanged(): void {
  store.refresh();
}

// Asked from the client so the layout around the nav stays static; null
// until the answer arrives, so the nav needn't guess which link to show.
export function useAccountStatus(): AccountStatus | null {
  const pathname = usePathname();
  useEffect(() => store.navigated(pathname), [pathname]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
}
