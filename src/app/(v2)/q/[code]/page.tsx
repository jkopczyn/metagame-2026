import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { questLinkTarget } from "@/lib/megagame-links";

export const metadata: Metadata = {
  title: "Metagame 2026",
  robots: { index: false, follow: false },
};

export default async function QuestLinkPage(props: PageProps<"/q/[code]">) {
  await connection();
  const { code } = await props.params;
  const { players } = await props.searchParams;
  redirect(await questLinkTarget(code, players));
}
