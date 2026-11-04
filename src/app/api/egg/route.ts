import { recordEgg } from "@/lib/airtable";
import { throttled } from "@/lib/throttle";
import { SPELLS } from "@/v2/components/dividers/scrabble/effects";
import {
  CLICK_EGGS,
  type ClickEgg,
  type EggEvent,
} from "@/v2/components/dividers/track";

// Anything else is dropped: this is a public endpoint writing to our base.
const parse = (body: Record<string, unknown>): EggEvent | null => {
  const { egg, event, word, via, clicks } = body;
  if (egg === "scrabble" && event === "cast")
    return typeof word === "string" &&
      Object.hasOwn(SPELLS, word) &&
      (via === "click" || via === "type")
      ? { egg, event, word, via }
      : null;
  if (CLICK_EGGS.includes(egg as ClickEgg) && event === "clicks")
    return Number.isInteger(clicks) &&
      (clicks as number) > 0 &&
      (clicks as number) < 1e6
      ? { egg: egg as ClickEgg, event, clicks: clicks as number }
      : null;
  if (egg === "chess" && event === "castle") return { egg, event };
  if (egg === "tetris" && event === "clear") return { egg, event };
  if (egg === "clocktower" && event === "kill") return { egg, event };
  if (egg === "invaders" && event === "win") return { egg, event };
  if (egg === "monopoly" && event === "win") return { egg, event };
  if (egg === "catan" && event === "win") return { egg, event };
  if (egg === "set" && event === "win") return { egg, event };
  return null;
};

// Counts easter eggs found on the dividers (see dividers/track.ts). The client
// fires and forgets, so this never reports failure back: a lost row is fine, a
// console error on someone's page is not.
export async function POST(request: Request) {
  // Preview and local casts are ours, not visitors'. NEXT_PUBLIC_, not plain
  // VERCEL_ENV: deploys go out prebuilt from Actions, so the env we can count
  // on is the one Next inlined at build time. Same call as the Stripe mode in
  // src/lib/tickets.ts.
  if (process.env.NEXT_PUBLIC_VERCEL_ENV !== "production")
    return new Response(null, { status: 204 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const found = body && typeof body === "object" ? parse(body) : null;
  const visit = body?.visit;
  if (found && typeof visit === "string" && /^[a-z0-9]{1,12}$/.test(visit)) {
    if (await throttled(request, "egg"))
      return new Response(null, { status: 204 });
    try {
      await recordEgg(found, visit);
    } catch (err) {
      console.error("[egg] failed to record:", err);
    }
  }
  return new Response(null, { status: 204 });
}
