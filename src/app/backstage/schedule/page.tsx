import { connection } from "next/server";
import SignIn from "../SignIn";
import ScheduleTool from "./ScheduleTool";
import { toolAccess } from "@/lib/admin-auth";
import {
  loadAttendance,
  loadSchedule,
  loadViewerPlans,
} from "@/lib/schedule-store";

export default async function AdminSchedulePage(
  props: PageProps<"/backstage/schedule">,
) {
  // Per-request on every branch, or the sign-in branch gets baked in as
  // static at build time.
  await connection();

  const access = await toolAccess("schedule.manage");
  if (!access) return <SignIn next="/backstage/schedule" />;

  const { edit } = await props.searchParams;
  const [schedule, attendance, plans] = await Promise.all([
    loadSchedule(),
    loadAttendance(),
    loadViewerPlans(access.userId),
  ]);
  const viewer = { ...plans, userId: access.userId };
  // Mirrors the guard in actions.ts: sample data only against a local database.
  const canSeed = process.env.NODE_ENV === "development";
  return (
    <ScheduleTool
      {...schedule}
      attendance={attendance}
      viewer={viewer}
      canSeed={canSeed}
      initialEdit={typeof edit === "string" ? edit : null}
    />
  );
}
