"use client";

import Link from "next/link";
import { useState } from "react";
import { importQuests, type ImportReport } from "./actions";
import { uploadQuestImage } from "./ImagePicker";
import { smallButtonClass } from "../ui";
import {
  BundleError,
  parseBundle,
  parseManifest,
  readZip,
  type BundleEntry,
  type BundleProblem,
} from "@/lib/quest-bundle";
import { formatTicketCode } from "@/lib/ticket-code-format";

type Checked = {
  name: string;
  entries: BundleEntry[];
  problems: BundleProblem[];
  files: Map<string, Uint8Array>;
};

/**
 * Imports a quest bundle (.zip of quests.json + images, or a bare
 * quests.json): the browser unzips and checks it, shows what would happen,
 * then uploads the pictures and asks the server to save the quests.
 */
export default function BundleImport() {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  async function check(file: File | undefined) {
    setError(null);
    setReport(null);
    setChecked(null);
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      let files: Map<string, Uint8Array>;
      if (/\.json$/i.test(file.name)) {
        files = new Map([["quests.json", new Uint8Array(data)]]);
      } else {
        files = await readZip(data);
      }
      const parsed = /\.json$/i.test(file.name)
        ? parseManifest(
            JSON.parse(new TextDecoder().decode(files.get("quests.json")!)),
          )
        : parseBundle(files);
      setChecked({ name: file.name, files, ...parsed });
    } catch (err) {
      setError(
        err instanceof BundleError
          ? err.message
          : `Couldn't read ${file.name}: ${(err as Error).message}`,
      );
    }
  }

  async function run() {
    if (!checked) return;
    setError(null);
    setReport(null);
    try {
      const entries = [];
      let n = 0;
      const total = checked.entries.reduce(
        (sum, e) => sum + e.bodyImages.length + (e.evidenceImage ? 1 : 0),
        0,
      );
      for (const entry of checked.entries) {
        const uploadOne = async (path: string) => {
          const bytes = checked.files.get(path)!;
          const url = await uploadQuestImage(
            new File([bytes as BlobPart], path.split("/").at(-1) ?? "image"),
          );
          n++;
          setProgress(`Uploading pictures… ${n} of ${total}`);
          return url;
        };
        const bodyImages = [];
        for (const path of entry.bodyImages)
          bodyImages.push(await uploadOne(path));
        const evidenceImage = entry.evidenceImage
          ? await uploadOne(entry.evidenceImage)
          : null;
        entries.push({
          index: entry.index,
          quest: { ...entry.input, bodyImages, evidenceImage },
        });
      }
      setProgress("Saving quests…");
      const result = await importQuests(entries, { skipDuplicates });
      if ("error" in result) setError(result.error);
      else setReport(result);
    } catch (err) {
      setError((err as Error).message || "Import failed.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm text-ink/80">
      <p>
        A bundle is a <code>.zip</code> holding a <code>quests.json</code> and
        the pictures it names, in the quest_panic format; a bare{" "}
        <code>quests.json</code> works too when there are no pictures.{" "}
        <Link
          href="/backstage/quests/new/format"
          className="text-navy underline"
        >
          Format
        </Link>
        . Nothing is saved until you confirm the dry run below.
      </p>
      <input
        type="file"
        accept=".zip,.json,application/zip,application/json"
        disabled={progress !== null}
        onChange={(e) => void check(e.target.files?.[0])}
      />
      {error && (
        <p role="alert" className="text-meeple">
          {error}
        </p>
      )}
      {checked && !report && (
        <div className="flex flex-col gap-3">
          <p>
            <strong>{checked.name}</strong>: {checked.entries.length} quest
            {checked.entries.length === 1 ? "" : "s"} ready
            {checked.problems.length > 0 &&
              `, ${checked.problems.length} with problems (left out)`}
            .
          </p>
          {checked.problems.length > 0 && (
            <ul className="list-disc pl-5 text-meeple">
              {checked.problems.map((p) => (
                <li key={p.index}>
                  Entry {p.index}
                  {p.title && ` “${p.title}”`}: {p.error}
                </li>
              ))}
            </ul>
          )}
          {checked.entries.length > 0 && (
            <ul className="max-h-64 list-disc overflow-y-auto pl-5">
              {checked.entries.map((e) => (
                <li key={e.index}>
                  {e.title}
                  {e.input.class && ` · ${e.input.class}`}
                  {!e.input.active && " · imported withdrawn (draft)"}
                  {e.warnings.map((w) => (
                    <span key={w} className="block text-xs text-meeple">
                      {w}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
            />
            Skip entries whose title matches a quest that already exists
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={progress !== null || checked.entries.length === 0}
              className={smallButtonClass}
            >
              Import {checked.entries.length} quest
              {checked.entries.length === 1 ? "" : "s"}
            </button>
            {progress && <span>{progress}</span>}
          </div>
        </div>
      )}
      {report && (
        <div className="flex flex-col gap-2">
          <p className="font-medium text-navy">
            Imported {report.created.length}, skipped {report.skipped.length}
            {report.errors.length > 0 && `, ${report.errors.length} failed`}.
          </p>
          {report.created.length > 0 && (
            <ul className="list-disc pl-5">
              {report.created.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/backstage/quests/${c.id}`}
                    className="text-navy underline"
                  >
                    {c.title}
                  </Link>{" "}
                  <span className="font-mono text-ink/60">
                    {formatTicketCode(c.code)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {report.skipped.map((s) => (
            <p key={s.index} className="text-ink/60">
              Entry {s.index} “{s.title}”: {s.reason}
            </p>
          ))}
          {report.errors.map((e) => (
            <p key={e.index} className="text-meeple">
              Entry {e.index} “{e.title}”: {e.error}
            </p>
          ))}
          {report.created.length > 0 && (
            <Link
              href={`/backstage/quests/print?${new URLSearchParams(report.created.map((c) => ["id", c.id]))}`}
              target="_blank"
              className={`${smallButtonClass} self-start`}
            >
              Print the imported cards
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
