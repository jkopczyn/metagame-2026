import { cookies } from "next/headers";
import { connection } from "next/server";
import { buildDays } from "@/lib/schedule";
import { parseView, VIEW_COOKIE } from "@/lib/schedule-view";
import ContentPage from "@/v2/components/ContentPage";
import { ModalHost } from "@/v2/components/RouteModal";
import PublicSchedule from "@/v2/components/schedule/PublicSchedule";
import { loadMySessionIds, loadPublicSchedule } from "./data";

// The schedule stays mounted under /schedule/<slug>, whose page is just the
// session modal on top of it.
export default async function ScheduleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Rendered per request: which rooms and plans show depends on the viewer,
  // and a build has no database to prerender from.
  await connection();
  const [{ locations, sessions }, mine, cookieStore] = await Promise.all([
    loadPublicSchedule(),
    loadMySessionIds(),
    cookies(),
  ]);
  return (
    <ModalHost closeHref="/schedule">
      <ContentPage eyebrow="Nov 6–8 at Lighthaven" title="Schedule" wide>
        <PublicSchedule
          days={buildDays(sessions)}
          locations={locations}
          mine={mine}
          initialView={parseView(cookieStore.get(VIEW_COOKIE)?.value)}
        />
      </ContentPage>
      {children}
    </ModalHost>
  );
}
