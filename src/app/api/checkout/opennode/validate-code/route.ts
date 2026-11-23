import { NextResponse } from "next/server";
import { getTicket } from "@/lib/tickets";
import { countCodeRedemptions, lookupDiscountCode } from "@/lib/discount-codes";
import { throttled } from "@/lib/throttle";

export const runtime = "nodejs";

// Live price-preview for the BTC modal — validates a discount code and reports the
// BTC price it would charge. Performs NO charge; the create-charge route re-derives
// the price server-side, so this endpoint is advisory only.
export async function POST(request: Request) {
  let body: { code?: string; ticketId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    [body.code, body.ticketId].some(
      (field) => field != null && typeof field !== "string",
    )
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const ticket = getTicket(body.ticketId ?? "standard");
  if (!ticket) {
    return NextResponse.json({ error: "Unknown ticket" }, { status: 400 });
  }
  const fullBtc = ticket.prices.full.btc;

  const limited = await throttled(request, "codeLookup");
  if (limited) return limited;

  const code = (body.code ?? "").trim();
  const applied = code
    ? await lookupDiscountCode(code)
    : ({ status: "none" } as const);

  const valid = applied.status === "valid" ? applied : null;

  // Mirror the charge route's cap check so the client learns a code is exhausted
  // before checkout. Charge creation stays the source of truth.
  const exhausted =
    valid?.maxUses != null &&
    (await countCodeRedemptions(valid.code)) >= valid.maxUses;

  return NextResponse.json({
    valid: valid != null && !exhausted,
    test: applied.status === "test",
    exhausted,
    btcPrice: valid && !exhausted ? valid.btcPrice : null,
    label: valid?.label,
    fullBtc,
  });
}
