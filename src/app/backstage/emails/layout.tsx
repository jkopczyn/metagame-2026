import type { Metadata } from "next";
import ToolLayout from "../ToolLayout";

export const metadata: Metadata = {
  title: "Emails — Metagame",
  robots: { index: false, follow: false },
};

export default function BackstageEmailsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolLayout title="Emails" href="/backstage/emails">
      {children}
    </ToolLayout>
  );
}
