import { authorize, done, error, failed, json } from "@/lib/schedule-api";
import {
  ImageUploadError,
  replaceRoomImages,
  type ImageChange,
} from "@/lib/room-images";
import {
  querySchedule,
  locationImages,
  setLocationImages,
  type RoomImages,
} from "@/lib/schedule-store";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/admin/schedule/locations/[id]/image">;

/**
 * Multipart form with `thumbnail` (the schedule's ~320px copy) and/or `image`
 * (the ~1600px copy). Nothing is resized here, so send both already sized; a
 * part left out keeps what's stored.
 */
export async function PUT(request: Request, ctx: Ctx) {
  const access = await authorize();
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const current = await locationImages(id);
  if (!current) return error("No such location.", 404);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("Send multipart/form-data with thumbnail and/or image.", 400);
  }
  const part = (key: string) => {
    const f = form.get(key);
    return f instanceof File && f.size > 0 ? f : undefined;
  };
  const change = { thumbnail: part("thumbnail"), image: part("image") };
  if (!change.thumbnail && !change.image)
    return error("Send a thumbnail and/or image file.", 400);
  return write(id, current, change);
}

/** Removes both images. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const access = await authorize();
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const current = await locationImages(id);
  if (!current) return error("No such location.", 404);
  return write(id, current, { thumbnail: null, image: null });
}

async function write(
  id: string,
  current: RoomImages,
  change: { thumbnail: ImageChange; image: ImageChange },
) {
  try {
    await replaceRoomImages(current, change, (images) =>
      setLocationImages(id, images),
    );
  } catch (err) {
    if (err instanceof ImageUploadError)
      return error(err.message, 400, "image");
    return failed(err);
  }
  done();
  const { locations } = await querySchedule();
  return json({ location: locations.find((l) => l.id === id) });
}
