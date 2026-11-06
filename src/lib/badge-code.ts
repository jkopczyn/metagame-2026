/** The badge number as printed and as its QR sticker encodes it: "0042". */
export const formatBadgeCode = (n: number) => String(n).padStart(4, "0");

export const BADGE_CODE_MAX = 9999;

export const isBadgeCode = (n: number) =>
  Number.isInteger(n) && n >= 0 && n <= BADGE_CODE_MAX;
