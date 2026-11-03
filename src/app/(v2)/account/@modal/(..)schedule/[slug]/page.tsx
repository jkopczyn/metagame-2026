import type { Metadata } from "next";
import RouteModal from "@/v2/components/RouteModal";
import SessionDetails, {
  sessionMetadata,
  SESSION_TITLE_ID,
} from "@/v2/components/schedule/SessionDetails";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return sessionMetadata((await params).slug);
}

export default async function SessionModal({ params }: Props) {
  return (
    <RouteModal labelledBy={SESSION_TITLE_ID}>
      <SessionDetails slug={(await params).slug} />
    </RouteModal>
  );
}
