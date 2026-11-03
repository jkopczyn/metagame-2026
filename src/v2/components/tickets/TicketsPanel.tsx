"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import BtcModal from "@/v2/components/tickets/BtcModal";
import DiscountModal from "@/v2/components/tickets/DiscountModal";
import DayPassModal from "@/v2/components/tickets/DayPassModal";
import DiscountRateModal from "@/v2/components/tickets/DiscountRateModal";
import FamilyPackModal from "@/v2/components/tickets/FamilyPackModal";
import FriendSwagModal from "@/v2/components/tickets/FriendSwagModal";
import SupporterModal from "@/v2/components/tickets/SupporterModal";
import { Button } from "@/v2/components/ui/button";
import {
  dayPasses,
  getTicket,
  stripeCheckoutHref,
  supporterTier,
} from "@/v2/lib/tickets";
import { FAMILY_PACK, STANDARD_USD } from "@/lib/family-pack";
import { EARLY_BIRD_DEADLINE, isEarlyBirdActive } from "@/lib/early-bird";
import { readPromo, withCodes, withUtm } from "@/lib/utm";
import VolunteerFormLink from "@/v2/components/VolunteerFormLink";
import {
  subscribeCurrency,
  getCurrencySnapshot,
  getCurrencyServerSnapshot,
  setCurrency,
} from "@/v2/lib/currency-store";
import { HEADING } from "../styles";

// Square ticket tiles: mono uppercase label over a big grotesk price, rendered
// via the raised Button variant (bordered navy face with a salmon hard-shadow
// that grows and slides up-left on hover). Layout only; the visual lives in the
// variant.
// The min height matches a three-line tile, so tiles stay even without the
// row stretching them (it can't: the family tile's swag bubble adds height).
// Below 460px the tiles drop into a two-column grid with tighter type.
const TILE =
  "min-h-[112px] min-w-[210px] flex-col gap-1 px-7 py-4 max-[460px]:min-h-0 max-[460px]:min-w-0 max-[460px]:px-3 max-[460px]:py-3";
const TILE_LABEL =
  "font-space-mono text-[13px] tracking-[0.18em] uppercase whitespace-nowrap text-cream/85 max-[460px]:text-[10px] max-[460px]:tracking-[0.1em] max-[460px]:whitespace-normal";
const TILE_NOTE =
  "font-space-mono text-[11px] tracking-[0.08em] uppercase whitespace-nowrap text-cream/60 max-[460px]:text-[9px] max-[460px]:tracking-[0.04em] max-[460px]:whitespace-normal";
const TILE_PRICE = `${HEADING} text-[30px] text-tan max-[460px]:text-[24px]`;
const TILE_STRIKE =
  "text-[18px] font-bold text-cream/40 line-through max-[460px]:text-[14px]";

// The tickets UI for the home page's tickets section: a currency toggle over the early-bird ticket (USD → Stripe Checkout;
// BTC → the OpenNode BtcModal) and the pay-what-you-want supporter tile, both
// driven by the shared currency store, with the supporter/BTC flows stacking on
// top. Renders bare inner content — the navy panel box comes from the modal's
// DialogContent or the section wrapper.
const subscribeNever = () => () => {};

const EARLY_BIRD_HREF = stripeCheckoutHref({ tier: "standard" });
const FULL_PRICE_HREF = stripeCheckoutHref({ tier: "standard", code: "own" });

// UTMs and any stored code live in browser storage, so they're added at click
// time (not render) to keep the server-rendered href stable.
const addUtm = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
  e.currentTarget.href = withCodes(withUtm(href));
};

const HASH_MODALS = [
  "supporter",
  "day-pass",
  "family-pack",
  "friend-swag",
  "discount-rate",
] as const;
type HashModal = (typeof HASH_MODALS)[number];
const isHashModal = (id: string): id is HashModal =>
  (HASH_MODALS as readonly string[]).includes(id);

