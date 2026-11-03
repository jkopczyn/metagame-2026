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

type Ctx = RouteContext<"/api/admin/schedule/locations/[id]">;

/** Changes only the fields given. The image stays as it is. */
export async function PATCH(request: Request, ctx: Ctx) {
  const access = await authorize();
  if (access instanceof Response) return access;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  const current = (await querySchedule()).locations.find((l) => l.id === id);
  if (!current) return error("No such location.", 404);
  const parsed = parseLocationFields({ ...current, ...body });
  if (!parsed.ok) return error(parsed.error, 400, parsed.field);
  try {
    await upsertLocation({
      id,
      ...parsed.value,
      thumbnailUrl: current.thumbnailUrl,
      imageUrl: current.imageUrl,
    });
  } catch (err) {
    return failed(err);
  }
  done();
  const { locations } = await querySchedule();
  return json({ location: locations.find((l) => l.id === id) });
}
