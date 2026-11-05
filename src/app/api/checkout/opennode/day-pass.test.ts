import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createCharge } = vi.hoisted(() => ({ createCharge: vi.fn() }));
vi.mock("@/lib/opennode", () => ({
  createCharge,
  getHostedCheckoutUrl: () => "https://checkout.opennode.com/charge_1",
}));
import { POST } from "./route";

const buy = (ticketId: string) =>
  POST(
    new Request("https://metagame.games/api/checkout/opennode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketId,
        name: "Ada",
        email: "ada@example.com",
      }),
    }),
  );

describe("bitcoin day pass sales window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCharge.mockResolvedValue({ id: "charge_1" });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => void vi.useRealTimers());

  it.each([
    ["friday", "2026-11-07T07:59:59Z", "2026-11-07T08:00:00Z"],
    ["saturday", "2026-11-08T07:59:59Z", "2026-11-08T08:00:00Z"],
    ["sunday", "2026-11-09T07:59:59Z", "2026-11-09T08:00:00Z"],
  ])("sells %s until Pacific midnight", async (day, before, after) => {
    vi.setSystemTime(new Date(before));
    expect((await buy(day)).status).toBe(200);
    expect(createCharge).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(after));
    const refused = await buy(day);
    expect(refused.status).toBe(410);
    expect((await refused.json()).error).toMatch(/no longer on sale/);
    expect(createCharge).toHaveBeenCalledTimes(1);
  });

  it("leaves general tickets on sale", async () => {
    vi.setSystemTime(new Date("2026-11-10T20:00:00Z"));
    expect((await buy("standard")).status).toBe(200);
  });
});
