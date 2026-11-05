import { afterEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/env", () => ({ env: { RESEND_API_KEY: "re_test" } }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
import { sendSignInCodeEmail, sendTicketConfirmationEmail } from "./email";

const limited = {
  data: null,
  error: { name: "rate_limit_exceeded", message: "Too many requests" },
  headers: null,
};
const email = {
  to: "buyer@example.com",
  tierLabel: "Standard",
  idempotencyKey: "family-pack/pi_1/ticket/2",
};

describe("sendTicketConfirmationEmail when Resend rate-limits", () => {
  afterEach(() => {
    vi.useRealTimers();
    send.mockReset();
  });

  it("retries under the same idempotency key", async () => {
    vi.useFakeTimers();
    send
      .mockResolvedValueOnce(limited)
      .mockResolvedValue({ data: { id: "em_1" }, error: null, headers: null });
    const sent = sendTicketConfirmationEmail(email);
    await vi.runAllTimersAsync();
    await expect(sent).resolves.toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(2);
    for (const [, options] of send.mock.calls)
      expect(options).toEqual({ idempotencyKey: email.idempotencyKey });
  });

  it("still fails loudly once the retries run out", async () => {
    vi.useFakeTimers();
    send.mockResolvedValue(limited);
    const sent = sendTicketConfirmationEmail(email);
    const failed = expect(sent).rejects.toThrow("Too many requests");
    await vi.runAllTimersAsync();
    await failed;
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe("sendSignInCodeEmail when Resend rate-limits", () => {
  afterEach(() => {
    vi.useRealTimers();
    send.mockReset();
  });

  it("retries, so a sign-in rush doesn't fail anyone's code", async () => {
    vi.useFakeTimers();
    send
      .mockResolvedValueOnce(limited)
      .mockResolvedValue({ data: { id: "em_1" }, error: null, headers: null });
    const sent = sendSignInCodeEmail({
      to: "guest@example.com",
      code: "123456",
      type: "sign-in",
    });
    await vi.runAllTimersAsync();
    await expect(sent).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
