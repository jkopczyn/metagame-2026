import QRCode from "qrcode";

export const QUIET_MODULES = 4;

/**
 * The version and margin for a qr-code-styling export of `size` px. It floors
 * each module to whole pixels and centres the rest, so the white border is
 * whatever the modules leave over; sizing them to leave room for the quiet zone
 * holds at every size. The caller pins the version so both libraries agree on
 * the module count.
 */
export function qrQuietZone(
  data: string,
  errorCorrectionLevel: "M" | "H",
  size: number,
) {
  const { version, modules } = QRCode.create(
    [{ data: new TextEncoder().encode(data), mode: "byte" }],
    {
      errorCorrectionLevel,
    },
  );
  const modulePx = Math.floor(size / (modules.size + 2 * QUIET_MODULES));
  return {
    version,
    margin: Math.floor((size - modules.size * modulePx) / 2),
  };
}
