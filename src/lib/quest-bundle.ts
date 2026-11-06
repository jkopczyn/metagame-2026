// A quest bundle: a .zip holding one quests.json and the images it refers
// to, in the format the quest_panic tool documents (docs/bundle-format.md
// there). Reading the zip and checking the manifest both happen in the
// browser, so nothing here touches the database or Next.

import { MEGAGAME_CLASSES, isMegagameClass } from "./megagame-levels";
import {
  MAX_BODY_IMAGES,
  parseQuestInput,
  type QuestInput,
} from "./megagame-quests";

export type BundleEntry = {
  index: number;
  title: string;
  /** Without its images; those are uploaded and filled in afterwards. */
  input: QuestInput;
  /** Paths inside the zip, resolved from quests.json's folder. */
  bodyImages: string[];
  evidenceImage: string | null;
  /** Non-fatal notes, such as a dropped second solution image. */
  warnings: string[];
};

export type BundleProblem = { index: number; title: string; error: string };

export type ParsedBundle = {
  entries: BundleEntry[];
  problems: BundleProblem[];
};

/** The zip's files by path, folders left out. */
export type ZipFiles = Map<string, Uint8Array>;

export class BundleError extends Error {}

const MAX_ENTRIES = 500;

/**
 * Finds quests.json in the zip (the shallowest one wins, as in quest_panic),
 * maps each entry onto a QuestInput and checks that every image it names is
 * in the zip. Entries with problems are listed, not imported.
 */
export function parseBundle(files: ZipFiles): ParsedBundle {
  const manifests = [...files.keys()].filter(
    (name) =>
      name.split("/").at(-1) === "quests.json" && !name.startsWith("__MACOSX/"),
  );
  if (manifests.length === 0)
    throw new BundleError("No quests.json found in the bundle.");
  const manifest = manifests.sort(
    (a, b) => a.split("/").length - b.split("/").length,
  )[0];
  const base = manifest.slice(0, manifest.lastIndexOf("/") + 1);

  let doc: unknown;
  try {
    doc = JSON.parse(
      new TextDecoder("utf-8").decode(files.get(manifest)!).replace(/^﻿/, ""),
    );
  } catch (err) {
    throw new BundleError(
      `${manifest} is not valid JSON: ${(err as Error).message}`,
    );
  }
  return parseManifest(doc, (ref) => {
    const path = resolve(base, ref);
    return path !== null && files.has(path) ? path : null;
  });
}

/**
 * The manifest alone, with `locate` saying where each image reference lives
 * (null when it is missing). Exported for tests and for a quests.json with
 * no images uploaded on its own.
 */
