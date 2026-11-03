import { toolAccess } from "@/lib/admin-auth";
import { toCsv, type CsvCell } from "@/lib/csv";
import { isEventTable } from "@/lib/megagame-rules";
import { exportEventTable } from "@/lib/megagame-store";
import { pacificDayKey } from "@/lib/schedule";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/backstage/megagame/dashboard/export/[table]">,
) {
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (!(await toolAccess("megagame.manage")))
    return new Response("Not found", { status: 404, headers });
  const { table } = await ctx.params;
  if (!isEventTable(table))
    return new Response("Not found", { status: 404, headers });

  const { columns, rows } = await exportEventTable(table);
  const day = pacificDayKey(new Date().toISOString());
  return new Response(toCsv(columns, rows as CsvCell[][]), {
    headers: {
      ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="megagame-${table}-${day}.csv"`,
    },
  });
}
