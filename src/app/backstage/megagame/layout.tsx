import type { Metadata } from "next";
import ToolLayout from "../ToolLayout";

export const metadata: Metadata = {
  title: "Quest Board — Metagame",
  robots: { index: false, follow: false },
};

export default function QuestBoardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolLayout title="Quest Board" href="/backstage/megagame">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">{children}</div>
    </ToolLayout>
  );
}
