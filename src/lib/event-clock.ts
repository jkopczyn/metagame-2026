import { pacificDayKey } from "@/lib/schedule";

/** A day pass stays on sale through the end of its own Pacific day. */
export function isDayPassOnSale(
  pass: { date: { ymd: string } },
  now = new Date(),
): boolean {
  return pass.date.ymd >= pacificDayKey(now.toISOString()).replaceAll("-", "");
}
