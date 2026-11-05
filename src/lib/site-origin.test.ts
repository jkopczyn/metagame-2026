import { afterEach, describe, expect, it, vi } from "vitest";
import { siteOrigin } from "./site-origin";

const request = new Request("https://preview.example.com/api/checkout?x=1");

afterEach(() => vi.unstubAllEnvs());

describe("siteOrigin", () => {
  it("prefers NEXT_PUBLIC_SITE_URL, without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://metagame.games/");
    expect(siteOrigin(request)).toBe("https://metagame.games");
  });

  it("falls back to the request's origin when unset or empty", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(siteOrigin(request)).toBe("https://preview.example.com");
  });
});
