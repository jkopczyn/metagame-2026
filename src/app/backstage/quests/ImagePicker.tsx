"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { smallButtonClass } from "../ui";
import { downscaleImage } from "@/lib/downscale-image";

export const UPLOAD_URL = "/backstage/quests/api";
export const QUEST_IMAGE_PX = 2400;
export const QUEST_IMAGE_FOLDER = "megagame-quests";

/** Shrinks a picture and sends it straight to Blob; the URL is what the form keeps. */
export async function uploadQuestImage(file: File): Promise<string> {
  const small = await downscaleImage(file, QUEST_IMAGE_PX);
  const ext = small.type === "image/webp" ? "webp" : "jpg";
  const { url } = await upload(
    `${QUEST_IMAGE_FOLDER}/${crypto.randomUUID()}.${ext}`,
    small,
    {
      access: "public",
      handleUploadUrl: UPLOAD_URL,
      contentType: small.type,
    },
  );
  return url;
}

/**
 * Pictures for one field: each upload is a hidden input with the Blob URL,
 * so the form submits URLs and no bytes.
 */
export default function ImagePicker({
  name,
  label,
  initial,
  max,
  hint,
}: {
  name: string;
  label: string;
  initial: string[];
  max: number;
  hint?: string;
}) {
  const [urls, setUrls] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const room = max - urls.length;
      const picked = [...files].slice(0, room);
      if (picked.length < files.length)
        setError(`Only ${max} picture${max === 1 ? "" : "s"} fit here.`);
      const added: string[] = [];
      for (const f of picked) added.push(await uploadQuestImage(f));
      setUrls((u) => [...u, ...added]);
    } catch (err) {
      setError((err as Error).message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  const move = (i: number, step: number) =>
    setUrls((u) => {
      const j = i + step;
      if (j < 0 || j >= u.length) return u;
      const next = [...u];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-ink/80">{label}</legend>
      {urls.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {urls.map((url, i) => (
            <li key={url} className="flex flex-col items-center gap-1">
              <input type="hidden" name={name} value={url} />
              {/* eslint-disable-next-line @next/next/no-img-element -- Blob URL, any size */}
              <img
                src={url}
                alt=""
                className="h-28 w-28 rounded-lg border border-line bg-white object-contain"
              />
              <div className="flex gap-1">
                {max > 1 && (
                  <>
                    <button
                      type="button"
                      className={smallButtonClass}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label="Move left"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className={smallButtonClass}
                      disabled={i === urls.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move right"
                    >
                      →
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={smallButtonClass}
                  onClick={() => setUrls((u) => u.filter((x) => x !== url))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {urls.length < max && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink/70">
          <input
            type="file"
            accept="image/*"
            multiple={max > 1}
            disabled={busy}
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = "";
            }}
            className="text-sm"
          />
          {busy && <span>Uploading…</span>}
        </label>
      )}
      {hint && <p className="text-xs text-ink/60">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-meeple">
          {error}
        </p>
      )}
    </fieldset>
  );
}
