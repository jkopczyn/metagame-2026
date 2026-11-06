import type { Metadata } from "next";
import ToolLayout from "../ToolLayout";

export const metadata: Metadata = {
  title: "Check-in — Metagame",
  robots: { index: false, follow: false },
};

export default function CheckinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolLayout title="Check-in" href="/backstage/checkin">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">{children}</div>
    </ToolLayout>
  );
}
