import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real throttle over a fake store, real routes over fake externals: an
// over-budget request must stop before anything that costs quota.
const store = vi.hoisted(() => ({ spent: 0 }));

vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => [{ value: String(store.spent) }],
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/error-report", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendContactEmail: vi.fn(async () => true),
  sendFormBackupEmail: vi.fn(async () => true),
}));
vi.mock("@/lib/airtable", () => ({
  recordSignup: vi.fn(async () => ({ stored: true })),
  recordCrypticClue: vi.fn(async () => ({ stored: true, id: "rec1" })),
  addCrypticClueContact: vi.fn(async () => ({ stored: true })),
  recordEgg: vi.fn(async () => {}),
}));
vi.mock("@/lib/airtable-forms", () => ({
  createFormRow: vi.fn(async () => ({ stored: true, id: "rec1" })),
  attachFile: vi.fn(),
}));
vi.mock("@/lib/opennode", () => ({
  createCharge: vi.fn(async () => ({ id: "charge" })),
  getHostedCheckoutUrl: vi.fn(() => "https://pay.test/charge"),
}));
vi.mock("@/lib/discount-codes", () => ({
  lookupDiscountCode: vi.fn(async () => ({ status: "none" })),
  countCodeRedemptions: vi.fn(async () => 0),
}));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(() => ({})) }));
vi.mock("@/lib/referral-checkout", () => ({
  resolveDiscount: vi.fn(async () => null),
}));
vi.mock("@/lib/poster-catalog", () => ({
  loadPosterCatalog: vi.fn(async () => []),
}));
vi.mock("@/lib/poster-promo", () => ({
  checkPosterPromo: vi.fn(async () => ({ ok: false })),
}));

import { sendContactEmail, sendFormBackupEmail } from "@/lib/email";
import {
  addCrypticClueContact,
  recordCrypticClue,
  recordEgg,
  recordSignup,
} from "@/lib/airtable";
import { createFormRow } from "@/lib/airtable-forms";
import { createCharge } from "@/lib/opennode";
import { countCodeRedemptions, lookupDiscountCode } from "@/lib/discount-codes";
import { resolveDiscount } from "@/lib/referral-checkout";
import { loadPosterCatalog } from "@/lib/poster-catalog";
import { checkPosterPromo } from "@/lib/poster-promo";
import { POST as contact } from "@/app/api/contact/route";
import { POST as signup } from "@/app/api/signup/route";
import {
  PATCH as addContact,
  POST as clue,
} from "@/app/api/cryptic-clue/route";
import { POST as egg } from "@/app/api/egg/route";
import { POST as forms } from "@/app/api/forms/[form]/route";
import { POST as charge } from "@/app/api/checkout/opennode/route";
import { POST as validateCode } from "@/app/api/checkout/opennode/validate-code/route";
import { GET as discount } from "@/app/api/checkout/stripe/discount/route";
import { GET as posters } from "@/app/api/posters/route";
import { readCodeCheck } from "@/v2/lib/btc-code-check";

let nextIp = 1;
const headers = () => ({ "x-forwarded-for": `198.51.100.${nextIp++}` });
const send = (method: string, body: unknown) =>
  new Request("https://x.test/", {
    method,
    headers: headers(),
    body: JSON.stringify(body),
  });
const get = (query: string) =>
  new Request(`https://x.test/?${query}`, { headers: headers() });

const cases: {
  route: string;
  call: () => Promise<Response>;
  externals: unknown[];
  refused?: number;
}[] = [
  {
    route: "contact",
    call: () =>
      contact(
        send("POST", { name: "Ada", email: "ada@x.test", message: "Hi" }),
      ),
    externals: [sendContactEmail],
  },
  {
    route: "signup",
    call: () => signup(send("POST", { email: "ada@x.test" })),
    externals: [recordSignup],
  },
  {
    route: "cryptic clue",
    call: () => clue(send("POST", { clue: "Odd (3)" })),
    externals: [recordCrypticClue],
  },
  {
    route: "cryptic clue contact",
    call: () =>
      addContact(
        send("PATCH", { id: "rec00000000000001", email: "ada@x.test" }),
      ),
    externals: [addCrypticClueContact],
  },
  {
    route: "forms",
    call: () =>
      forms(
        send("POST", {
          answers: { name: "Ada", email: "ada@x.test", tier: "Gold" },
        }),
        { params: Promise.resolve({ form: "sponsor" }) },
      ),
    externals: [createFormRow],
  },
  {
    route: "bitcoin charge",
    call: () =>
      charge(
        send("POST", {
          ticketId: "standard",
          name: "Ada",
          email: "ada@x.test",
          discountCode: "CODE",
        }),
      ),
    externals: [createCharge, lookupDiscountCode],
  },
  {
    route: "validate-code",
    call: () => validateCode(send("POST", { code: "CODE" })),
    externals: [lookupDiscountCode],
  },
  {
    route: "stripe discount",
    call: () => discount(get("code=CODE")),
    externals: [resolveDiscount],
  },
  {
    route: "poster code check",
    call: () => posters(get("check=1&promo=CODE")),
    externals: [checkPosterPromo],
  },
  {
    route: "poster render",
    call: () =>
      posters(
        get(
          "area=area:Berkeley&design=d20&size=letter&dots=square&corners=square&logo=none",
        ),
      ),
    externals: [loadPosterCatalog],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe.each(cases)("$route", ({ call, externals }) => {
  it("reaches its externals under budget", async () => {
    store.spent = 1;
    const res = await call();
    expect(res.status).not.toBe(429);
    for (const external of externals) expect(external).toHaveBeenCalled();
  });

  it("answers 429 before reaching them over budget", async () => {
    store.spent = 1e6;
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect((await res.json()).error).toMatch(/too many/i);
    for (const external of externals) expect(external).not.toHaveBeenCalled();
    expect(sendFormBackupEmail).not.toHaveBeenCalled();
    expect(countCodeRedemptions).not.toHaveBeenCalled();
  });
});

// What the BTC modal makes of the route's real 429: not a verdict on the code.
it("tells the BTC modal a throttled code check isn't a bad code", async () => {
  store.spent = 1e6;
  const check = await readCodeCheck(
    await validateCode(send("POST", { code: "CODE" })),
  );
  expect(check).toMatchObject({ valid: false, rateLimited: true });
});

// The beacon can't act on a status and a console error isn't wanted, so an
// over-budget egg looks the same as a recorded one; only the write differs.
describe("egg", () => {
  const cast = () =>
    egg(send("POST", { egg: "chess", event: "castle", visit: "abc" }));

  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production"));
  afterEach(() => vi.unstubAllEnvs());

  it("writes under budget", async () => {
    store.spent = 1;
    expect((await cast()).status).toBe(204);
    expect(recordEgg).toHaveBeenCalled();
  });

  it("writes the second egg in the same second", async () => {
    store.spent = 2;
    expect((await cast()).status).toBe(204);
    expect(recordEgg).toHaveBeenCalled();
  });

  it("quietly drops the row over budget", async () => {
    store.spent = 1e6;
    expect((await cast()).status).toBe(204);
    expect(recordEgg).not.toHaveBeenCalled();
  });
});
