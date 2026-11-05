import "server-only";
import {
  isCompleteMegagameCode,
  playerQuestStatus,
  type PlayerQuestStatus,
  type QuestWindow,
} from "@/lib/megagame-rules";
import {
  completionsByIds,
  findQuestByCode,
  liveCompletions,
  playersByIds,
  type PlayerSummary,
  type Quest,
} from "@/lib/megagame-store";
import { claimedCounts } from "@/lib/ticket-store";

export type PlayerRow = {
  player: PlayerSummary;
  status: PlayerQuestStatus;
  completion: { at: Date; by: string | null } | null;
};

/** The list's players with their status for a quest, or with no quest yet. */
export async function loadPlayerRows(
  ids: readonly string[],
  quest: (QuestWindow & { id: string }) | null,
): Promise<PlayerRow[]> {
  if (ids.length === 0) return [];
  const players = await playersByIds(ids);
  const found = players.map((p) => p.id);
  const [tickets, completions] = await Promise.all([
    claimedCounts(found),
    quest ? liveCompletions(quest.id, found) : Promise.resolve([]),
  ]);
  const done = new Map(completions.map((c) => [c.userId, c]));
  return players.map((player) => {
    const c = done.get(player.id);
    return {
      player,
      status: playerQuestStatus({
        quest: quest ?? { class: null },
        levels: player.levels,
        completed: c !== undefined,
        hasTicket: (tickets.get(player.id) ?? 0) > 0,
      }),
      completion: c ? { at: c.confirmedAt, by: c.confirmedByName } : null,
    };
  });
}

export type QuestLookup =
  | { status: "unknown" }
  | { status: "inactive" | "open"; quest: Quest };

export async function loadQuest(code: string): Promise<QuestLookup> {
  const quest = isCompleteMegagameCode(code)
    ? await findQuestByCode(code)
    : null;
  if (!quest) return { status: "unknown" };
  return { status: quest.active ? "open" : "inactive", quest };
}

export type Viewer = { userId: string; manager: boolean };

export type CompletionResultView = {
  recorded: { id: string; name: string; undone: boolean }[];
  /** Names of listed players whose row for this quest was already completed. */
  alreadyCompleted: string[];
  /** The rows "Undo all" would undo; empty when the viewer may not. */
  undoIds: string[];
};

/**
 * The result of a confirm, rebuilt from the recorded row ids in the URL, so a
 * reload keeps it. Rows of another quest are ignored.
 */
export async function loadCompletionResult(
  done: readonly string[],
  quest: Quest,
  list: readonly string[],
  viewer: Viewer,
): Promise<CompletionResultView> {
  const rows = (done.length > 0 ? await completionsByIds(done) : []).filter(
    (r) => r.questId === quest.id,
  );
  const recordedUsers = new Set(rows.map((r) => r.userId));
  const others = list.filter((id) => !recordedUsers.has(id));
  const ids = [...recordedUsers, ...others];
  const [players, earlier] = await Promise.all([
    ids.length > 0 ? playersByIds(ids) : Promise.resolve([]),
    liveCompletions(quest.id, others),
  ]);
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const name = (id: string) => nameOf.get(id) ?? "Deleted account";
  const completedEarlier = new Set(earlier.map((c) => c.userId));
  const live = rows.filter((r) => r.status === "completed");
  const mayUndo =
    viewer.manager || live.every((r) => r.confirmedBy === viewer.userId);
  return {
    recorded: rows.map((r) => ({
      id: r.id,
      name: name(r.userId),
      undone: r.status !== "completed",
    })),
    alreadyCompleted: others.filter((id) => completedEarlier.has(id)).map(name),
    undoIds: mayUndo ? live.map((r) => r.id) : [],
  };
}
