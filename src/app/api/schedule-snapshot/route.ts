import { loadScheduleSnapshot } from "@/app/(v2)/schedule/data";

export const dynamic = "force-dynamic";

/** An open /schedule tab's re-read: the page's own loaders, so its visibility. */
export async function GET() {
  return Response.json(await loadScheduleSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
