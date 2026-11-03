import { cn } from "@/v2/lib/utils";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** A round profile photo, or the person's initials when they have none. */
export default function Avatar({
  imageUrl,
  name,
  className,
}: {
  imageUrl: string | null;
  name: string;
  /** Size and text size, e.g. "size-24 text-2xl". */
  className: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-navy/10 font-grotesk font-bold text-navy",
        className,
      )}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- already avatar-sized
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
    </div>
  );
}
