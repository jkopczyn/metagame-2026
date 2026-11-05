import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { QUIET_MODULES, qrQuietZone } from "./qr-quiet-zone";

const URLS = [
  "https://metagame.games/go/poster",
  "https://metagame.games/go/a-rather-long-campaign-slug-for-the-night-market-flyers",
];

// Lays the modules out as qr-code-styling does for a margin, on a white export
// set into dark artwork, as it would sit on a printed page.
function render(url: string, level: "M" | "H", size: number, margin: number) {
  const { modules } = QRCode.create(
    [{ data: new TextEncoder().encode(url), mode: "byte" }],
    {
      errorCorrectionLevel: level,
    },
  );
  const modulePx = Math.floor((size - 2 * margin) / modules.size);
  const whitePx = Math.floor((size - modules.size * modulePx) / 2);
  const artwork = 80;
  const total = size + 2 * artwork;
  const pixels = new Uint8ClampedArray(total * total * 4);
  const paint = (x: number, y: number, side: number, value: number) => {
    for (let row = y; row < y + side; row++)
      for (let col = x; col < x + side; col++) {
        const at = (row * total + col) * 4;
        pixels.fill(value, at, at + 3);
      }
  };
  for (let at = 3; at < pixels.length; at += 4) pixels[at] = 255;
  paint(artwork, artwork, size, 255);
  for (let r = 0; r < modules.size; r++)
    for (let c = 0; c < modules.size; c++)
      if (modules.get(r, c))
        paint(
          artwork + whitePx + c * modulePx,
          artwork + whitePx + r * modulePx,
          modulePx,
          0,
        );
  return { pixels, total, whitePx, modulePx };
}

describe("qrQuietZone", () => {
  describe.each(URLS)("%s", (url) => {
    it.each([
      ["M", 512],
      ["M", 1024],
      ["M", 2048],
      ["H", 512],
      ["H", 1024],
      ["H", 2048],
      // The on-page previews.
      ["M", 192],
      ["H", 264],
    ] as const)("leaves four modules and decodes (%s, %ipx)", (level, size) => {
      const { margin } = qrQuietZone(url, level, size);
      const { pixels, total, whitePx, modulePx } = render(
        url,
        level,
        size,
        margin,
      );
      expect(modulePx).toBeGreaterThan(0);
      expect(whitePx).toBeGreaterThanOrEqual(QUIET_MODULES * modulePx);
      expect(jsQR(pixels, total, total)?.data).toBe(url);
    });
  });

  it("is what the old fixed margin fell short of", () => {
    const { whitePx, modulePx } = render(URLS[0], "M", 1024, 1024 / 40);
    expect(whitePx).toBeLessThan(QUIET_MODULES * modulePx);
  });
});
