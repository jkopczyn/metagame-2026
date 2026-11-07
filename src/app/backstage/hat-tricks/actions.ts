"use server";

import { revalidatePath } from "next/cache";
import { EXPIRED, requireAccess } from "@/lib/admin-auth";
import type { CheckinAccount } from "@/lib/checkin";
import { findCheckinAccounts } from "@/lib/checkin-store";
import { hatById, isHatId } from "@/lib/hat-tricks-hats";
import {
  draftToJson,
  parseSchedule,
  ScheduleParseError,
  stealableHats,
  type ScheduleDraft,
} from "@/lib/hat-tricks-schedule";
import {
  deleteSteal,
  eligibleThiefName,
  loadSchedule,
  recordSteal,
  saveSchedule,
} from "@/lib/hat-tricks-store";
import { fromPacificWall } from "@/lib/schedule";

const manage = () => requireAccess("megagame.verify");

const refresh = () => revalidatePath("/backstage/hat-tricks");

const str = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim();

// A little slack for a phone whose clock runs ahead of the server's.
const FUTURE_SLACK_MS = 60_000;

export type HatFormState = { error?: string; done?: string; warning?: string };

export async function findThieves(
  query: string,
): Promise<{ accounts?: CheckinAccount[]; error?: string }> {
  if (!(await manage())) return { error: EXPIRED };
  return { accounts: await findCheckinAccounts(query) };
}

export async function recordStealAction(
  _prev: HatFormState,
  formData: FormData,
): Promise<HatFormState> {
  const access = await manage();
  if (!access) return { error: EXPIRED };

  const hatId = str(formData, "hatId");
  if (!isHatId(hatId)) return { error: "Pick which hat was stolen." };
  const userId = str(formData, "userId");
  if (!userId) return { error: "Pick who stole it." };

  const wall = str(formData, "stolenAt");
  const now = new Date();
  const stolenAt = wall ? fromPacificWall(wall) : now;
  if (!stolenAt) return { error: "That time isn't valid." };
  if (stolenAt.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    return { error: "That time is in the future." };
  }

  const thief = await eligibleThiefName(userId);
  if (!thief) return { error: "That account can't be used. Search again." };

  await recordSteal({ hatId, userId, stolenAt }, access.userId);
  refresh();

  const hat = hatById(hatId).name;
  const result: HatFormState = { done: `${thief} stole the ${hat}.` };
  try {
    const { raw } = await loadSchedule();
    if (!stealableHats(parseSchedule(raw), stolenAt).includes(hatId)) {
      result.warning = `The ${hat} wasn't on shift at that time. Delete this steal if that's a mistake.`;
    }
  } catch (error) {
    console.error("hat_schedule:", error);
  }
  return result;
}

export async function deleteStealAction(
  _prev: HatFormState,
  formData: FormData,
): Promise<HatFormState> {
  if (!(await manage())) return { error: EXPIRED };
  const id = str(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "That steal is gone." };
  await deleteSteal(id);
  refresh();
  return { done: "Deleted" };
}

export async function saveScheduleAction(
  _prev: HatFormState,
  formData: FormData,
): Promise<HatFormState> {
  const access = await manage();
  if (!access) return { error: EXPIRED };

  let json: string;
  try {
    json = draftToJson(JSON.parse(str(formData, "draft")) as ScheduleDraft);
  } catch (error) {
    if (error instanceof ScheduleParseError) {
      const text = error.message;
      return { error: text[0].toUpperCase() + text.slice(1) };
    }
    return { error: "That schedule couldn't be read. Reload and try again." };
  }

  const version = Number(str(formData, "version"));
  if (!(await saveSchedule(json, version, access.userId))) {
    return {
      error:
        "Someone else changed the schedule since you opened this page. Reload to see theirs, then make your change again.",
    };
  }
  refresh();
  return { done: "Schedule saved." };
}
