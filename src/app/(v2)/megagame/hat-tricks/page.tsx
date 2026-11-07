import type { Metadata } from "next";
import ContentPage from "@/v2/components/ContentPage";
import { HEADING } from "@/v2/components/styles";

// A holding page until the Hat Tricks page itself lands. The six hats are the
// real ones, so anyone who finds this knows what to look for before the game
// opens; the art is the same line art the full page uses.

export const metadata: Metadata = {
  title: "Hat Tricks — Metagame 2026",
  description: "A hat trick is when you trick someone and take their hat.",
};

const HATS = [
  { id: "wizard", tilt: "-8deg", lift: 10, drift: "3.4s", delay: "0s" },
  { id: "saucer", tilt: "5deg", lift: 34, drift: "4.1s", delay: "-1.2s" },
  { id: "fuzzy", tilt: "-3deg", lift: 4, drift: "3.7s", delay: "-0.5s" },
  { id: "slouch", tilt: "9deg", lift: 26, drift: "4.4s", delay: "-2.1s" },
  { id: "tricorn", tilt: "-6deg", lift: 14, drift: "3.2s", delay: "-0.9s" },
  { id: "crown", tilt: "4deg", lift: 38, drift: "4.7s", delay: "-1.7s" },
];

export default function HatTricksPage() {
  return (
    <ContentPage
      title="Hat Tricks"
      intro="A hat trick is when you trick someone and take their hat."
    >
      <div className="rounded-lg border border-line bg-white p-6 sm:p-8">
        <div className="flex flex-col items-center gap-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static line art, decorative */}
          <img
            src="/images/hat-tricks/stack.svg"
            alt=""
            className="h-32 w-auto sm:h-40"
          />
          <h2 className={`${HEADING} text-[clamp(24px,3vw,34px)] text-navy`}>
            Hats are not yet stealable
          </h2>
          <p className="max-w-[46ch] text-base text-ink/70 md:text-lg">
            Come back for Hat Tricks later today.
          </p>
        </div>
      </div>

      {/* The hats drift along the bottom: decoration, not a list, so they
          carry no names and nothing to read. */}
      <div
        aria-hidden
        className="mt-12 flex items-end justify-center gap-2 sm:mt-16 sm:gap-6"
      >
        {HATS.map((hat) => (
          // eslint-disable-next-line @next/next/no-img-element -- static line art, decorative
          <img
            key={hat.id}
            src={`/images/hat-tricks/${hat.id}.svg`}
            alt=""
            style={{
              rotate: hat.tilt,
              marginBottom: hat.lift,
              animationDuration: hat.drift,
              animationDelay: hat.delay,
            }}
            className="size-12 shrink-0 opacity-80 motion-safe:animate-[mg-float_3s_ease-in-out_infinite] sm:size-20"
          />
        ))}
      </div>
    </ContentPage>
  );
}
