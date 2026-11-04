import { inspect } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { emailOTP } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db";

const mail = vi.hoisted(() => ({
  send: vi.fn(),
  report: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/email", () => ({ sendSignInCodeEmail: mail.send }));
vi.mock("@/lib/error-report", () => ({ reportError: mail.report }));

const client = new PGlite();
const pg = drizzle({ client, schema, casing: "snake_case" });
const db = pg as unknown as Db;
vi.mock("@/db", () => ({ getDb: () => db, schema }));

const { codeDelivered, deliverCode } = await import("./auth");

// Real Better Auth and its real swallowing of a failed send; only the tables
// it owns are in memory.
const auth = betterAuth({
  secret: "test-secret-at-least-32-characters-long",
  baseURL: "http://localhost",
  database: memoryAdapter({
    user: [],
    session: [],
    account: [],
    verification: [],
  }),
  logger: { disabled: true },
  plugins: [
    emailOTP({
      sendVerificationOTP: ({ email, otp, type }) =>
        deliverCode(db, { to: email, code: otp, type }),
      resendStrategy: "reuse",
    }),
  ],
});

const send = () =>
  codeDelivered(() =>
    auth.api.sendVerificationOTP({
      body: { email: "ada@example.com", type: "sign-in" },
    }),
  );

beforeAll(async () => {
  await client.exec(`
    create table verification (
      id text primary key,
      identifier text not null,
      value text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`);
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await client.exec("delete from verification");
});

it("says so when the email fails, and reports it without the code", async () => {
  mail.send.mockRejectedValueOnce(new Error("Resend send failed: quota"));
  expect(await send()).toBe(false);
  expect(mail.report).toHaveBeenCalledTimes(1);
  const report = mail.report.mock.calls[0][0];
  expect(report.source).toBe("Sign-in email");
  const code = mail.send.mock.calls[0][0].code;
  expect(JSON.stringify(report)).not.toContain(code);
});

it("keeps the code out of the alert and logs when the cooldown write fails", async () => {
  const code = "428917";
  await client.exec(`
    create function refuse_cooldown() returns trigger language plpgsql as
      $$ begin raise exception 'database unavailable'; end $$;
    create trigger refuse_cooldown before insert on verification
      for each row execute function refuse_cooldown();`);
  try {
    const delivered = await codeDelivered(() =>
      deliverCode(db, { to: "ada@example.com", code, type: "sign-in" }),
    );
    expect(delivered).toBe(false);
  } finally {
    await client.exec(`
      drop trigger refuse_cooldown on verification;
      drop function refuse_cooldown();`);
  }

  expect(mail.send).not.toHaveBeenCalled();
  const { formatErrorReport } =
    await vi.importActual<typeof import("@/lib/error-report")>(
      "@/lib/error-report",
    );
  const alert = formatErrorReport(mail.report.mock.calls[0][0]);
  expect(alert).toContain("database unavailable");
  expect(alert).not.toContain(code);
  expect(alert).not.toContain("params:");

  const logged = vi.mocked(console.error).mock.calls[0];
  expect(inspect(logged, { depth: null })).toContain("database unavailable");
  expect(inspect(logged, { depth: null })).not.toContain(code);
});

it("scrubs the code from an email provider's error too", async () => {
  mail.send.mockImplementationOnce(async ({ code }) => {
    throw new Error(`rejected body containing ${code}`, {
      cause: { detail: code },
    });
  });
  expect(await send()).toBe(false);
  const code = mail.send.mock.calls[0][0].code;
  const { formatErrorReport } =
    await vi.importActual<typeof import("@/lib/error-report")>(
      "@/lib/error-report",
    );
  expect(formatErrorReport(mail.report.mock.calls[0][0])).not.toContain(code);
  expect(inspect(vi.mocked(console.error).mock.calls[0])).not.toContain(code);
});

it("lets a retry send straight away after a failure", async () => {
  mail.send.mockRejectedValueOnce(new Error("down"));
  expect(await send()).toBe(false);
  mail.send.mockResolvedValueOnce(undefined);
  expect(await send()).toBe(true);
  expect(mail.send).toHaveBeenCalledTimes(2);
});

it("keeps the cooldown after a send that worked", async () => {
  mail.send.mockResolvedValue(undefined);
  expect(await send()).toBe(true);
  expect(await send()).toBe(true);
  expect(mail.send).toHaveBeenCalledTimes(1);
  expect(mail.report).not.toHaveBeenCalled();
});
