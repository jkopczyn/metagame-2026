import ContactProvider from "@/v2/components/contact/ContactProvider";
import SiteFooter from "@/v2/components/SiteFooter";
import SiteShell from "@/v2/components/SiteShell";
import FirstSigninFlow from "@/v2/components/first-signin/FirstSigninFlow";
import SessionModalHost from "@/v2/components/schedule/SessionModalHost";
// The session modal's body arrives from a server action as a rendered tree,
// serialized against the client manifest of the page it was opened over. A
// client component is only in that manifest when a server component under
// the route imports it, so these keep the body's two in every route's.
import "@/v2/components/schedule/SessionPlans";
import "@/v2/components/schedule/SessionSignIn";
import HatToast from "@/v2/hat-trick/HatToast";

// Puzzle in progress, parked for the MVP: src/v2/stage/ holds a page-space
// physics layer (a die that rides the page and collides with its layout).
// Nothing imports it, so none of it ships. To bring it back, wrap this div in
// <Stage> with `sprites={<ScrollDie />}` — see the README's Stage section.
export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col bg-background font-[family-name:var(--font-inter)] leading-[1.55] text-ink">
      <ContactProvider>
        <SessionModalHost>
          <SiteShell>{children}</SiteShell>
          <SiteFooter />
        </SessionModalHost>
      </ContactProvider>
      <HatToast />
      <FirstSigninFlow />
    </div>
  );
}
