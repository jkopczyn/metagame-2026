"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EXPIRED, requireAccess, type Access } from "@/lib/admin-auth";
import { formatBadgeCode } from "@/lib/badge-code";
import { LARGE_IMAGE_MAX_BYTES, uploadImage } from "@/lib/blob";
import { isMegagameClass } from "@/lib/megagame-levels";
import { checkLevelUp, normalizeBadgeNumber } from "@/lib/megagame-rules";
import {
  completionsByIds,
  completionsInClass,
  confirmCompletions as recordCompletions,
  findLevelEvent,
  findPlayerByBadgeNumber,
  findQuestByCode,
  playersByIds,
  recordLevelUp,
  searchPlayers,
  undoCompletions as undoCompletionRows,
  voidLevelEvent,
  type PlayerSummary,
} from "@/lib/megagame-store";
import { boardHref, parseBoardParams } from "./board-params";
import { parsePlayerIds } from "./player-list";
import { isUuid } from "./uuid";

const TOOL = "/backstage/megagame";
const STALE = "This form is out of date. Reload and try again.";
const NOT_YOURS =
  "Only the volunteer who recorded it, or someone who manages the megagame, can undo this.";
const MAX_PLAYERS = 40;

const str = (formData: FormData, key: string, max = 500) =>
  String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
const optional = (formData: FormData, key: string) =>
  str(formData, key) || null;

const verify = () => requireAccess("megagame.verify");

async function mayUndo(access: Access, ...recordedBy: (string | null)[]) {
  return (
    recordedBy.every((by) => by === access.userId) ||
    (await requireAccess("megagame.manage")) !== null
  );
}

// ---- Player lookup ----

/** What a lookup sends to the browser; spec 3.1 limits name search to these. */
export type PlayerHit = Pick<
  PlayerSummary,
  "id" | "name" | "pronouns" | "imageUrl"
>;

const toHit = ({ id, name, pronouns, imageUrl }: PlayerSummary): PlayerHit => ({
  id,
  name,
  pronouns,
  imageUrl,
});

export async function lookupPlayer(
  input: string,
): Promise<{ player?: PlayerHit; error?: string }> {
  if (!(await verify())) return { error: EXPIRED };
  const n = normalizeBadgeNumber(String(input).slice(0, 20));
  if (n === null) return { error: "Enter the four-digit badge number." };
  const player = await findPlayerByBadgeNumber(n);
  if (!player)
    return { error: `No player has badge number ${formatBadgeCode(n)}.` };
  return { player: toHit(player) };
}

export async function findPlayers(
  query: string,
): Promise<{ players?: PlayerHit[]; error?: string }> {
  if (!(await verify())) return { error: EXPIRED };
  const players = await searchPlayers(String(query).slice(0, 100));
  return { players: players.map(toHit) };
}

// ---- Quest completions ----

export type ConfirmState = { error?: string };

export async function confirmCompletions(
  _prev: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const access = await verify();
  if (!access) return { error: EXPIRED };
  const questId = str(formData, "questId");
  if (!isUuid(questId)) return { error: STALE };
  const quest = await findQuestByCode(str(formData, "questCode"));
  if (quest?.id !== questId) return { error: STALE };
  if (!quest.active) {
    return { error: "That quest is not active, so it can't be confirmed." };
  }
  const players = formData
    .getAll("player")
    .map(String)
    .filter(Boolean)
    .slice(0, MAX_PLAYERS);

  const result = await recordCompletions({
    questId,
    userIds: players,
    confirmedBy: access.userId,
  });
  if (result.status === "no-players") {
    return { error: "Add at least one player." };
  }
  revalidatePath(TOOL, "layout");
  const board = new URLSearchParams(str(formData, "board", 4000));
  redirect(
    boardHref({
      ...parseBoardParams(Object.fromEntries(board)),
      quest: quest.code,
      players: parsePlayerIds(str(formData, "list", 4000)),
      done: result.recorded.map((r) => r.id),
    }),
  );
}

export type UndoState = { error?: string; done?: boolean };

