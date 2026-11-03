// The brand guide's twelve "kinds of play" icons (branding/assets/glyphs):
// 48px line drawings in currentColor. The card-games front card fills with
// --glyph-bg so it hides the card behind it on any tile colour.
const PATHS = {
  "board-games": (
    <>
      <rect x="9" y="9" width="30" height="30" rx="6" />
      <circle cx="17" cy="17" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="24" cy="24" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="31" cy="31" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  puzzles: (
    <path d="M9 15 H19 a5 5 0 1 1 10 0 H37 V24 a5 5 0 1 1 0 10 V41 H9 Z" />
  ),
  "video-games": (
    <>
      <path d="M15 15 h18 a8 8 0 0 1 8 7 l2 10 a5 5 0 0 1 -9 3.5 L30 31 H18 l-4 4.5 a5 5 0 0 1 -9 -3.5 l2 -10 a8 8 0 0 1 8 -7 z" />
      <path d="M15 20 v8 M11 24 h8" />
      <circle cx="32" cy="21.5" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="36" cy="26" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  "card-games": (
    <>
      <rect
        x="17"
        y="8"
        width="21"
        height="30"
        rx="3"
        transform="rotate(12 27 23)"
      />
      <rect
        x="10"
        y="10"
        width="21"
        height="30"
        rx="3"
        fill="var(--glyph-bg, #fffbf2)"
      />
      <path d="M20.5 18 l5 7 -5 7 -5 -7 z" fill="currentColor" stroke="none" />
    </>
  ),
  crosswords: (
    <>
      <rect x="8" y="8" width="32" height="32" rx="2" />
      <path d="M18.7 8 V40 M29.3 8 V40 M8 18.7 H40 M8 29.3 H40" />
      <rect
        x="8"
        y="8"
        width="10.7"
        height="10.7"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="29.3"
        y="29.3"
        width="10.7"
        height="10.7"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  larps: (
    <>
      <path d="M9 13 c9 4 21 4 30 0 v11 c0 10 -8 16 -15 16 s-15 -6 -15 -16 z" />
      <path d="M15 22 q3 -3 6 0 M27 22 q3 -3 6 0 M19 31 q5 4 10 0" />
    </>
  ),
  talks: (
    <>
      <rect x="18" y="6" width="12" height="21" rx="6" />
      <path d="M12 22 a12 12 0 0 0 24 0 M24 34 v7 M17 41 h14" />
    </>
  ),
  workshops: (
    <path d="M11 37 l3 -10 L31 10 l7 7 L21 34 z M27 14 l7 7 M11 37 l10 -3" />
  ),
  "escape-rooms": (
    <>
      <circle cx="15" cy="24" r="7" />
      <path d="M22 24 H41 M35 24 v6 M40 24 v5" />
    </>
  ),
  megagame: (
    <>
      <circle cx="20" cy="20" r="11" />
      <path d="M28 28 L40 40" />
      <path d="M15 20 h10 M20 15 v10" />
    </>
  ),
  "party-games": (
    <>
      <path d="M7 11 h22 a3 3 0 0 1 3 3 v11 a3 3 0 0 1 -3 3 H17 l-7 6 v-6 H7 a3 3 0 0 1 -3 -3 V14 a3 3 0 0 1 3 -3 z" />
      <path d="M32 18 h9 a3 3 0 0 1 3 3 v10 a3 3 0 0 1 -3 3 h-2 v6 l-7 -6 h-8 a3 3 0 0 1 -3 -3" />
    </>
  ),
  trivia: (
    <>
      <circle cx="24" cy="24" r="17" />
      <path d="M18.5 19 a5.5 5.5 0 1 1 8 5 c-2 1 -2.5 2.2 -2.5 4.5" />
      <circle cx="24" cy="34" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  // Two more in the same hand, for the Megagame form's kinds.
  physical: (
    <>
      <circle cx="31" cy="9" r="3.2" />
      <path d="M29 15 L22 24 L30 29 L26 39" />
      <path d="M22 24 L15 33 L9 31" />
      <path d="M29 15 L36 19 L41 15" />
      <path d="M29 15 L22 16 L17 11" />
    </>
  ),
  treasure: (
    <>
      <path d="M8 22 V18 a9 9 0 0 1 9 -9 h14 a9 9 0 0 1 9 9 v4 z" />
      <rect x="8" y="22" width="32" height="17" rx="2" />
      <rect x="20.5" y="19" width="7" height="7" rx="1.5" />
      <circle cx="24" cy="22.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  // Not in the brand guide's set: drawn to match it.
  dance: (
    <>
      <circle cx="27" cy="9" r="4" />
      <path d="M26 15 L22 28 M25 18 L16 13 L11 6 M25 18 L33 21 L38 15 M22 28 L15 34 L17 42 M22 28 L30 33 L36 40" />
    </>
  ),
  // And for the session proposal's categories.
  trophy: (
    <>
      <path d="M16 8 h16 v10 a8 8 0 0 1 -16 0 z" />
      <path d="M16 11 h-5 a4.5 4.5 0 0 0 0 9 h5" />
      <path d="M32 11 h5 a4.5 4.5 0 0 1 0 9 h-5" />
      <path d="M24 26 v6 M18 39 h12 M21 32 h6 v7" />
    </>
  ),
  panel: (
    <>
      <circle cx="24" cy="15" r="4.5" />
      <circle cx="12" cy="19" r="3.5" />
      <circle cx="36" cy="19" r="3.5" />
      <path d="M15 39 v-4 a9 9 0 0 1 18 0 v4" />
      <path d="M5 36 v-3 a7 7 0 0 1 8 -7" />
      <path d="M43 36 v-3 a7 7 0 0 0 -8 -7" />
    </>
  ),
  dice: (
    <>
      <rect x="22" y="8" width="17" height="17" rx="3" />
      <circle cx="30.5" cy="16.5" r="1.8" fill="currentColor" stroke="none" />
      <rect
        x="9"
        y="21"
        width="18"
        height="18"
        rx="3"
        fill="var(--glyph-bg, #fffbf2)"
      />
      <circle cx="14" cy="26" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="18" cy="30" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="22" cy="34" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  ice: (
    <>
      <rect x="7" y="23" width="16" height="16" rx="3" />
      <rect x="25" y="23" width="16" height="16" rx="3" />
      <rect
        x="16"
        y="9"
        width="16"
        height="16"
        rx="3"
        fill="var(--glyph-bg, #fffbf2)"
      />
      <path d="M20 13.5 l3 -0.5" />
    </>
  ),
  dollar: (
    <>
      <circle cx="24" cy="24" r="17" />
      <path d="M24 13 v22" />
      <path d="M29 18.5 a4.5 4 0 0 0 -4.5 -3 h-1.5 a4.25 4.25 0 0 0 0 8.5 h2 a4.25 4.25 0 0 1 0 8.5 h-1.5 a4.5 4 0 0 1 -4.5 -3" />
    </>
  ),
};

export type GlyphName = keyof typeof PATHS;

export const GLYPH_LABELS: Record<GlyphName, string> = {
  "board-games": "Board games",
  puzzles: "Puzzles",
  "video-games": "Video games",
  "card-games": "Card games",
  crosswords: "Crosswords",
  larps: "LARPs",
  talks: "Talks",
  workshops: "Workshops",
  "escape-rooms": "Escape rooms",
  megagame: "The Megagame",
  "party-games": "Party games",
  trivia: "Trivia",
  dance: "Dance",
  physical: "Physical challenges",
  treasure: "Scavenger hunts",
  trophy: "Competitions",
  panel: "Panels",
  dice: "Tabletop RPGs",
  ice: "Icebreakers",
  dollar: "Selling or demoing",
};

export default function Glyph({
  name,
  label,
  className = "size-[1em]",
}: {
  name: GlyphName;
  /** Accessible name; omit for a decorative icon. */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      {PATHS[name]}
    </svg>
  );
}
