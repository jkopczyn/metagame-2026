// The six physical hats of the Hat Tricks minigame. Unrelated to the
// website's hidden-hat easter egg in src/v2/hat-trick/.

export const HAT_IDS = [
  "wizard",
  "saucer",
  "fuzzy",
  "slouch",
  "tricorn",
  "crown",
] as const;

export type HatId = (typeof HAT_IDS)[number];

export type Hat = {
  id: HatId;
  name: string;
  art: string;
  // A photo of the physical hat; the art stands in if a hat has none.
  photo?: string;
};

const NAMES: Record<HatId, string> = {
  wizard: "Wizard hat",
  saucer: "Alien saucer",
  fuzzy: "Sparkly fuzzy hat",
  slouch: "Satin slouch hat",
  tricorn: "Pirate tricorn",
  crown: "Spiked crown",
};

export const HATS: readonly Hat[] = HAT_IDS.map((id) => ({
  id,
  name: NAMES[id],
  art: `/images/hat-tricks/${id}.svg`,
  photo: `/images/hat-tricks/${id}.jpg`,
}));

export function isHatId(value: unknown): value is HatId {
  return (
    typeof value === "string" && (HAT_IDS as readonly string[]).includes(value)
  );
}

export function hatById(id: HatId): Hat {
  return HATS[HAT_IDS.indexOf(id)];
}
