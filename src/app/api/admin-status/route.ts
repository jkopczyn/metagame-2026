import { teamAccess } from "@/lib/access";
import { accountsConfigured, currentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Whether a visitor is signed in (and who), and whether their account holds
 * a team-tool permission; lets the static site nav build its account menu.
 */
export async function GET() {
  const [session, access] = accountsConfigured()
    ? // A failed read stays a 500: the nav keeps its last answer for minutes, and
      // must not remember a signed-in visitor as signed out.
      await Promise.all([currentSession(), teamAccess()])
    : [null, null];
  return Response.json(
    {
      signedIn: Boolean(session),
      admin: Boolean(access?.team),
      userId: session?.user.id ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
