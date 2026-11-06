import { connection } from "next/server";
import SignIn from "../../../SignIn";
import BundleImport from "../../BundleImport";
import QuestForm from "../../QuestForm";
import { toolAccess } from "@/lib/admin-auth";

export default async function NewQuests() {
  await connection();
  if (!(await toolAccess("megagame.manage")))
    return <SignIn next="/backstage/quests/new" />;
  return (
    <div className="grid gap-10 lg:grid-cols-[3fr_2fr] lg:items-start">
      <section className="flex flex-col gap-4">
        <h1 className="font-bebas text-3xl tracking-wide text-navy">
          Add a quest
        </h1>
        <QuestForm />
      </section>
      <section className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
        <h2 className="font-bebas text-2xl tracking-wide text-navy">
          Import a bundle
        </h2>
        <BundleImport />
      </section>
    </div>
  );
}
