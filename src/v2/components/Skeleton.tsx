import { cn } from "@/lib/utils";

/** A placeholder block; callers size it to what it stands in for. */
export function Bone({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-ink/[0.07] motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/** Wraps a page's placeholders, so a screen reader hears one "Loading". */
export function Skeleton({
  label = "Loading",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  );
}