export function parseManifest(
  doc: unknown,
  locate: (ref: string) => string | null = () => null,
): ParsedBundle {
  const list = Array.isArray(doc)
    ? doc
    : doc &&
        typeof doc === "object" &&
        Array.isArray((doc as { quests?: unknown }).quests)
      ? (doc as { quests: unknown[] }).quests
      : null;
  if (list === null)
    throw new BundleError(
      'quests.json must be {"quests": [...]} or a JSON array.',
    );
  if (list.length > MAX_ENTRIES)
    throw new BundleError(`A bundle holds at most ${MAX_ENTRIES} quests.`);

  const entries: BundleEntry[] = [];
  const problems: BundleProblem[] = [];
  list.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push({ index, title: "", error: "entry: not an object" });
      return;
    }
    const q = raw as Record<string, unknown>;
    const title = typeof q.title === "string" ? q.title.trim() : "";
    const errors: string[] = [];
    const warnings: string[] = [];

    // quest_panic's requirements.levels is a minimum per class; this site's
    // quests have one class with a level window, so several classes don't fit.
    const req =
      q.requirements && typeof q.requirements === "object"
        ? (q.requirements as Record<string, unknown>)
        : {};
    const levels =
      req.levels && typeof req.levels === "object"
        ? Object.entries(req.levels as Record<string, unknown>).filter(
            ([, n]) => n != null && n !== 0 && n !== "",
          )
        : [];
    let cls: string | null = null;
    let minLevel: unknown = null;
    if (levels.length > 1) {
      errors.push(
        `requirements.levels: ${levels.length} classes listed; a quest here has one class (set class and minLevel instead)`,
      );
    } else if (levels.length === 1) {
      [cls, minLevel] = levels[0];
      if (!isMegagameClass(cls.toLowerCase()))
        errors.push(
          `requirements.levels: unknown class "${cls}"; expected ${MEGAGAME_CLASSES.join(", ")}`,
        );
    }
    // A plain class / minLevel / maxLevel, as this site's own export uses, wins.
    if (q.class != null && q.class !== "") cls = String(q.class);
    if (q.minLevel != null) minLevel = q.minLevel;

    const bodyRefs = listOf(
      q.body_images ?? q.bodyImages,
      "body_images",
      errors,
    );
    const solutionRefs = listOf(
      q.solution_images ??
        q.evidenceImages ??
        (q.evidenceImage ? [q.evidenceImage] : []),
      "solution_images",
      errors,
    );
    if (bodyRefs.length > MAX_BODY_IMAGES)
      errors.push(`body_images: at most ${MAX_BODY_IMAGES} images`);
    if (solutionRefs.length > 1)
      warnings.push(
        `solution_images: only the first of ${solutionRefs.length} is kept as the evidence image`,
      );

    const located = (ref: string) => locate(ref);
    const missing = [...bodyRefs, ...solutionRefs.slice(0, 1)].filter(
      (ref) => located(ref) === null,
    );
    if (missing.length > 0)
      errors.push(`image file(s) not in bundle: ${missing.join(", ")}`);

    const parsed = parseQuestInput({
      title: q.title,
      bodyText: q.body ?? q.bodyText,
      bodyImages: [],
      class: cls,
      minLevel,
      maxLevel: q.maxLevel,
      minPlayers: req.min_people ?? q.minPlayers,
      stamps: q.rewards ?? q.stamps,
      evidence: q.solution ?? q.evidence,
      evidenceImage: null,
      hint: q.hint,
      author: q.author ?? q.submitted_by,
      // quest_panic's drafts (finalized false) come in withdrawn, so a person
      // reviews them before the board or the printer sees them.
      active: q.active ?? (q.finalized == null ? true : q.finalized === true),
    });
    if (!parsed.ok) errors.push(...parsed.errors);
    if (errors.length > 0 || !parsed.ok) {
      problems.push({ index, title, error: errors.join("; ") });
      return;
    }
    entries.push({
      index,
      title: parsed.input.title,
      input: parsed.input,
      bodyImages: bodyRefs.map((ref) => located(ref)!),
      evidenceImage: solutionRefs[0] ? located(solutionRefs[0]) : null,
      warnings,
    });
  });
  return { entries, problems };
}

function listOf(v: unknown, field: string, errors: string[]): string[] {
  if (v == null) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    errors.push(`${field}: must be a list of paths`);
    return [];
  }
  return v;
}

/** A path relative to quests.json's folder, kept inside the zip. */
export function resolve(base: string, ref: string): string | null {
  const parts: string[] = [];
  for (const part of (base + ref.replace(/\\/g, "/")).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return ref.startsWith("/") ? null : parts.join("/");
}

/** Titles compared as quest_panic does, to skip re-imports. */
export const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ---- Reading the zip ----
//
// Enough of the zip format for a bundle: the central directory lists every
// file with its compression (stored or deflate) and where its local header
// sits; the browser's DecompressionStream inflates. No zip64, which only
// appears past 4 GB.

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_UNCOMPRESSED = 1024 * 1024 * 1024;

export async function readZip(data: ArrayBuffer): Promise<ZipFiles> {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  // The end-of-central-directory record sits at the very end, after an
  // optional comment of up to 64 KB.
  let eocd = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 0xffff);
    i--
  ) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new BundleError("The upload is not a .zip file.");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const files: ZipFiles = new Map();
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIG)
      throw new BundleError("The .zip file is damaged.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    total += size;
    if (total > MAX_UNCOMPRESSED)
      throw new BundleError("The bundle is larger than 1 GB uncompressed.");

    if (view.getUint32(localOffset, true) !== LOCAL_SIG)
      throw new BundleError("The .zip file is damaged.");
    const start =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(start, start + compressedSize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflate(raw));
    else throw new BundleError(`${name} uses an unsupported compression.`);
  }
  return files;
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
