import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-report";
import { unsubscribeSignup } from "@/lib/airtable";
import { purchaseBuyer, type PurchaseRef } from "@/lib/purchase-buyer";

export const runtime = "nodejs";

/**
 * POST { sessionId } | { chargeId } — opt a ticket buyer out of the mailing
 * list. Keyed on the purchase rather than an email so only the buyer's own
 * address can be unsubscribed.
 */
export async function POST(request: Request) {
  let body: { sessionId?: unknown; chargeId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
  const { sessionId, chargeId } = body;
  let ref: PurchaseRef;
  if (typeof sessionId === "string" && sessionId) ref = { sessionId };
  else if (typeof chargeId === "string" && chargeId) ref = { chargeId };
  else {
    return NextResponse.json({ error: "Missing purchase" }, { status: 400 });
  }

  const buyer = await purchaseBuyer(ref);
  if (!buyer) {
    return NextResponse.json({ error: "Unknown purchase" }, { status: 404 });
  }

  try {
    const result = await unsubscribeSignup(buyer.email, { test: buyer.test });
    if (!result.stored && process.env.NODE_ENV === "production") {
      console.error(
        "[opt-out] Airtable not configured in production — opt-out not stored",
      );
      return NextResponse.json(
        { error: "Opt-out is temporarily unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, stored: result.stored });
  } catch (err) {
    console.error("[opt-out] failed to store opt-out:", err);
    await reportError({
      source: "Mailing-list opt-out",
      summary: "Airtable didn't take the opt-out; the person saw an error",
      details: {
        Session: String(sessionId ?? ""),
        Charge: String(chargeId ?? ""),
      },
      error: err,
      mention: false,
    });
    return NextResponse.json(
      { error: "Failed to save opt-out" },
      { status: 500 },
    );
  }
}
