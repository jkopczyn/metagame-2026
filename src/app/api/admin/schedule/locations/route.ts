import {
  authorize,
  done,
  error,
  failed,
  json,
  readBody,
} from "@/lib/schedule-api";
import { parseLocationFields } from "@/lib/schedule-input";
import { querySchedule, upsertLocation } from "@/lib/schedule-store";

export const dynamic = "force-dynamic";

/** Creates a room. Images go through PUT /locations/[id]/image. */
export async function POST(request: Request) {
  const access = await authorize();
  if (access instanceof Response) return access;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const parsed = parseLocationFields(body);
  if (!parsed.ok) return error(parsed.error, 400, parsed.field);
  let id: string;
  try {
    id = await upsertLocation({
      ...parsed.value,
      thumbnailUrl: null,
      imageUrl: null,
    });
  } catch (err) {
    return failed(err);
  }
  done();
  const { locations } = await querySchedule();
  return json({ location: locations.find((l) => l.id === id) }, 201);
}
