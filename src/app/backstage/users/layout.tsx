import type { Metadata } from "next";
import ToolLayout from "../ToolLayout";

export const metadata: Metadata = {
  title: "Users — Metagame",
  robots: { index: false, follow: false },
};

export default function AdminUsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolLayout title="Users" href="/backstage/users" wide>
      {children}
    </ToolLayout>
  );
}
