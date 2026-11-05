// Shared class strings for the mock design system (headings, eyebrows, fields).
// Buttons now live in the shadcn <Button> (src/v2/components/ui/button.tsx) and the
// shared dark form field in the shadcn <Input> (src/v2/components/ui/input.tsx).

export const HEADING =
  "font-grotesk font-bold leading-[1.05] tracking-[-0.01em]";

export const EYEBROW = "font-space-mono text-xl tracking-[0.12em] uppercase";

export const NEWSLETTER_LINK = "font-bold text-salmon";

// Section rhythm, shared by every one-pager section.
// scroll-mt clears the mobile top bar (h-14) so a jump doesn't park the section
// under it; the desktop value is the designed offset. Padding is deliberately
// tight on mobile — the desktop rhythm reads as dead air between a divider and
// the heading it introduces — and sections layer their own values back on at md.
export const SECTION_ANCHOR = "scroll-mt-16 md:scroll-mt-24";
export const SECTION = `${SECTION_ANCHOR} py-8`;

// Light-background override for the shared <Input> (cream sections). The Input's
// own classes are the dark default; these win via tailwind-merge.
export const FIELD_LIGHT =
  "border-navy/20 bg-white text-ink placeholder:text-ink/40 focus:border-meeple";

// The display face (Bebas Neue): big titles, clock readouts, toggles.
export const DISPLAY = "font-[family-name:var(--font-bebas)] font-normal";
