"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type AccountStatus = {
  signedIn: boolean;
  admin: boolean;
  /** For the profile link; null when signed out. */
  userId: string | null;
};

const ACCOUNT_EVENT = "metagame:account-changed";

/** Tells every mounted nav to re-ask who's signed in, e.g. after logging out. */
export function notifyAccountChanged(): void {
  window.dispatchEvent(new Event(ACCOUNT_EVENT));
}

// Asked from the client so the layout around the nav stays static; null
// until the answer arrives, so the nav needn't guess which link to show.
// Re-asked on every navigation and on notifyAccountChanged(): the nav outlives
// sign-in and sign-out, which end in a client-side redirect, not a reload.
export function useAccountStatus(): AccountStatus | null {
  const pathname = usePathname();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/admin-status")
        .then((res) => (res.ok ? res.json() : {}))
        .then((body: Partial<AccountStatus>) => {
          if (live)
            setStatus({
              signedIn: body.signedIn === true,
              admin: body.admin === true,
              userId: typeof body.userId === "string" ? body.userId : null,
            });
        })
        .catch(() => {});
    load();
    window.addEventListener(ACCOUNT_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(ACCOUNT_EVENT, load);
    };
  }, [pathname]);
  return status;
}
