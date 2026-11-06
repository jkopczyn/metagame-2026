import { authorize, error, json } from "@/lib/admin-api";
import { formatBadgeCode } from "@/lib/badge-code";
import { normalizeBadgeNumber } from "@/lib/megagame-rules";
import { findPlayerByBadgeNumber } from "@/lib/megagame-store";

export const dynamic = "force-dynamic";

/** The attendee whose claimed ticket carries badge {code}. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/badges/[code]">,
) {
  const access = await authorize("tickets.view");
  if (access instanceof Response) return access;
  const { code } = await ctx.params;
  const n = normalizeBadgeNumber(code.slice(0, 20));
  if (n === null) return error("A badge code is one to four digits.", 400);
  const player = await findPlayerByBadgeNumber(n);
  if (!player)
    return error(`No attendee has badge number ${formatBadgeCode(n)}.`, 404);
  return json({
    badgeCode: formatBadgeCode(n),
    userId: player.id,
    name: player.name,
  });
}
