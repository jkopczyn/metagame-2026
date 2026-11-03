import { teamAccess } from "@/lib/access";
import { accountsConfigured, currentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Whether a visitor is signed in (and who), and whether their account holds
 * a team-tool permission; lets the static site nav build its account menu.
 */
export async function GET() {
  const [session, access] = accountsConfigured()
    ? await Promise.all([currentSession().catch(() => null), teamAccess()])
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
