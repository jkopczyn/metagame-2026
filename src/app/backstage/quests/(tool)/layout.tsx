import type { Metadata } from "next";
import QuestTabs from "../QuestTabs";
import ToolLayout from "../../ToolLayout";

export const metadata: Metadata = {
  title: "Edit Quests — Metagame",
  robots: { index: false, follow: false },
};

export default function EditQuestsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolLayout
      title="Edit Quests"
      href="/backstage/quests"
      nav={<QuestTabs />}
      wide
    >
      {children}
    </ToolLayout>
  );
}
