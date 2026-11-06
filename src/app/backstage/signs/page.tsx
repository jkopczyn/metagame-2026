import { connection } from "next/server";
import SignIn from "../SignIn";
import { toolAccess } from "@/lib/admin-auth";

// The sign maker is a self-contained canvas page (assets/signs), served by
// ./app/route.ts behind the same gate and framed here so it keeps the
// backstage header. Drafts go through ./api/route.ts.
export default async function SignsPage() {
  await connection();
  const access = await toolAccess("misc.signs");
  if (!access) return <SignIn next="/backstage/signs" />;
  return (
    <iframe
      src="/backstage/signs/app"
      title="Sign maker"
      className="w-full flex-1 border-0"
      style={{ height: "calc(100dvh - 3.5rem)" }}
    />
  );
}
