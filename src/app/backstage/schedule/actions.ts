"use server";

import { revalidatePath } from "next/cache";
import { EXPIRED, requireAccess } from "@/lib/admin-auth";
import { deleteImage } from "@/lib/blob";
import { gradingSummary, type GradingSummary } from "@/lib/rfp-sessions";
import { ImageUploadError, replaceRoomImages } from "@/lib/room-images";
import { type RoomClash, type ScheduleAccount } from "@/lib/schedule";
import {
  parseLocationFields,
  parseSessionFields,
  type Raw,
} from "@/lib/schedule-input";
import {
  cancelRsvp,
  ensureAccount,
  explainDbError,
  insertSample,
  locationImages,
  moveSessionTo,
  nextDisplayOrder,
  OverlapError,
  removeLocation,
  removeSample,
  removeSession,
  rsvp,
  searchAccounts,
  setLocationOrder,
  upsertLocation,
  type RoomImages,
  upsertSession,
} from "@/lib/schedule-store";

export type FormState = {
  ok?: boolean;
  error?: string;
  /** Field the error belongs to, when it's one field's fault. */
  field?: string;
  /** Not saved: it would double-book this; resubmitting with allowOverlap saves anyway. */
  conflict?: RoomClash;
};

const refused = (err: unknown): FormState =>
  err instanceof OverlapError ? { conflict: err.clash } : explainDbError(err);

const PATH = "/backstage/schedule";

const str = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim();

const optional = (formData: FormData, key: string) =>
  str(formData, key) || null;

/** The form's text fields; repeated names (hostId) collapse to one, so read those separately. */
const fields = (formData: FormData): Raw => Object.fromEntries(formData);

export type SchedulerNotes = GradingSummary | { error: string };

export async function loadSchedulerNotes(
  sessionId: string,
): Promise<SchedulerNotes> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };
  try {
    const summary = await gradingSummary(sessionId);
    if (summary) return summary;
  } catch (err) {
    console.error("[admin/schedule] grades read failed", sessionId, err);
  }
  return { error: "Couldn’t load the grades" };
}

export async function saveSession(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };

  const parsed = parseSessionFields(fields(formData));
  if (!parsed.ok) return { field: parsed.field, error: parsed.error };

  const hostIds = [
    ...new Set(formData.getAll("hostId").map(String).filter(Boolean)),
  ];

  try {
    await upsertSession(
      { id: str(formData, "id") || undefined, ...parsed.value, hostIds },
      { allowOverlap: str(formData, "allowOverlap") === "1" },
    );
  } catch (err) {
    return refused(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Drops a session on the grid: new room and start, same length. */
export async function moveSession(
  id: string,
  startsAt: string,
  locationId: string | null,
  allowOverlap = false,
  endsAt?: string,
): Promise<FormState> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };
  const start = new Date(startsAt);
  const end = endsAt === undefined ? undefined : new Date(endsAt);
  if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime())))
    return { error: "That time is invalid." };
  try {
    await moveSessionTo(id, start, locationId, allowOverlap, end);
  } catch (err) {
    return refused(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function findAccounts(query: string): Promise<ScheduleAccount[]> {
  if (!(await requireAccess("schedule.manage"))) return [];
  const q = query.trim();
  return q.length < 2 ? [] : searchAccounts(q);
}

export type NewAccountResult =
  | { account: ScheduleAccount; error?: never }
  | { account?: never; error: string };

/** Links the account with this email, making one if there is none. */
export async function addAccount(
  name: string,
  email: string,
): Promise<NewAccountResult> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };
  name = name.trim();
  email = email.trim().toLowerCase();
  if (!name) return { error: "Name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: "That email doesn't look right." };
  try {
    return { account: await ensureAccount(name, email) };
  } catch (err) {
    return { error: explainDbError(err).error };
  }
}

/** RSVPs someone else, e.g. a walk-up; waitlists them when full. */
export async function addRsvpFor(
  sessionId: string,
  userId: string,
): Promise<FormState> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };
  try {
    await rsvp(sessionId, userId);
  } catch (err) {
    return explainDbError(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function removeRsvpFor(
  sessionId: string,
  userId: string,
): Promise<FormState> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };
  try {
    await cancelRsvp(sessionId, userId);
  } catch (err) {
    return explainDbError(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteSession(id: string): Promise<FormState> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };
  try {
    await removeSession(id);
  } catch (err) {
    return explainDbError(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function saveLocation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };

  const parsed = parseLocationFields(fields(formData));
  if (!parsed.ok) return { field: parsed.field, error: parsed.error };

  const id = str(formData, "id") || undefined;
  // Order comes from dragging the rooms list; a new room joins at the end.
  const displayOrder = id
    ? parsed.value.displayOrder
    : await nextDisplayOrder();
  const previous: RoomImages = (id && (await locationImages(id))) || {
    thumbnailUrl: null,
    imageUrl: null,
  };
  // A picked image arrives as both sizes; Remove clears the hidden URL.
  const file = (key: string) => {
    const f = formData.get(key);
    return f instanceof File && f.size > 0 ? f : undefined;
  };
  const thumbnail = file("thumbnailFile");
  const removed =
    !thumbnail &&
    previous.thumbnailUrl !== null &&
    optional(formData, "thumbnailUrl") !== previous.thumbnailUrl;
  const change = thumbnail
    ? { thumbnail, image: file("imageFile") ?? null }
    : removed
      ? { thumbnail: null, image: null }
      : { thumbnail: undefined, image: undefined };

  try {
    await replaceRoomImages(previous, change, async (images) => {
      await upsertLocation({
        id,
        ...parsed.value,
        displayOrder,
        ...images,
      });
    });
  } catch (err) {
    if (err instanceof ImageUploadError)
      return { field: "thumbnail", error: err.message };
    return explainDbError(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Every room id, in the order the list now shows them. */
export async function reorderLocations(ids: string[]): Promise<FormState> {
  if (!(await requireAccess("schedule.rooms"))) return { error: EXPIRED };
  try {
    await setLocationOrder(ids);
  } catch (err) {
    return explainDbError(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteLocation(id: string): Promise<FormState> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };
  try {
    const images = await removeLocation(id);
    await deleteImage(images?.thumbnailUrl ?? null);
    await deleteImage(images?.imageUrl ?? null);
  } catch (err) {
    return explainDbError(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

// Sample data only from `next dev`, never a deployed site.
const sampleAllowed = process.env.NODE_ENV === "development";

export async function addSample(): Promise<FormState> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };
  if (!sampleAllowed) return { error: "Sample data is dev-only." };
  try {
    await insertSample();
  } catch (err) {
    return explainDbError(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function clearSample(): Promise<FormState> {
  if (!(await requireAccess("schedule.manage"))) return { error: EXPIRED };
  if (!sampleAllowed) return { error: "Sample data is dev-only." };
  try {
    await removeSample();
  } catch (err) {
    return explainDbError(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}
