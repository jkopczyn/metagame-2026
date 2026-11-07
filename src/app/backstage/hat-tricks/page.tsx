import Link from "next/link";
import { connection } from "next/server";
import SignIn from "../SignIn";
import Section from "../megagame/Section";
import ScheduleEditor from "./ScheduleEditor";
import StealForm from "./StealForm";
import StealLog from "./StealLog";
import { toolAccess } from "@/lib/admin-auth";
import {
  draftFromSchedule,
  parseSchedule,
  stealableHats,
  type Schedule,
} from "@/lib/hat-tricks-schedule";
import { listStealLog, loadSchedule } from "@/lib/hat-tricks-store";

export default async function HatTricksToolPage() {
  await connection();
  const access = await toolAccess("megagame.verify");
  if (!access) return <SignIn next="/backstage/hat-tricks" />;

  const [{ raw, version }, steals] = await Promise.all([
    loadSchedule(),
    listStealLog(),
  ]);

  let schedule: Schedule = [];
  let unreadable = false;
  try {
    schedule = parseSchedule(raw);
  } catch (error) {
    console.error("hat_schedule:", error);
    unreadable = true;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <Section
        title="Record a steal"
        aside={
          <Link
            href="/hat-tricks"
            className="text-sm whitespace-nowrap text-ink/70 underline hover:text-navy"
          >
            Public page
          </Link>
        }
      >
        <StealForm onShift={[...stealableHats(schedule, new Date())]} />
      </Section>
      <Section title={`Steals (${steals.length})`}>
        <StealLog steals={steals} />
      </Section>
      <Section title="Shift schedule">
        {unreadable && (
          <p role="alert" className="text-sm text-meeple">
            The saved schedule can&apos;t be read, so the public page is
            treating it as empty. Saving here replaces it.
          </p>
        )}
        <ScheduleEditor
          initial={draftFromSchedule(schedule)}
          version={version}
        />
      </Section>
    </div>
  );
}
