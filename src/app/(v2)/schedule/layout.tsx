import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { parseView, VIEW_COOKIE } from "@/lib/schedule-view";
import ContentPage from "@/v2/components/ContentPage";
import LiveSchedule from "@/v2/components/schedule/LiveSchedule";
import ScheduleSkeleton from "@/v2/components/schedule/ScheduleSkeleton";
import { loadPageSnapshot } from "./data";

async function Schedule() {
  // Rendered per request: which rooms and plans show depends on the viewer,
  // and a build has no database to prerender from.
  await connection();
  const [snapshot, cookieStore] = await Promise.all([
    loadPageSnapshot(),
    cookies(),
  ]);
  return (
    <LiveSchedule
      initial={snapshot}
      initialView={parseView(cookieStore.get(VIEW_COOKIE)?.value)}
    />
  );
}

// The schedule stays mounted under /schedule/<slug>, whose page is just the
// session modal on top of it. The read is under Suspense because a layout
// that awaits holds up navigation with nothing on screen to show for it.
export default function ScheduleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ContentPage eyebrow="Nov 6–8 at Lighthaven" title="Schedule" wide>
        <Suspense fallback={<ScheduleSkeleton />}>
          <Schedule />
        </Suspense>
      </ContentPage>
      {children}
    </>
  );
}
