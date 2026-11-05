import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rooms: false,
  upsert: vi.fn(),
  next: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@/lib/access", () => ({
  can: async () => (h.rooms ? { user: { id: "u1" } } : null),
}));
vi.mock("@/lib/schedule-api", () => ({
  authorize: async () => ({ name: "Organizer" }),
  done: vi.fn(),
  error: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  failed: vi.fn(),
  json: (data: unknown, status = 200) => Response.json(data, { status }),
  readBody: (request: Request) => request.json(),
}));
vi.mock("@/lib/schedule-store", () => ({
  nextDisplayOrder: h.next,
  querySchedule: h.query,
  upsertLocation: h.upsert,
}));

import { POST } from "./route";
import { PATCH } from "./[id]/route";

const room = {
  id: "r1",
  name: "Hall",
  capacity: 10,
  campusLocation: null,
  description: null,
  displayOrder: 3,
  visibility: "public",
  boardStartsAt: null,
  boardEndsAt: null,
  thumbnailUrl: null,
  imageUrl: null,
};
const request = (body: unknown) =>
  new Request("https://metagame.games/x", {
    method: "POST",
    body: JSON.stringify(body),
  });
const patch = (body: unknown) =>
  PATCH(request(body), { params: Promise.resolve({ id: "r1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.rooms = false;
  h.upsert.mockResolvedValue("r1");
  h.next.mockResolvedValue(8);
  h.query.mockResolvedValue({ locations: [room] });
});

it("keeps a room's place when schedule.manage alone edits it", async () => {
  await patch({ name: "Big Hall", displayOrder: 0 });
  const input = h.upsert.mock.calls[0][0];
  expect(input.name).toBe("Big Hall");
  expect(input.displayOrder).toBeUndefined();
});

it("moves a room for schedule.rooms", async () => {
  h.rooms = true;
  await patch({ displayOrder: 0 });
  expect(h.upsert.mock.calls[0][0].displayOrder).toBe(0);
});

it("puts a new room last when schedule.manage alone creates it", async () => {
  await POST(request({ name: "Annex", displayOrder: 0 }));
  expect(h.upsert.mock.calls[0][0].displayOrder).toBe(8);
});

it("places a new room as asked for schedule.rooms", async () => {
  h.rooms = true;
  await POST(request({ name: "Annex", displayOrder: 0 }));
  expect(h.upsert.mock.calls[0][0].displayOrder).toBe(0);
});
