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
  completionsByIds,
  completionsInClass,
  findQuestByCode,
  levelEventSeries,
  liveCompletions,
  playersByIds,
  recentCompletions,
  recentLevelUps,
  recentVoids,
  type PlayerSummary,
  type Quest,
  type RecentCompletion,
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
  | (Common & { kind: "completion"; item: RecentCompletion })
  | (Common & { kind: "level"; item: RecentLevelUp })
  | (Common & { kind: "void"; item: VoidRow });

export type RecentSources = {
  completions: readonly RecentCompletion[];
  levelUps: readonly RecentLevelUp[];
  voids: readonly VoidRow[];
};

export function mergeRecentActions(
  { completions, levelUps, voids }: RecentSources,
  viewer: Viewer,
  limit: number,
): RecentAction[] {
  const mayUndo = (by: string | null, voidedAt: Date | null) =>
    voidedAt === null && (viewer.manager || by === viewer.userId);
  const all: RecentAction[] = [
    ...completions.map((item) => ({
      kind: "completion" as const,
      key: `completion-${item.id}`,
      at: item.completedAt,
      mayUndo: mayUndo(item.confirmedBy, item.undoneAt),
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
      key: `void-${item.id}`,
      at: item.voidedAt,
      mayUndo: false,
      item,
    })),
  ];
  return all.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/**
 * Completions per player, level-ups and level-up undos by every volunteer,
 * newest first. An undone completion stays in its place with its reason.
 */
export async function loadRecentActions(
  limit: number,
  viewer: Viewer,
): Promise<{ actions: RecentAction[]; more: boolean }> {
  const [completions, levelUps, voids] = await Promise.all([
    recentCompletions(null, limit + 1),
    recentLevelUps(limit + 1),
    recentVoids(limit + 1),
  ]);
  const total = completions.length + levelUps.length + voids.length;
  return {
    actions: mergeRecentActions(
      { completions, levelUps, voids },
      viewer,
      limit,
    ),
    more: total > limit,
  };
}

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
