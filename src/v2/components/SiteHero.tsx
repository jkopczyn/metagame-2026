import SignupForm from "@/v2/components/signup/SignupForm";
import Dice from "./dice/Dice";
import HeroBackdrop from "./HeroBackdrop";

// The above-the-fold banner: one viewport tall (more if the card needs it),
// and the photo ends where the next section starts. The library photo
// (washed) sits behind the rolling-dice METAGAME wordmark, then the headline
// and mailing-list signup on a cream card so they read against the photo.
// Content hangs from the top (pt-[6vh]) rather than centring, so HeroBackdrop
// can place its wash on the dice with a fixed formula. `isolate` keeps the backdrop's -z-10 inside this
// section's stacking context: behind the dice, above the cream.
export default function SiteHero() {
  return (
    <section className="relative isolate flex min-h-[88svh] flex-col items-center px-8 pt-[6vh] pb-8 text-center md:pt-[7vh]">
      <HeroBackdrop />
      <Dice />
      <div className="mt-4 flex w-[85vw] max-w-[52ch] flex-col items-center rounded-lg border border-navy/10 bg-cream/70 px-5 py-4 shadow-[0_8px_24px_rgba(23,48,89,0.12)] md:mt-10 md:w-auto md:px-7 md:py-5">
        <p className="font-space-mono text-lg tracking-[0.04em] text-meeple uppercase md:text-xl md:tracking-[0.12em]">
          Metagame 2026 is over!
        </p>
        <p className="mt-3 font-grotesk text-[clamp(28px,5vw,44px)] leading-[1.05] font-bold tracking-[-0.01em] text-navy">
          Metagame 2027 is coming!
        </p>
        <div className="mt-4 w-full md:mt-5">
          <p className="mb-2 font-grotesk text-sm text-navy md:text-base">
            Stay updated
          </p>
          <SignupForm light compact />
        </div>
      </div>
    </section>
  );
}
