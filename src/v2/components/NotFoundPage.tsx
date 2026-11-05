import type { Metadata } from "next";
import Link from "next/link";
import ContentPage from "./ContentPage";
import { Button } from "./ui/button";

export const notFoundMetadata: Metadata = {
  title: "Page not found — Metagame 2026",
};

export default function NotFoundPage() {
  return (
    <ContentPage
      eyebrow="404"
      title="Page not found"
      intro="That link doesn’t lead anywhere on this site."
    >
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/">Home</Link>
        </Button>
        <Button asChild variant="navy">
          <Link href="/schedule">Schedule</Link>
        </Button>
      </div>
    </ContentPage>
  );
}
