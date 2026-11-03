// The schedule view (grid, list or moments) a visitor last picked, kept in a
// cookie so /schedule can render it on the server and the homepage, which is
// cached, can pick it up on the client.

export const VIEW_COOKIE = "schedule-view";

const VIEWS = ["grid", "list", "moments"] as const;
export type StoredView = (typeof VIEWS)[number];

export function parseView(value: string | undefined): StoredView | undefined {
  return VIEWS.find((v) => v === value);
}

/** The view stored in this browser, read from `document.cookie`. */
export function readViewCookie(): StoredView | undefined {
  const pair = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${VIEW_COOKIE}=`));
  return parseView(pair?.slice(VIEW_COOKIE.length + 1));
}

export function writeViewCookie(view: StoredView) {
  const year = 60 * 60 * 24 * 365;
  document.cookie = `${VIEW_COOKIE}=${view}; path=/; max-age=${year}; samesite=lax`;
}
