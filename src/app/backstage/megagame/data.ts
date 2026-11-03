import "server-only";
import {
  isCompleteMegagameCode,
  playerQuestStatus,
  type PlayerQuestStatus,
  type QuestWindow,
} from "@/lib/megagame-rules";
import {
  findQuestByCode,
  liveCompletions,
  playersByIds,
  recentConfirmations,
  recentLevelUps,
  recentVoids,
  type PlayerSummary,
  type Quest,
  type RecentConfirmation,
  type RecentLevelUp,
  type VoidRow,
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

type Common = { key: string; at: Date; mayUndo: boolean };
export type RecentAction =
  | (Common & { kind: "confirmation"; item: RecentConfirmation })
  | (Common & { kind: "level"; item: RecentLevelUp })
  | (Common & { kind: "void"; item: VoidRow });

export type RecentSources = {
  confirmations: readonly RecentConfirmation[];
  levelUps: readonly RecentLevelUp[];
  voids: readonly VoidRow[];
};

export function mergeRecentActions(
  { confirmations, levelUps, voids }: RecentSources,
  viewer: Viewer,
  limit: number,
): RecentAction[] {
  const mayUndo = (by: string | null, voidedAt: Date | null) =>
    voidedAt === null && (viewer.manager || by === viewer.userId);
  const all: RecentAction[] = [
    ...confirmations.map((item) => ({
      kind: "confirmation" as const,
      key: `confirmation-${item.id}`,
      at: item.createdAt,
      mayUndo: mayUndo(item.confirmedBy, item.voidedAt),
      item,
    })),
    ...levelUps.map((item) => ({
      kind: "level" as const,
      key: `level-${item.id}`,
      at: item.awardedAt,
      mayUndo: mayUndo(item.awardedBy, item.voidedAt),
      item,
    })),
    ...voids.map((item) => ({
      kind: "void" as const,
      key: `void-${item.kind}-${item.id}`,
      at: item.voidedAt,
      mayUndo: false,
      item,
    })),
  ];
  return all.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** Confirmations, level-ups and undos by every volunteer, newest first. */
export async function loadRecentActions(
  limit: number,
  viewer: Viewer,
): Promise<{ actions: RecentAction[]; more: boolean }> {
  const [confirmations, levelUps, voids] = await Promise.all([
    recentConfirmations(null, limit),
    recentLevelUps(limit),
    recentVoids(limit),
  ]);
  const sources = { confirmations, levelUps, voids };
  const total = confirmations.length + levelUps.length + voids.length;
  return {
    actions: mergeRecentActions(sources, viewer, limit),
    more:
      total > limit ||
      Object.values(sources).some((rows) => rows.length >= limit),
  };
}
