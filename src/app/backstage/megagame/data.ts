import "server-only";
import { fillSeries, type SeriesRow } from "./over-time/series";
import type { OverTimeView } from "./over-time/view";
import { MEGAGAME_CLASSES, type MegagameClass } from "@/lib/megagame-levels";
import {
  isCompleteMegagameCode,
  playerQuestStatus,
  type PlayerQuestStatus,
  type QuestWindow,
} from "@/lib/megagame-rules";
import {
  completionSeries,
  completionsInClass,
  confirmationOutcome,
  findQuestByCode,
  levelEventSeries,
  liveCompletions,
  playersByIds,
  recentConfirmations,
  recentLevelUps,
  recentVoids,
  type ConfirmationOutcome,
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
    recentConfirmations(null, limit + 1),
    recentLevelUps(limit + 1),
    recentVoids(limit + 1),
  ]);
  const total = confirmations.length + levelUps.length + voids.length;
  return {
    actions: mergeRecentActions(
      { confirmations, levelUps, voids },
      viewer,
      limit,
    ),
    more: total > limit,
  };
}

export type ConfirmationView = {
  outcome: ConfirmationOutcome;
  mayUndo: boolean;
  nameOf: Record<string, string>;
  /** Per-player completion ids, for managers only. */
  completionIds: Record<string, string>;
};

/** Null when the id names no confirmation of this quest. */
export async function loadConfirmation(
  id: string,
  quest: Quest,
  viewer: Viewer,
): Promise<ConfirmationView | null> {
  const outcome = await confirmationOutcome(id);
  if (!outcome || outcome.confirmation.questId !== quest.id) return null;
  const { confirmation } = outcome;
  const live = outcome.status !== "voided";
  const [players, completions] = await Promise.all([
    playersByIds(confirmation.requestedUserIds),
    live && viewer.manager
      ? liveCompletions(quest.id, outcome.recorded)
      : Promise.resolve([]),
  ]);
  return {
    outcome,
    mayUndo: viewer.manager || confirmation.confirmedBy === viewer.userId,
    nameOf: Object.fromEntries(players.map((p) => [p.id, p.name])),
    completionIds: Object.fromEntries(
      completions
        .filter((c) => c.confirmationId === id)
        .map((c) => [c.userId, c.id]),
    ),
  };
}

export async function loadListedPlayers(
  ids: readonly string[],
): Promise<PlayerSummary[]> {
  return ids.length > 0 ? playersByIds(ids) : [];
}

export type LevelUpTarget = {
  player: PlayerSummary;
  completions: Record<MegagameClass, number>;
};

export async function loadLevelUpTarget(
  userId: string,
): Promise<LevelUpTarget | null> {
  const [player] = await playersByIds([userId]);
  if (!player) return null;
  const counts = await Promise.all(
    MEGAGAME_CLASSES.map(
      async (c) => [c, await completionsInClass(player.id, c)] as const,
    ),
  );
  return {
    player,
    completions: Object.fromEntries(counts) as Record<MegagameClass, number>,
  };
}

/** Empty when the range has too many buckets, without querying. */
export async function loadOverTime(view: OverTimeView): Promise<SeriesRow[]> {
  if (view.tooMany) return [];
  const [completions, levelEvents] = await Promise.all([
    completionSeries(view.size, view.from, view.to),
    levelEventSeries(view.size, view.from, view.to),
  ]);
  return fillSeries(view.buckets, completions, levelEvents);
}
