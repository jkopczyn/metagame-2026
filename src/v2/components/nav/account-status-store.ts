export type AccountStatus = {
  signedIn: boolean;
  admin: boolean;
  /** For the profile link; null when signed out. */
  userId: string | null;
};

const SIGNED_OUT: AccountStatus = {
  signedIn: false,
  admin: false,
  userId: null,
};

// The session cookie cache's lifetime, so an open tab still reaches the session
// refresh in /api/admin-status, and a sign-out in another tab shows up.
export const STALE_AFTER_MS = 5 * 60 * 1000;

// Signing in and out end in a server redirect from these, with no reload and
// no client code after it to call refresh().
const ACCOUNT_PATHS = ["/login", "/account", "/backstage"];

const isAccountPath = (path: string | null) =>
  path !== null &&
  ACCOUNT_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

export function parseAccountStatus(body: unknown): AccountStatus {
  const b = (body ?? {}) as Partial<AccountStatus>;
  return {
    signedIn: b.signedIn === true,
    admin: b.admin === true,
    userId: typeof b.userId === "string" ? b.userId : null,
  };
}

/**
 * One answer shared by every mounted reader. `ask` resolves null when the server
 * gave no usable answer; that counts as signed out only until there's a real one.
 */
export function createAccountStatusStore(
  ask: () => Promise<AccountStatus | null>,
  now: () => number = Date.now,
) {
  let status: AccountStatus | null = null;
  let askedAt: number | null = null;
  let lastPath: string | null = null;
  let latest = 0;
  const listeners = new Set<() => void>();

  const publish = (next: AccountStatus) => {
    if (
      status?.signedIn === next.signedIn &&
      status.admin === next.admin &&
      status.userId === next.userId
    )
      return;
    status = next;
    listeners.forEach((listener) => listener());
  };

  const refresh = () => {
    const request = ++latest;
    askedAt = now();
    const failed = () => {
      if (request === latest) askedAt = null;
    };
    ask()
      .then((answer) => {
        // A newer ask means the account changed since this one left.
        if (request !== latest) return;
        if (answer) publish(answer);
        else {
          failed();
          if (!status) publish(SIGNED_OUT);
        }
      })
      .catch(failed);
  };

  return {
    getSnapshot: () => status,
    refresh,
    /** Asks again only if the answer is old or this move can change the account. */
    navigated(path: string) {
      const from = lastPath;
      lastPath = path;
      const stale = askedAt === null || now() - askedAt >= STALE_AFTER_MS;
      const moved = from !== path;
      if (stale || (moved && (isAccountPath(from) || isAccountPath(path)))) {
        refresh();
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        // Sections without the nav (/grade) can sign out unseen, so returning asks.
        if (listeners.size === 0) askedAt = null;
      };
    },
  };
}
