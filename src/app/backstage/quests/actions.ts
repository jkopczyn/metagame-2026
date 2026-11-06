"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EXPIRED, requireAccess } from "@/lib/admin-auth";
import { isBlobUrl } from "@/lib/blob";
import {
  parseQuestInput,
  questInputOf,
  type QuestInput,
} from "@/lib/megagame-quests";
import {
  createQuest,
  deleteQuest as removeQuest,
  getQuest,
  listQuests,
  updateQuest,
} from "@/lib/megagame-store";
import { titleKey } from "@/lib/quest-bundle";
import { isUuid } from "../megagame/uuid";

const TOOL = "/backstage/quests";

export type QuestFormState = { errors?: string[] };

const str = (formData: FormData, key: string, max = 12000) =>
  String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);

/** Pictures come from the tool's own Blob uploads, never from a pasted URL. */
const imagesOk = (input: QuestInput) =>
  [
    ...input.bodyImages,
    ...(input.evidenceImage ? [input.evidenceImage] : []),
  ].every(isBlobUrl);

/** Creates or (with `id`) updates a quest from the editor form, then opens it. */
export async function saveQuest(
  _prev: QuestFormState,
  formData: FormData,
): Promise<QuestFormState> {
  if (!(await requireAccess("megagame.manage"))) return { errors: [EXPIRED] };
  const id = str(formData, "id");
  if (id && !isUuid(id))
    return { errors: ["This form is out of date. Reload."] };
  const parsed = parseQuestInput({
    title: str(formData, "title"),
    bodyText: str(formData, "bodyText"),
    bodyImages: formData.getAll("bodyImages").map(String).filter(Boolean),
    class: str(formData, "class"),
    minLevel: str(formData, "minLevel"),
    maxLevel: str(formData, "maxLevel"),
    minPlayers: str(formData, "minPlayers"),
    stamps: {
      wizard: str(formData, "stampsWizard"),
      pirate: str(formData, "stampsPirate"),
      alien: str(formData, "stampsAlien"),
      any: str(formData, "stampsAny"),
    },
    evidence: str(formData, "evidence"),
    evidenceImage: str(formData, "evidenceImage"),
    hint: str(formData, "hint"),
    author: str(formData, "author"),
    active: formData.has("active") ? "on" : "false",
  });
  if (!parsed.ok) return { errors: parsed.errors };
  if (!imagesOk(parsed.input))
    return { errors: ["Pictures must be uploaded through the form."] };

  let saved: string;
  if (id) {
    const row = await updateQuest(id, parsed.input);
    if (!row) return { errors: ["That quest no longer exists."] };
    saved = row.id;
  } else {
    saved = (await createQuest(parsed.input)).id;
  }
  revalidatePath(TOOL, "layout");
  revalidatePath("/backstage/megagame", "layout");
  redirect(`${TOOL}/${saved}?saved=1`);
}

export type ToggleState = { error?: string };

/** Withdraws or restores a quest from the list. */
export async function setQuestActive(
  _prev: ToggleState,
  formData: FormData,
): Promise<ToggleState> {
  if (!(await requireAccess("megagame.manage"))) return { error: EXPIRED };
  const id = str(formData, "id");
  if (!isUuid(id)) return { error: "Reload." };
  const row = await getQuest(id);
  if (!row) return { error: "Gone." };
  await updateQuest(id, {
    ...questInputOf(row),
    active: str(formData, "active") === "1",
  });
  revalidatePath(TOOL, "layout");
  revalidatePath("/backstage/megagame", "layout");
  return {};
}

export type DeleteState = { error?: string };

/** Deletes a quest nobody has progress on; otherwise says to withdraw it instead. */
export async function deleteQuest(
  _prev: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  if (!(await requireAccess("megagame.manage"))) return { error: EXPIRED };
  const id = str(formData, "id");
  if (!isUuid(id)) return { error: "This form is out of date. Reload." };
  const result = await removeQuest(id);
  if (result === "has-progress")
    return {
      error:
        "Players have progress on this quest, so it stays as history. Untick Active to withdraw it instead.",
    };
  revalidatePath(TOOL, "layout");
  revalidatePath("/backstage/megagame", "layout");
  redirect(`${TOOL}?deleted=1`);
}

export type ImportEntry = {
  /** Position in the bundle, for the report. */
  index: number;
  /** As parseQuestInput's raw shape, images already uploaded to Blob. */
  quest: Record<string, unknown>;
};

export type ImportReport = {
  created: { index: number; title: string; id: string; code: string }[];
  skipped: { index: number; title: string; reason: string }[];
  errors: { index: number; title: string; error: string }[];
};

/**
 * Saves the quests of a bundle whose pictures the browser already uploaded.
 * Each entry is checked again here; a bad one is reported and the rest are
 * still created, since the browser showed the dry run before calling this.
 */
export async function importQuests(
  entries: ImportEntry[],
  options: { skipDuplicates: boolean },
): Promise<ImportReport | { error: string }> {
  if (!(await requireAccess("megagame.manage"))) return { error: EXPIRED };
  if (!Array.isArray(entries) || entries.length > 500)
    return { error: "Bad import." };
  const report: ImportReport = { created: [], skipped: [], errors: [] };
  const existing = new Map(
    (await listQuests()).map((q) => [titleKey(q.title), q.code]),
  );
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const index = Number(entry?.index) || 0;
    const raw =
      entry?.quest && typeof entry.quest === "object" ? entry.quest : {};
    const title = typeof raw.title === "string" ? raw.title : "";
    const parsed = parseQuestInput(raw);
    if (!parsed.ok) {
      report.errors.push({ index, title, error: parsed.errors.join("; ") });
      continue;
    }
    if (!imagesOk(parsed.input)) {
      report.errors.push({ index, title, error: "pictures were not uploaded" });
      continue;
    }
    const key = titleKey(parsed.input.title);
    if (options.skipDuplicates) {
      const code = existing.get(key);
      if (code) {
        report.skipped.push({
          index,
          title,
          reason: `same title as quest ${code}`,
        });
        continue;
      }
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        report.skipped.push({
          index,
          title,
          reason: `same title as entry ${earlier}`,
        });
        continue;
      }
    }
    seen.set(key, index);
    try {
      const row = await createQuest(parsed.input);
      report.created.push({
        index,
        title: row.title,
        id: row.id,
        code: row.code,
      });
    } catch (err) {
      console.error("[quests] import failed", err);
      report.errors.push({ index, title, error: "could not be saved" });
    }
  }
  if (report.created.length > 0) {
    revalidatePath(TOOL, "layout");
    revalidatePath("/backstage/megagame", "layout");
  }
  return report;
}
