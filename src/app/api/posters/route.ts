import { loadPosterCatalog } from "@/lib/poster-catalog";
import { isPosterLink, linkPromo } from "@/lib/poster-options";
import { findTrackingLink, PROMO_PARAM, promoCode } from "@/lib/tracking-links";
import { createPosterPdf, createPosterQrSvg } from "@/lib/poster-pdf";
import { checkPosterPromo } from "@/lib/poster-promo";
import { parsePosterQr } from "@/lib/qr-styles";
import { throttled } from "@/lib/throttle";

export const runtime = "nodejs";
const REJECTED = "This code can’t be used on a poster.";
const headers = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const area = params.get("area");
  const design = params.get("design");
  const size = params.get("size");
  const disposition = params.get("preview") === "1" ? "inline" : "attachment";
  const promoRaw = params.get(PROMO_PARAM) ?? "";
  const promo = promoCode(promoRaw);
  const qr = parsePosterQr(params);
  if (params.get("check") === "1") {
    if (!promo)
      return Response.json(
        { error: "Invalid code." },
        { status: 400, headers },
      );
    const limited = await throttled(request, "codeLookup");
    if (limited) return limited;
    try {
      const result = await checkPosterPromo(promo);
      return Response.json(
        result.ok
          ? { code: result.code, discount: result.discount }
          : { error: REJECTED },
        { status: result.ok ? 200 : 422, headers },
      );
    } catch {
      return Response.json({ error: "Unavailable." }, { status: 503, headers });
    }
  }
  if (
    !area ||
    area.length > 200 ||
    !["d20", "chess"].includes(design ?? "") ||
    !["letter", "13x19"].includes(size ?? "") ||
    !qr ||
    promo !== promoRaw.trim()
  ) {
    return Response.json(
      { error: "Choose an area, design, and paper size." },
      { status: 400, headers },
    );
  }
  const limited = await throttled(request, "poster");
  if (limited) return limited;
  try {
    const choice = (await loadPosterCatalog()).find(
      (option) => option.value === area,
    );
    if (!choice?.available || !choice.slug)
      return Response.json(
        { error: "Poster link unavailable." },
        { status: 409, headers },
      );
    const link = await findTrackingLink(choice.slug);
    if (!link || !isPosterLink(link, choice.placement)) {
      return Response.json(
        { error: "Poster link unavailable." },
        { status: 409, headers },
      );
    }
    // A /buy/<code> link already applies its own code, so that's the one printed.
    const own = linkPromo(link.destination);
    const printed = own || promo;
    const result = printed ? await checkPosterPromo(printed) : undefined;
    if (result && !result.ok)
      return Response.json({ error: REJECTED }, { status: 422, headers });
    const redeemable = result && {
      code: result.code,
      discount: result.discount,
    };
    const name = [design, choice.slug, redeemable?.code, size]
      .filter(Boolean)
      .join("-");
    if (params.get("format") === "svg") {
      const svg = await createPosterQrSvg(
        choice.slug,
        own ? "" : (redeemable?.code ?? ""),
        qr,
      );
      return new Response(svg, {
        headers: {
          ...headers,
          "Content-Type": "image/svg+xml",
          "Content-Disposition": `attachment; filename="metagame-qr-${[choice.slug, redeemable?.code].filter(Boolean).join("-")}.svg"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const pdf = await createPosterPdf(
      design as "d20" | "chess",
      size as "letter" | "13x19",
      choice.slug,
      redeemable,
      !own,
      qr,
    );
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="metagame-${name}.pdf"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Posters are temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
