import { NextResponse } from "next/server";
import { recordSignup } from "@/lib/airtable";
import { reportError } from "@/lib/error-report";
import { isInterestValue } from "@/lib/interests";

export async function POST(request: Request) {
  let body: {
    email?: unknown;
    name?: unknown;
    interests?: unknown;
    notes?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { email, name, interests, notes } = body;
  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const trimmedName = typeof name === "string" ? name.trim() : "";
  // Whitelist so client input can't typecast stray options into the table.
  const validInterests = Array.isArray(interests)
    ? interests.filter(isInterestValue)
    : [];
  const trimmedNotes = typeof notes === "string" ? notes.trim() : "";

  try {
    const result = await recordSignup(email.trim(), {
      name: trimmedName || undefined,
      interests: validInterests,
      notes: trimmedNotes || undefined,
    });
    // Not stored in prod = misconfigured env; error instead of faking success.
    if (!result.stored && process.env.NODE_ENV === "production") {
      console.error(
        "[signup] Airtable not configured in production — signup not stored",
      );
      return NextResponse.json(
        { error: "Signup is temporarily unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, stored: result.stored });
  } catch (err) {
    console.error("[signup] failed to store email:", err);
    await reportError({
      source: "Mailing-list signup",
      summary: "Airtable didn't take the signup; the person saw an error",
      details: { Email: email.trim() },
      error: err,
    });
    return NextResponse.json(
      { error: "Failed to save signup" },
      { status: 500 },
    );
  }
}
