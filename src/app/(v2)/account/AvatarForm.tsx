"use client";

import { useRef, useState, useTransition } from "react";
import { removeAvatar, saveAvatar, type AvatarResult } from "./actions";
import AvatarCropDialog, { type PickedImage } from "./AvatarCropDialog";
import { cropImage, type CropArea } from "@/lib/crop-image";
import Avatar from "@/v2/components/Avatar";
import { Button } from "@/v2/components/ui/button";

const AVATAR_PX = 512;

const GREY_LINK =
  "text-sm text-ink/55 underline-offset-2 hover:text-ink hover:underline disabled:opacity-60";

export default function AvatarForm({
  imageUrl,
  name,
}: {
  imageUrl: string | null;
  name: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedImage | null>(null);

  const run = (action: () => Promise<AvatarResult>) =>
    start(async () => {
      try {
        setError((await action()).error ?? null);
      } catch {
        setError("Couldn’t save that. Try again.");
      }
    });

  const take = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That isn’t an image.");
      return;
    }
    setError(null);
    setPicked({ file, url: URL.createObjectURL(file) });
  };

  const close = () => {
    if (picked) URL.revokeObjectURL(picked.url);
    setPicked(null);
  };

  const save = (file: File, area: CropArea) => {
    close();
    run(async () => {
      let cropped: File;
      try {
        cropped = await cropImage(file, area, AVATAR_PX);
      } catch {
        return { error: "Couldn’t read that image." };
      }
      const data = new FormData();
      data.set("image", cropped);
      return saveAvatar(data);
    });
  };

  return (
    <div className="flex items-center gap-5">
      <Avatar imageUrl={imageUrl} name={name} className="size-24 text-2xl" />
      <div className="flex flex-col items-start gap-2">
        <div className="flex items-center gap-4">
          <Button
            type="button"
            size="sm"
            variant="navy"
            disabled={pending}
            onClick={() => fileInput.current?.click()}
          >
            {pending ? "Saving…" : imageUrl ? "Change photo" : "Add a photo"}
          </Button>
          {imageUrl && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(removeAvatar)}
              className={GREY_LINK}
            >
              Remove
            </button>
          )}
        </div>
        <p aria-live="polite" className="min-h-5 text-sm text-meeple">
          {error}
        </p>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <AvatarCropDialog picked={picked} onCancel={close} onSave={save} />
    </div>
  );
}
