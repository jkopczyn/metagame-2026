import "server-only";
import { can } from "./access";
import { currentSession } from "./auth";
import { normalizeMegagameCode } from "./megagame-rules";

// Where a quest label's printed /q/<code> QR link leads.

/** The redirect for a quest label's link. Nobody without the permission sees the quest. */
export async function questLinkTarget(
  rawCode: string,
  players?: string | string[],
): Promise<string> {
  const code = normalizeMegagameCode(rawCode);
  const list = [players].flat()[0]?.trim();
  const keep = list ? `?${new URLSearchParams({ players: list })}` : "";
  if (!(await currentSession())) {
    return `/login?next=${encodeURIComponent(`/q/${code}${keep}`)}`;
  }
  if (await can("megagame.verify")) {
    const query = new URLSearchParams({ quest: code });
    if (list) query.set("players", list);
    return `/backstage/megagame?${query}`;
  }
  return "/account";
}
