import NotFoundPage, { notFoundMetadata } from "@/v2/components/NotFoundPage";
import SiteLayout from "./(v2)/layout";

export const metadata = notFoundMetadata;

// Unmatched URLs and the routes outside (v2) render under the root layout
// alone, so this brings the site's own; (v2) has its own not-found inside it.
export default function NotFound() {
  return (
    <SiteLayout>
      <NotFoundPage />
    </SiteLayout>
  );
}
