const BASE = "https://metagame.invalid";

/** Only same-site paths survive, so a crafted ?next= can't bounce anyone off-site or back into /login. */
export function safeNextPath(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  // URL parsers drop tabs and newlines, so what the browser follows could
  // differ from what's checked here.
  if (/\p{Cc}/u.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // "/.//x" stays same-origin here but reads as off-site once it's normalized.
  if (url.pathname.startsWith("//") || url.pathname.startsWith("/login")) {
    return fallback;
  }
  return value;
}
