import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-report";
import { addCrypticClueContact, recordCrypticClue } from "@/lib/airtable";

// Two steps: POST the clue (returns the new record id), then an optional PATCH
// to put a name/email on that record. Same "503 when unconfigured in prod"
// rule as /api/signup so a misconfigured deploy doesn't fake success.

const CLUE_MAX = 300;
const NAME_MAX = 120;
const EMAIL_MAX = 200;
const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;

function unavailableInProd(stored: boolean) {
  if (!stored && process.env.NODE_ENV === "production") {
    console.error("[clue] Airtable not configured in production");
    return NextResponse.json(
      { error: "Submissions are temporarily unavailable" },
      { status: 503 },
    );
  }
  return null;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const { clue } = await readJson(request);
  const trimmed = typeof clue === "string" ? clue.trim() : "";
  if (!trimmed || trimmed.length > CLUE_MAX) {
    return NextResponse.json({ error: "Invalid clue" }, { status: 400 });
  }

  try {
    const result = await recordCrypticClue(trimmed);
    return (
      unavailableInProd(result.stored) ??
      NextResponse.json({ ok: true, stored: result.stored, id: result.id })
    );
  } catch (err) {
    console.error("[clue] failed to store clue:", err);
    await reportError({
      source: "Cryptic clue form",
      summary: "Airtable didn't take the clue; the person saw an error",
      error: err,
      mention: false,
    });
    return NextResponse.json({ error: "Failed to save clue" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { id, name, email } = await readJson(request);
  if (typeof id !== "string" || !RECORD_ID.test(id)) {
    return NextResponse.json({ error: "Invalid record" }, { status: 400 });
  }
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (
    trimmedName.length > NAME_MAX ||
    trimmedEmail.length > EMAIL_MAX ||
    (trimmedEmail && !trimmedEmail.includes("@"))
  ) {
    return NextResponse.json({ error: "Invalid contact" }, { status: 400 });
  }
  if (!trimmedName && !trimmedEmail) {
    return NextResponse.json({ error: "Nothing to add" }, { status: 400 });
  }

  try {
    const result = await addCrypticClueContact(id, {
      name: trimmedName || undefined,
      email: trimmedEmail || undefined,
    });
    return (
      unavailableInProd(result.stored) ??
      NextResponse.json({ ok: true, stored: result.stored })
    );
  } catch (err) {
    console.error("[clue] failed to store contact:", err);
    await reportError({
      source: "Cryptic clue form",
      summary:
        "Airtable didn't take the contact details; the person saw an error",
      error: err,
      mention: false,
    });
    return NextResponse.json(
      { error: "Failed to save contact" },
      { status: 500 },
    );
  }
}
