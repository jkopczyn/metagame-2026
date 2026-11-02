import { connection } from "next/server";
import SignIn from "../SignIn";
import DiceLabLoader from "./DiceLabLoader";
import { toolAccess } from "@/lib/admin-auth";

// Design tool: arrange (or roll) the hero dice on a transparent canvas and
// export them as PNG/SVG assets for shirts and print. Pure client-side; the
// gate is just so it isn't a public page.
export default async function DiceLabPage() {
  await connection();
  const access = await toolAccess("misc.dice_lab");
  if (!access) return <SignIn next="/backstage/dice-lab" />;
  return <DiceLabLoader />;
}