export default function TicketsPanel({
  showHeading = true,
  align = "center",
  earlyBird,
}: {
  // Whether early-bird was live when the page rendered; the client re-checks its
  // own clock after hydration so a cached page still flips at the deadline.
  earlyBird: boolean;
  // Centred in the modal; the left-aligned tickets section ranges everything left.
  align?: "center" | "start";
  // The modal shows its own "Tickets" heading; the one-pager section supplies a
  // SectionHeading above the (now background-less) panel, so it hides this one.
  showHeading?: boolean;
}) {
  const start = align === "start";
  const earlyBirdActive = useSyncExternalStore(
    subscribeNever,
    isEarlyBirdActive,
    () => earlyBird,
  );
  const standard = getTicket("standard");
  // Each tile that opens a modal (rather than linking straight to Stripe)
  // deep-links from /#<id>, e.g. /#supporter from /sponsor or /#family-pack
  // from an email; the tile's id gives the browser its scroll target. Closing
  // drops the hash so a repeat click on the same link changes the URL again
  // and reopens it.
  const [openModal, setOpenModal] = useState<HashModal | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const closeModal = () => {
    setOpenModal(null);
    if (isHashModal(window.location.hash.slice(1))) {
      router.replace(pathname, { scroll: false });
    }
  };
  useEffect(() => {
    const check = () => {
      const id = window.location.hash.slice(1);
      if (isHashModal(id)) setOpenModal(id);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  const [discountOpen, setDiscountOpen] = useState(false);
  // Which tile opened the BTC modal decides whether the promo code is prefilled.
  const [btcOpen, setBtcOpen] = useState<"early-bird" | "standard" | null>(
    null,
  );

  const currency = useSyncExternalStore(
    subscribeCurrency,
    getCurrencySnapshot,
    getCurrencyServerSnapshot,
  );
  const isBtc = currency === "btc";

  return (
    <>
      {showHeading && (
        <p className={`${HEADING} text-[clamp(20px,2.6vw,26px)] text-cream`}>
          Tickets
        </p>
      )}

      {/* USD/BTC toggle: one currency governs both tiles + the supporter modal.
          The tan knob slides over the active half; the label under it darkens
          to navy for contrast. */}
      <button
        type="button"
        role="switch"
        aria-checked={isBtc}
        aria-label="Pay in USD or BTC"
        onClick={() => setCurrency(isBtc ? "usd" : "btc")}
        className="relative flex h-9 w-[136px] items-center rounded-full border border-cream/25 bg-navy2 p-1 font-space-mono text-[13px] tracking-[0.08em] uppercase select-none"
      >
        <span
          aria-hidden
          className={`absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full bg-tan transition-transform duration-200 ${
            isBtc ? "translate-x-full" : "translate-x-0"
          }`}
        />
        <span
          className={`relative z-[1] flex-1 text-center transition-colors ${
            isBtc ? "text-cream/70" : "text-navy"
          }`}
        >
          USD
        </span>
        <span
          className={`relative z-[1] flex-1 text-center transition-colors ${
            isBtc ? "text-navy" : "text-cream/70"
          }`}
        >
          BTC
        </span>
      </button>

      <div
        className={`flex flex-wrap items-start gap-[18px] max-[460px]:grid max-[460px]:w-full max-[460px]:grid-cols-2 max-[460px]:gap-3 ${start ? "justify-start" : "justify-center"}`}
      >
        {standard &&
          earlyBirdActive &&
          (isBtc ? (
            <Button
              type="button"
              variant="raised"
              onClick={() => setBtcOpen("early-bird")}
              className={TILE}
            >
              <span className={TILE_LABEL}>Early-bird</span>
              <span className="flex items-baseline gap-2.5 leading-none">
                <span className={TILE_STRIKE}>
                  &#8383;{standard.prices.full.btc}
                </span>
                <span className={TILE_PRICE}>
                  &#8383;{standard.prices.earlyBird.btc}
                </span>
              </span>
              <span className={TILE_NOTE}>until {EARLY_BIRD_DEADLINE}</span>
            </Button>
          ) : (
            <Button asChild variant="raised" className={TILE}>
              <a
                href={EARLY_BIRD_HREF}
                onClick={addUtm(EARLY_BIRD_HREF)}
                onAuxClick={addUtm(EARLY_BIRD_HREF)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={TILE_LABEL}>Early-bird</span>
                <span className="flex items-baseline gap-2.5 leading-none">
                  <span className={TILE_STRIKE}>
                    ${standard.prices.full.usd}
                  </span>
                  <span className={TILE_PRICE}>
                    ${standard.prices.earlyBird.usd}
                  </span>
                </span>
                <span className={TILE_NOTE}>until {EARLY_BIRD_DEADLINE}</span>
              </a>
            </Button>
          ))}
        {/* Full price, no promo auto-applied: for after the deadline, or for
            anyone bringing their own code. A stored code (from a promo or
            invite link) gets confirmed in the discount modal first. */}
        {standard &&
          (isBtc ? (
            <Button
              type="button"
              variant="raised"
              onClick={() => setBtcOpen("standard")}
              className={TILE}
            >
              <span className={TILE_LABEL}>Standard</span>
              <span className={`${TILE_PRICE} leading-none`}>
                &#8383;{standard.prices.full.btc}
              </span>
            </Button>
          ) : (
            <Button asChild variant="raised" className={TILE}>
              <a
                href={FULL_PRICE_HREF}
                onClick={(e) => {
                  if (readPromo() && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                    e.preventDefault();
                    setDiscountOpen(true);
                  } else addUtm(FULL_PRICE_HREF)(e);
                }}
                onAuxClick={addUtm(FULL_PRICE_HREF)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={TILE_LABEL}>Standard</span>
                <span className={`${TILE_PRICE} leading-none`}>
                  ${standard.prices.full.usd}
                </span>
              </a>
            </Button>
          ))}
        <Button
          type="button"
          variant="raised"
          id="supporter"
          onClick={() => setOpenModal("supporter")}
          className={`${TILE} scroll-mt-24`}
        >
          <span className={TILE_LABEL}>Supporter</span>
          <span className={`${TILE_PRICE} leading-none`}>
            {isBtc ? (
              <>&#8383;{supporterTier.floor.btc}+</>
            ) : (
              <>${supporterTier.floor.usd}+</>
            )}
          </span>
        </Button>
        {/* Day passes: USD → the modal's Stripe links, BTC → its OpenNode form. */}
        <Button
          type="button"
          variant="raised"
          id="day-pass"
          onClick={() => setOpenModal("day-pass")}
          // Narrower padding + a 32px line box so the three-price line fits the
          // shared 210px desktop tile at the same height as the others.
          className={TILE.replace("px-7", "px-4")}
        >
          <span className={TILE_LABEL}>Day pass</span>
          <span
            className={`${HEADING} leading-[32px] text-tan ${isBtc ? "text-[15px] max-[460px]:text-[9px]" : "text-[22px] max-[460px]:text-[13px]"}`}
          >
            {isBtc
              ? `\u20BF${dayPasses.map((p) => p.btc).join("/")}`
              : dayPasses.map((p) => `$${p.usd}`).join("/")}
          </span>
          <span className={TILE_NOTE}>
            {dayPasses.map((p) => p.date.long.slice(0, 3)).join(" · ")}
          </span>
        </Button>
        {/* The swag bubble is a sibling, not a child: a button can't nest in
            the tile's button. It straddles the tile's bottom edge and follows
            the tile's hover lift, and the margin keeps it clear of whatever
            tile wraps in below. */}
        <div className="relative mb-9 flex">
          <Button
            type="button"
            variant="raised"
            id="family-pack"
            onClick={() => setOpenModal("family-pack")}
            // Narrower padding so the long label fits the shared 210px desktop tile.
            className={`peer ${TILE.replace("px-7", "px-4")} max-[460px]:pb-6`}
          >
            <span className={TILE_LABEL}>Family &amp; Friends</span>
            <span className="flex items-baseline gap-2.5 leading-none">
              <span className={TILE_STRIKE}>${STANDARD_USD}</span>
              <span className={TILE_PRICE}>${FAMILY_PACK.usd}</span>
            </span>
            <span className={TILE_NOTE}>
              each · {FAMILY_PACK.min}–{FAMILY_PACK.max} tickets
            </span>
          </Button>
          <button
            type="button"
            id="friend-swag"
            onClick={() => setOpenModal("friend-swag")}
            className={`absolute inset-x-0 -bottom-8 z-10 mx-auto w-[190px] -rotate-2 scroll-mt-24 rounded-2xl border-2 border-navy bg-meeple px-2.5 py-1.5 text-center font-space-mono text-[10px] leading-[1.25] font-bold tracking-[0.04em] text-cream uppercase shadow-[3px_3px_0_0_var(--color-navy)] transition-[translate,scale] duration-150 peer-hover:-translate-[5px] hover:scale-105 max-[460px]:-inset-x-1.5 max-[460px]:w-auto max-[460px]:text-[9px]`}
          >
            Plus special bring‑a‑friend reward swag
          </button>
        </div>
        <Button
          type="button"
          variant="raised"
          id="discount-rate"
          onClick={() => setOpenModal("discount-rate")}
          className={TILE}
        >
          <span className={TILE_LABEL}>Student / Aid</span>
          <span className={`${TILE_PRICE} leading-none`}>50% off</span>
        </Button>
        <Button asChild variant="raised" className={TILE}>
          <VolunteerFormLink>
            <span className={TILE_LABEL}>Volunteer</span>
            <span className={`${TILE_PRICE} leading-none`}>$0</span>
          </VolunteerFormLink>
        </Button>
      </div>
      {discountOpen && <DiscountModal onClose={() => setDiscountOpen(false)} />}
      {openModal === "supporter" && <SupporterModal onClose={closeModal} />}
      {openModal === "day-pass" && <DayPassModal onClose={closeModal} />}
      {openModal === "discount-rate" && (
        <DiscountRateModal onClose={closeModal} />
      )}
      {openModal === "family-pack" && <FamilyPackModal onClose={closeModal} />}
      {openModal === "friend-swag" && (
        <FriendSwagModal
          onClose={closeModal}
          onBuy={() => setOpenModal("family-pack")}
        />
      )}
      {btcOpen && standard && (
        <BtcModal
          ticket={standard}
          initialCode={btcOpen === "early-bird" ? "EARLYBIRD" : ""}
          onClose={() => setBtcOpen(null)}
        />
      )}
    </>
  );
}
