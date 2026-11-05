import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({
  accountsConfigured: () => true,
  currentSession: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: vi.fn(), schema: { profiles: {} } }));
vi.mock("@/lib/ticket-store", () => ({
  emailKey: (email: string) => email,
  ticketLabel: (tier: string) => tier,
  ticketsForUser: vi.fn().mockResolvedValue([]),
}));
import { currentSession } from "@/lib/auth";
import { getDb } from "@/db";
import { GET } from "./route";

const noProfile = () =>
  ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
  }) as unknown as ReturnType<typeof getDb>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(currentSession).mockResolvedValue({
    user: { id: "u1", email: "ada@example.com", name: "Ada" },
  } as Awaited<ReturnType<typeof currentSession>>);
  vi.mocked(getDb).mockImplementation(noProfile);
});

it("fails a read outright, then answers once the database is back", async () => {
  vi.mocked(getDb).mockImplementationOnce(() => {
    throw new Error("database down");
  });
  const failed = await GET();
  expect(failed.ok).toBe(false);

  const recovered = await GET();
  expect(recovered.ok).toBe(true);
  expect(await recovered.json()).toMatchObject({ needed: true });
});

it("fails rather than says not needed when the session read fails", async () => {
  vi.mocked(currentSession).mockRejectedValueOnce(new Error("database down"));
  expect((await GET()).ok).toBe(false);
});

it("still answers not needed for a signed-out visitor", async () => {
  vi.mocked(currentSession).mockResolvedValue(null);
  const res = await GET();
  expect(res.ok).toBe(true);
  expect(await res.json()).toEqual({ needed: false });
});
