import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/tracking-links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tracking-links")>()),
  resolveTrackingLink: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: { __loaded: false } }));
import { GET } from "@/app/go/[slug]/route";
import { resolveTrackingLink, type TrackingLink } from "./tracking-links";
import { captureUtm, readPromo, readUtm, setPromo, withCodes } from "./utm";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("carries the area through /go into last-touch attribution", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://metagame.games");
  vi.mocked(resolveTrackingLink).mockResolvedValue({
    slug: "berkeley",
    destination: "https://metagame.games/",
    source: "poster",
    medium: "print",
    campaign: "metagame-2026",
    placement: "Berkeley",
    active: true,
  } as TrackingLink);
  const response = await GET(
    new Request("https://metagame.games/go/berkeley"),
    { params: Promise.resolve({ slug: "berkeley" }) },
  );
  expect(response.status).toBe(302);
  const destination = new URL(response.headers.get("location")!);
  const expected = {
    utm_source: "poster",
    utm_medium: "print",
    utm_campaign: "metagame-2026",
    utm_content: "berkeley",
    utm_term: "berkeley",
  };
  expect(Object.fromEntries(destination.searchParams)).toEqual(expected);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  captureUtm("?utm_source=previous&utm_content=old-area");
  captureUtm(destination.search);
  expect(readUtm()).toMatchObject(expected);
  captureUtm("");
  expect(readUtm()).toMatchObject(expected);
  captureUtm("?utm_source=newer&utm_content=new-area");
  expect(readUtm()).toMatchObject({
    utm_source: "newer",
    utm_content: "new-area",
  });
  expect(readUtm().utm_term).toBeUndefined();
});
it("forwards a promo code through /go and keeps it for Standard checkout", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://metagame.games");
  vi.mocked(resolveTrackingLink).mockResolvedValue({
    slug: "berkeley",
    destination: "https://metagame.games/#tickets",
    source: "poster",
    medium: "print",
    campaign: "metagame-2026",
    placement: "Berkeley",
    active: true,
  } as TrackingLink);
  const go = (query: string) =>
    GET(new Request(`https://metagame.games/go/berkeley${query}`), {
      params: Promise.resolve({ slug: "berkeley" }),
    });
  const destination = new URL(
    (await go("?promo=POSTER20")).headers.get("location")!,
  );
  expect(destination.searchParams.get("promo")).toBe("POSTER20");
  expect(destination.searchParams.get("utm_term")).toBe("berkeley");
  expect(destination.hash).toBe("#tickets");
  const junk = new URL(
    (await go("?promo=bad%20code")).headers.get("location")!,
  );
  expect(junk.searchParams.has("promo")).toBe(false);

  const storage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
  };
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  expect(withCodes("/api/checkout/stripe?tier=standard&code=own")).toBe(
    "/api/checkout/stripe?tier=standard&code=own",
  );
  captureUtm(destination.search);
  expect(readPromo()).toBe("POSTER20");
  expect(withCodes("/api/checkout/stripe?tier=standard&code=own")).toBe(
    "/api/checkout/stripe?tier=standard&code=own&promo=POSTER20",
  );
  // A later tracking link without a code leaves it; one with a code replaces it.
  captureUtm("?utm_source=newer");
  expect(readPromo()).toBe("POSTER20");
  expect(captureUtm("?promo=OTHER")).toBe("OTHER");
  expect(readPromo()).toBe("OTHER");
  // An invite link stores the friend's code as the discount and keeps the
  // referral even when the code is swapped out.
  expect(captureUtm("?ref=abcd-efgh")).toBe("");
  expect(readPromo()).toBe("ABCD-EFGH");
  setPromo("POSTER20");
  expect(withCodes("/api/checkout/stripe?tier=standard&code=own")).toBe(
    "/api/checkout/stripe?tier=standard&code=own&promo=POSTER20&ref=ABCDEFGH",
  );
});
it("does not mistake the missing-slug homepage fallback for tracked attribution", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://metagame.games");
  vi.mocked(resolveTrackingLink).mockResolvedValue(null);
  const response = await GET(new Request("https://metagame.games/go/missing"), {
    params: Promise.resolve({ slug: "missing" }),
  });
  expect(response.headers.get("location")).toBe("https://metagame.games/");
});
