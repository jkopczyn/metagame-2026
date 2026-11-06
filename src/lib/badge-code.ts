/** The badge number as printed and as its QR sticker encodes it: "0042". */
export const formatBadgeCode = (n: number) => String(n).padStart(4, "0");
