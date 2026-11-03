"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { XIcon } from "lucide-react";
import { deleteLocation, saveLocation, type FormState } from "./actions";
import {
  buttonClass,
  fieldClass,
  selectClass,
  selectStyle,
  smallButtonClass,
} from "../ui";
import { downscaleImage } from "@/lib/downscale-image";
import { UnsavedChangesDialog, useUnsavedChanges } from "./UnsavedChanges";
import {
  LOCATION_VISIBILITIES,
  VISIBILITY_LABEL,
  type ScheduleLocation,
} from "@/lib/schedule";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";

function Field({
  label,
  name,
  state,
  children,
}: {
  label: string;
  name: string;
  state: FormState;
  children: React.ReactNode;
}) {
  const error = state.field === name ? state.error : null;
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink/80">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-meeple">{error}</span>}
    </label>
  );
}

const THUMB_PX = 320;
const LARGE_PX = 1600;
// Under the server's 900KB cap for large images.
const LARGE_MAX_BYTES = 850 * 1024;

/**
 * The room's image as of Save: `url` is the saved Blob URL, or a local preview
 * of `file` when a new image was picked. `large` is the same pick, ~1600px.
 */
type Thumb = { url: string | null; file: File | null; large: File | null };

function ThumbnailPicker({
  value,
  onChange,
  error,
}: {
  value: Thumb;
  onChange: (v: Thumb) => void;
  error: string | null;
}) {
  const shown = value.url;

  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const take = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProblem("That isn’t an image.");
      return;
    }
    try {
      const small = await downscaleImage(file, THUMB_PX);
      let large = await downscaleImage(file, LARGE_PX);
      if (large.size > LARGE_MAX_BYTES)
        large = await downscaleImage(file, LARGE_PX * 0.75);
      onChange({ url: URL.createObjectURL(small), file: small, large });
      setProblem(null);
    } catch {
      setProblem("Couldn’t read that image.");
    }
  };

  return (
    <div className="text-sm">
      <span className="mb-1 block font-medium text-ink/80">Thumbnail</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void take(e.dataTransfer.files[0]);
          }}
          className={`flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed text-center text-xs text-ink/50 transition-colors ${
            dragging
              ? "border-navy bg-navy/5"
              : "border-line hover:border-ink/40"
          }`}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- already thumbnail-sized
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            "Drop an image or click to choose"
          )}
        </button>
        {shown && (
          <button
            type="button"
            onClick={() => onChange({ url: null, file: null, large: null })}
            className={smallButtonClass}
          >
            Remove
          </button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {(problem ?? error) && (
        <span className="mt-1 block text-xs text-meeple">
          {problem ?? error}
        </span>
      )}
    </div>
  );
}

export default function LocationForm({
  location,
  onClose,
}: {
  location: ScheduleLocation | null;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveLocation,
    {},
  );
  const [deleting, startDelete] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [thumbnail, setThumbnail] = useState<Thumb>({
    url: location?.thumbnailUrl ?? null,
    file: null,
    large: null,
  });

  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);

  const { formRef, requestClose, confirm } = useUnsavedChanges({
    onClose,
    pending,
    extraDirty: thumbnail.url !== (location?.thumbnailUrl ?? null),
  });

  const generalError =
    state.error && !state.field ? state.error : (deleteError ?? null);

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[480px] border-line bg-white px-6 py-6 text-ink sm:px-8"
      >
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close"
          className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-md text-ink/40 transition-colors hover:text-ink"
        >
          <XIcon className="size-[18px]" />
        </button>
        <DialogTitle className="font-bebas text-2xl tracking-wide text-navy">
          {location ? "Edit room" : "New room"}
        </DialogTitle>
        <DialogDescription className="mt-1 mb-5 text-sm text-ink/60">
          Rooms are the grid’s columns; drag them in the rooms list to reorder.
        </DialogDescription>

        <form
          ref={formRef}
          // Submitted by hand: a form `action` resets every field once it
          // returns, which would wipe the edits on a failed save.
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (thumbnail.file) fd.set("thumbnailFile", thumbnail.file);
            if (thumbnail.large) fd.set("imageFile", thumbnail.large);
            startTransition(() => formAction(fd));
          }}
          className="grid gap-4"
        >
          {location && (
            <>
              <input type="hidden" name="id" value={location.id} />
              <input
                type="hidden"
                name="displayOrder"
                value={location.displayOrder}
              />
            </>
          )}

          <Field label="Name" name="name" state={state}>
            <input
              name="name"
              required
              defaultValue={location?.name ?? ""}
              className={fieldClass}
              autoFocus
            />
          </Field>

          <Field label="Where on campus" name="campusLocation" state={state}>
            <input
              name="campusLocation"
              defaultValue={location?.campusLocation ?? ""}
              placeholder="e.g. Upstairs, main building"
              className={fieldClass}
            />
          </Field>

          <Field label="Description" name="description" state={state}>
            <textarea
              name="description"
              rows={3}
              defaultValue={location?.description ?? ""}
              className={fieldClass}
            />
          </Field>

          <Field label="Capacity" name="capacity" state={state}>
            <input
              name="capacity"
              inputMode="numeric"
              defaultValue={location?.capacity ?? ""}
              className={fieldClass}
            />
          </Field>

          <ThumbnailPicker
            value={thumbnail}
            onChange={setThumbnail}
            error={state.field === "thumbnail" ? (state.error ?? null) : null}
          />
          <input
            type="hidden"
            name="thumbnailUrl"
            value={thumbnail.file ? "" : (thumbnail.url ?? "")}
          />

          <Field label="Who sees this room" name="visibility" state={state}>
            <select
              name="visibility"
              defaultValue={location?.visibility ?? "public"}
              className={selectClass}
              style={selectStyle}
            >
              {LOCATION_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {location &&
                (confirmDelete ? (
                  <>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() =>
                        startDelete(async () => {
                          const result = await deleteLocation(location.id);
                          if (result.error) setDeleteError(result.error);
                          else onClose();
                        })
                      }
                      className={`${smallButtonClass} border-meeple text-meeple hover:bg-meeple hover:text-white`}
                    >
                      {deleting ? "Deleting…" : "Yes, delete it"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className={smallButtonClass}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    title="Sessions in this room keep their row and lose the room."
                    className={`${smallButtonClass} hover:border-meeple hover:text-meeple`}
                  >
                    Delete
                  </button>
                ))}
              {generalError && (
                <span className="text-sm text-meeple">{generalError}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                className={smallButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className={`${buttonClass} w-auto`}
              >
                {pending ? "Saving…" : location ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </form>
        <UnsavedChangesDialog {...confirm} />
      </DialogContent>
    </Dialog>
  );
}