/** Undoes one completion, or every row a confirm just recorded ("Undo all"). */
export async function undoCompletions(
  _prev: UndoState,
  formData: FormData,
): Promise<UndoState> {
  const access = await verify();
  if (!access) return { error: EXPIRED };
  const ids = [
    ...new Set(formData.getAll("id").map(String).filter(isUuid)),
  ].slice(0, MAX_PLAYERS);
  const rows = ids.length > 0 ? await completionsByIds(ids) : [];
  if (rows.length === 0) return { error: "That completion was not found." };
  if (!(await mayUndo(access, ...rows.map((r) => r.confirmedBy)))) {
    return { error: NOT_YOURS };
  }
  await undoCompletionRows({
    ids: rows.map((r) => r.id),
    by: access.userId,
    reason: optional(formData, "reason"),
  });
  revalidatePath(TOOL, "layout");
  return { done: true };
}

// ---- Level-ups ----

export type LevelUpState = {
  error?: string;
  /** Failing soft checks: shown with "Yes, I'm sure" before anything is written. */
  warnings?: string[];
  awarded?: { eventId: string; class: string; level: number };
};

export async function levelUp(
  _prev: LevelUpState,
  formData: FormData,
): Promise<LevelUpState> {
  const access = await verify();
  if (!access) return { error: EXPIRED };
  const id = str(formData, "id");
  const userId = str(formData, "userId");
  const cls = str(formData, "class");
  const level = Number(str(formData, "level"));
  if (!isUuid(id) || !userId) return { error: STALE };
  if (!isMegagameClass(cls)) return { error: "Pick a class." };

  const [player] = await playersByIds([userId]);
  if (!player)
    return { error: "No such player. Reload and look them up again." };

  let warnings: string[] = [];
  // A retry of a recorded event would fail the checks against the level it
  // already set, so it goes straight to the store, which tells retries apart.
  const retry = (await findLevelEvent(id)) !== null;
  if (!retry) {
    const check = checkLevelUp({
      class: cls,
      level,
      levels: player.levels,
      completionsInClass: await completionsInClass(userId, cls),
    });
    if (!check.ok) return { error: check.errors[0] };
    warnings = check.warnings;
    if (warnings.length > 0 && formData.get("sure") !== "on") {
      return { warnings };
    }
  }

  let cardPhotoUrl: string | null = null;
  const photo = formData.get("photo");
  if (!retry && photo instanceof File && photo.size > 0) {
    try {
      cardPhotoUrl = await uploadImage(
        "megagame-cards",
        photo,
        LARGE_IMAGE_MAX_BYTES,
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Upload failed." };
    }
  }

  const result = await recordLevelUp({
    id,
    userId,
    class: cls,
    level,
    awardedBy: access.userId,
    checksPassed: warnings.length === 0,
    overrideReason: warnings.length > 0 ? optional(formData, "reason") : null,
    cardPhotoUrl,
    note: optional(formData, "note"),
  });
  switch (result.status) {
    case "awarded":
    case "retry":
      revalidatePath(TOOL, "layout");
      return { awarded: { eventId: id, class: cls, level } };
    case "already-awarded":
      return { error: "That level was already recorded for this player." };
    case "voided":
      return { error: "That level-up was undone. Reload to record it again." };
    case "id-reused":
      return { error: STALE };
    case "invalid":
      return { error: "That level can't be recorded." };
  }
}

export async function undoLevelUp(
  _prev: UndoState,
  formData: FormData,
): Promise<UndoState> {
  const access = await verify();
  if (!access) return { error: EXPIRED };
  const id = str(formData, "id");
  const event = isUuid(id) ? await findLevelEvent(id) : null;
  if (!event) return { error: "That level-up was not found." };
  if (!(await mayUndo(access, event.awardedBy))) return { error: NOT_YOURS };
  const result = await voidLevelEvent({
    id,
    voidedBy: access.userId,
    reason: optional(formData, "reason"),
  });
  if (result.status === "not-volunteer") {
    return { error: "A faction picker join can't be undone here." };
  }
  if (result.status === "not-found") {
    return { error: "That level-up was not found." };
  }
  revalidatePath(TOOL, "layout");
  return { done: true };
}
