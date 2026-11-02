"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type AccountStatus = { signedIn: boolean; admin: boolean };

// Asked from the client so the layout around the nav stays static; null
// until the answer arrives, so the nav needn't guess which link to show.
// Re-asked on every navigation: the nav outlives sign-in and sign-out, which
// both end in a client-side redirect rather than a full reload.
export function useAccountStatus(): AccountStatus | null {
  const pathname = usePathname();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/admin-status")
      .then((res) => (res.ok ? res.json() : {}))
      .then((body: Partial<AccountStatus>) => {
        if (live)
          setStatus({
            signedIn: body.signedIn === true,
            admin: body.admin === true,
          });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);
  return status;
}
