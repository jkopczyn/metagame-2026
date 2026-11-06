import Link from "next/link";
import { connection } from "next/server";
import SignIn from "../../../../SignIn";
import { toolAccess } from "@/lib/admin-auth";

const EXAMPLE = `{
  "quests": [
    {
      "title": "Hoot & Seek",
      "body": "First paragraph.\\n\\nSecond paragraph.",
      "body_images": ["images/owl.png"],
      "requirements": { "min_people": 6, "levels": { "wizard": 4 } },
      "rewards": { "wizard": 2, "any": 1 },
      "solution": "The answer is AVIANNA.",
      "solution_images": ["images/owl-solution.jpg"],
      "hint": "Owls are nocturnal.",
      "submitted_by": "Tobias",
      "finalized": false
    }
  ]
}`;

const ROWS: [string, string][] = [
  ["title", "Required, up to 120 characters."],
  [
    "body",
    "The card's text. Plain text; blank lines separate paragraphs. Up to 6000 characters, though anything past ~1500 prints very small.",
  ],
  [
    "body_images",
    "0–3 image paths, relative to quests.json, printed in this order.",
  ],
  [
    "requirements.min_people",
    'Group size, default 1. requirements.levels may name one class with its minimum level, e.g. {"wizard": 4}; that becomes the quest\'s class and min level (and its card art). More than one class is an error here: a quest has one class.',
  ],
  [
    "class, minLevel, maxLevel",
    "This site's own fields; they win over requirements.levels when both are present.",
  ],
  [
    "rewards",
    "Stamps per class: wizard, pirate, alien, or any (the player picks the class). Missing means 0.",
  ],
  [
    "solution",
    "What the volunteer at the Quest Board checks for. Stored as the quest's evidence.",
  ],
  [
    "solution_images",
    "Image paths; the first becomes the evidence picture, the rest are dropped with a warning.",
  ],
  ["hint", "A nudge the volunteer may give players. Optional."],
  [
    "submitted_by (or author)",
    "Printed at the foot of the card as the quest's author. Optional.",
  ],
  [
    "finalized",
    "quest_panic's review flag. false imports the quest withdrawn (inactive) so someone looks it over before the board or Print all sees it; missing means active.",
  ],
  ["source, notes", "Ignored, like any other unknown field."],
];

export default async function BundleFormat() {
  await connection();
  if (!(await toolAccess("megagame.manage")))
    return <SignIn next="/backstage/quests/new/format" />;
  return (
    <article className="flex max-w-3xl flex-col gap-5 text-sm text-ink/80">
      <h1 className="font-bebas text-3xl tracking-wide text-navy">
        Quest bundle format
      </h1>
      <p>
        A bundle is a <code>.zip</code> with one <code>quests.json</code> and
        the pictures it refers to; <code>quests.json</code> may sit in a folder,
        and paths are relative to it. It is the format the quest_panic tool
        reads, so a bundle made for that works here, and a bare{" "}
        <code>quests.json</code> uploads on its own when nothing has pictures.
      </p>
      <pre className="overflow-x-auto rounded-xl border border-line bg-white p-4 text-xs">
        {EXAMPLE}
      </pre>
      <table className="text-left">
        <tbody className="divide-y divide-line">
          {ROWS.map(([field, meaning]) => (
            <tr key={field}>
              <th className="py-2 pr-4 align-top font-mono text-xs font-normal whitespace-nowrap text-navy">
                {field}
              </th>
              <td className="py-2">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Every quest gets a fresh six-character label code on import; do not send
        one. Pictures may be PNG, JPEG or WebP and are shrunk to 2400px. Entries
        with problems are listed and left out; the rest import. Duplicate titles
        (compared ignoring case and punctuation) are skipped unless you untick
        the box.
      </p>
      <p>
        <Link href="/backstage/quests/new" className="text-navy underline">
          Back to Add quests
        </Link>
      </p>
    </article>
  );
}
