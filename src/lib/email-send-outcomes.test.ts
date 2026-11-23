import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/env", () => ({ env: { RESEND_API_KEY: "re_test" } }));

import { sendAdminErrorEmail, sendTicketConfirmationEmail } from "./email";

const confirmation = {
  to: "ada@example.com",
  tierLabel: "Standard",
  ticketCode: "ABC123",
  idempotencyKey: "ticket/pi_1",
};
const resendError = (name: string) => ({
  data: null,
  error: { name, message: `${name} message`, statusCode: 409 },
});

describe("sendTicketConfirmationEmail", () => {
  beforeEach(() => send.mockReset());

  it("sends on the given key", async () => {
    send.mockResolvedValue({ data: { id: "1" }, error: null });
    await expect(
      sendTicketConfirmationEmail(confirmation),
    ).resolves.toMatchObject({ sent: true });
    expect(send.mock.calls[0][1]).toEqual({
      idempotencyKey: "ticket/pi_1",
    });
  });

  it("treats a replayed key as already sent, not as a failure", async () => {
    send.mockResolvedValue(resendError("invalid_idempotent_request"));
    await expect(
      sendTicketConfirmationEmail(confirmation),
    ).resolves.toMatchObject({ sent: false, reason: "already-sent" });
  });

  it("throws on a racing send, which may still fail", async () => {
    send.mockResolvedValue(resendError("concurrent_idempotent_requests"));
    await expect(sendTicketConfirmationEmail(confirmation)).rejects.toThrow(
      "concurrent_idempotent_requests",
    );
  });

  it("throws on any other Resend error", async () => {
    send.mockResolvedValue(resendError("rate_limit_exceeded"));
    await expect(sendTicketConfirmationEmail(confirmation)).rejects.toThrow(
      "rate_limit_exceeded",
    );
  });
});

describe("sendAdminErrorEmail", () => {
  beforeEach(() => send.mockReset());

  it("throws when Resend returns an error, so the caller's fallback runs", async () => {
    send.mockResolvedValue(resendError("application_error"));
    await expect(sendAdminErrorEmail("boom")).rejects.toThrow(
      "application_error",
    );
  });

  it("resolves when it sends", async () => {
    send.mockResolvedValue({ data: { id: "1" }, error: null });
    await expect(sendAdminErrorEmail("boom")).resolves.toBeUndefined();
  });
});
