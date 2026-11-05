"use client";

import { useEffect, useRef, useState } from "react";
import type { Options, TypeNumber } from "qr-code-styling";
import { cn } from "@/lib/utils";
import { qrQuietZone } from "@/lib/qr-quiet-zone";
import { LINK_QR_STYLES } from "@/lib/qr-styles";
import { selectClass, selectStyle } from "../ui";

const SIZES = [
  { px: 512, label: "512 px" },
  { px: 1024, label: "1024 px" },
  { px: 2048, label: "2048 px (print)" },
] as const;

const STYLES = LINK_QR_STYLES;
type Style = keyof typeof STYLES;

const NAVY = "#173059";

const qrOptions = (url: string, style: Style, size: number): Options => {
  const s = STYLES[style];
  const image = "image" in s ? s.image : undefined;
  const errorCorrectionLevel = image ? "H" : "M";
  const { version, margin } = qrQuietZone(url, errorCorrectionLevel, size);
  return {
    width: size,
    height: size,
    type: "canvas",
    data: url,
    margin,
    image,
    imageOptions: {
      // Logo padding scales with the export size.
      margin: Math.round(size / 64),
      imageSize: 0.35,
      crossOrigin: "anonymous",
    },
    qrOptions: {
      errorCorrectionLevel,
      mode: "Byte",
      typeNumber: version as TypeNumber,
    },
    dotsOptions: { type: s.dots, color: NAVY },
    cornersSquareOptions: { type: s.eye, color: NAVY },
    cornersDotOptions: { type: s.eyeDot, color: NAVY },
    backgroundOptions: { color: "#ffffff" },
  };
};

const loadLib = () => import("qr-code-styling").then((m) => m.default);

// Size and style are shared by every QR on the page and survive reloads.
const PREFS_KEY = "backstage-links-qr";
type Prefs = { size: number; style: Style };
const defaultPrefs: Prefs = { size: 1024, style: "square" };

const readPrefs = (): Prefs => {
  if (typeof window === "undefined") return defaultPrefs;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      size: SIZES.some((s) => s.px === raw.size) ? raw.size : defaultPrefs.size,
      style: raw.style in STYLES ? raw.style : defaultPrefs.style,
    };
  } catch {
    return defaultPrefs;
  }
};

const usePrefs = () => {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = (patch: Partial<Prefs>) =>
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return [prefs, update] as const;
};

const solidSmallButtonClass =
  "rounded-md bg-meeple px-2.5 py-1 text-sm font-semibold text-white transition-colors hover:bg-meeple-dark disabled:opacity-60";
const smallSelectClass = cn(selectClass, "rounded-md py-1 text-sm");

export default function QrDownload({
  url,
  slug,
  compact,
}: {
  url: string;
  slug: string;
  compact?: boolean;
}) {
  const [{ size, style }, update] = usePrefs();
  const [busy, setBusy] = useState(false);
  const px = compact ? 96 : 132;

  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    void loadLib().then((QRCodeStyling) => {
      const el = preview.current;
      if (cancelled || !el) return;
      el.replaceChildren();
      new QRCodeStyling(qrOptions(url, style, px * 2)).append(el);
    });
    return () => {
      cancelled = true;
    };
  }, [url, style, px]);

  const download = async () => {
    setBusy(true);
    try {
      const QRCodeStyling = await loadLib();
      await new QRCodeStyling(qrOptions(url, style, size)).download({
        name: `go-${slug}-${style}`,
        extension: "png",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-3">
      <div
        ref={preview}
        role="img"
        aria-label={`QR code for ${url}`}
        style={{ width: px, height: px }}
        className="shrink-0 rounded-lg border border-line bg-white p-1.5 [&>canvas]:h-full [&>canvas]:w-full"
      />
      <div className="flex flex-col items-start gap-2">
        <select
          aria-label="QR style"
          value={style}
          onChange={(e) => update({ style: e.target.value as Style })}
          className={smallSelectClass}
          style={selectStyle}
        >
          {(Object.keys(STYLES) as Style[]).map((k) => (
            <option key={k} value={k}>
              {STYLES[k].label}
            </option>
          ))}
        </select>
        <select
          aria-label="QR size"
          value={size}
          onChange={(e) => update({ size: Number(e.target.value) })}
          className={smallSelectClass}
          style={selectStyle}
        >
          {SIZES.map((s) => (
            <option key={s.px} value={s.px}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className={solidSmallButtonClass}
        >
          {busy ? "Rendering…" : compact ? "Download PNG" : "Download QR"}
        </button>
      </div>
    </div>
  );
}
