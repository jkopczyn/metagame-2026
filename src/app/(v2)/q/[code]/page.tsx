import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { questLinkTarget } from "@/lib/megagame-links";
import { normalizeMegagameCode } from "@/lib/megagame-rules";
import { formatTicketCode } from "@/lib/ticket-code-format";
import ContentPage from "@/v2/components/ContentPage";
import { Button } from "@/v2/components/ui/button";

export const metadata: Metadata = {
  title: "Quest code — Metagame 2026",
  robots: { index: false, follow: false },
};

export default async function QuestLinkPage(props: PageProps<"/q/[code]">) {
  await connection();
  const { code } = await props.params;
  const { players } = await props.searchParams;
  const target = await questLinkTarget(code, players);
  if (target) redirect(target);
  return (
    <ContentPage
      eyebrow="Megagame"
      title="This code is for the volunteers"
      intro={
        <>
          The QR code on a quest card is a shortcut for the volunteer desk, so
          they can check your answer faster. Scanning it yourself doesn’t do
          anything. When you’ve finished the quest, bring the card to a
          volunteer and give them its code,{" "}
          <span className="font-mono font-bold text-navy">
            {formatTicketCode(normalizeMegagameCode(code))}
          </span>
          .
        </>
      }
    >
      <Button asChild variant="navy">
        <Link href="/account">Back to your account</Link>
      </Button>
    </ContentPage>
  );
}
