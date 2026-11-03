import { createHash, randomInt } from "node:crypto";
import { TICKET_CODE_LENGTH } from "@/lib/ticket-code-format";

export { formatTicketCode } from "@/lib/ticket-code-format";

// Crockford-style: no I/L/O/U, so codes survive being read aloud or retyped.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Deterministic 6-char ticket code derived from the payment id (Stripe
 * PaymentIntent or OpenNode charge id) — same input always yields the same
 * code, so webhook retries/upserts can never churn a code. Codes are
 * per-admission: single purchases use the payment id; group purchases append
 * a stable ticket index so each attendee has a separate code.
 */
export function ticketCode(paymentId: string): string {
  const hash = createHash("sha256").update(paymentId).digest();
  let code = "";
  for (let i = 0; i < TICKET_CODE_LENGTH; i++) {
    code += ALPHABET[hash[i] % ALPHABET.length];
  }
  return code;
}

/** `length` random characters of the ticket alphabet. */
export function randomCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** A fresh code for a ticket whose old code must stop working. */
export const randomTicketCode = () => randomCode(TICKET_CODE_LENGTH);

// Drizzle wraps the driver's error, so the Postgres code can sit on a cause.
const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Error &&
  ((e as { code?: unknown }).code === "23505" || isUniqueViolation(e.cause));

/** Runs `write` with a fresh random code, retrying when the code is taken. */
export async function withFreshTicketCode<T>(
  write: (code: string) => Promise<T>,
  generate: () => string = randomTicketCode,
  attempts = 5,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write(generate());
    } catch (e) {
      if (attempt >= attempts || !isUniqueViolation(e)) throw e;
    }
  }
}
