import type { Metadata } from "next";
import ToolLayout from "../ToolLayout";

export const metadata: Metadata = {
  title: "Hat Tricks — Metagame",
  robots: { index: false, follow: false },
};

export default function HatTricksToolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolLayout title="Hat Tricks" href="/backstage/hat-tricks">
      {children}
    </ToolLayout>
  );
}
