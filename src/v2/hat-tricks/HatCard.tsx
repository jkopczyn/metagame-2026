import type { HatCardView } from "@/lib/hat-tricks-view";
import { HEADING } from "@/v2/components/styles";

/** One on-shift hat: the line art, the photo slot, and its last theft. */
export default function HatCard({ hat }: { hat: HatCardView }) {
  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- static line art, no layout shift to fix */}
        <img src={hat.art} alt="" className="size-24 shrink-0" />
        {/* eslint-disable-next-line @next/next/no-img-element -- falls back to the same line art until photos exist */}
        <img
          src={hat.photo}
          alt={hat.name}
          className="size-24 shrink-0 rounded-md object-cover"
        />
      </div>
      <h3 className={`${HEADING} mt-4 text-[22px] text-navy`}>{hat.name}</h3>
      <p className="mt-1 text-sm text-ink/70">
        {hat.lastStolen
          ? `Last stolen by ${hat.lastStolen.name} at ${hat.lastStolen.atLabel}`
          : "Not stolen yet"}
      </p>
    </div>
  );
}
