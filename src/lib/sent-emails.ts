import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// The mailing-list emails saved as templates under emails/ (see its
// CLAUDE.md): the top level holds the ones we've sent, emails/drafts/ the
// ones still being written. Each `.html` is one email; a `.min.html` is the
// same email collapsed for pasting into EmailOctopus and a `.txt` is a
// plain-text copy. Read per request so a merged edit shows without a cache
// to bust.

export const EMAIL_STATUSES = ["sent", "draft"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

const EMAILS_DIR = path.join(process.cwd(), "emails");
export const EMAIL_DIRS: Record<EmailStatus, string> = {
  sent: EMAILS_DIR,
  draft: path.join(EMAILS_DIR, "drafts"),
};

export const EMAIL_VARIANTS = ["html", "min", "txt"] as const;
export type EmailVariant = (typeof EMAIL_VARIANTS)[number];

export type SavedEmail = {
  /** The file's base name, which is the URL segment. */
  slug: string;
  status: EmailStatus;
  /** The HTML's `<title>`, which is the nearest thing to the subject. */
  subject: string;
  bytes: number;
  variants: EmailVariant[];
};

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const isEmailSlug = (value: string): boolean => SLUG.test(value);
export const isEmailVariant = (value: unknown): value is EmailVariant =>
  (EMAIL_VARIANTS as readonly unknown[]).includes(value);

const FILE_NAME: Record<EmailVariant, (slug: string) => string> = {
  html: (slug) => `${slug}.html`,
  min: (slug) => `${slug}.min.html`,
  txt: (slug) => `${slug}.txt`,
};

/** Groups a directory listing into one entry per `.html`, with its variants. */
export function groupEmailFiles(
  names: readonly string[],
): { slug: string; variants: EmailVariant[] }[] {
  const set = new Set(names);
  return names
    .filter((n) => n.endsWith(".html") && !n.endsWith(".min.html"))
    .map((n) => n.slice(0, -".html".length))
    .filter(isEmailSlug)
    .sort()
    .map((slug) => ({
      slug,
      variants: EMAIL_VARIANTS.filter((v) => set.has(FILE_NAME[v](slug))),
    }));
}

/**
 * Both folders' listings as one catalog. A slug is a URL, so it must be
 * unique: a draft sharing its name with a sent email is dropped, since the
 * sent copy is the record and the draft should have been moved, not copied.
 */
export function catalogEmailFiles(
  listings: Record<EmailStatus, readonly string[]>,
): { slug: string; status: EmailStatus; variants: EmailVariant[] }[] {
  const seen = new Set<string>();
  return EMAIL_STATUSES.flatMap((status) =>
    groupEmailFiles(listings[status])
      .filter(({ slug }) => !seen.has(slug) && seen.add(slug))
      .map((entry) => ({ ...entry, status })),
  );
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** The `<title>` text, or the slug when the file has none. */
export function emailSubject(html: string, slug: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const text = m?.[1]
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1]?.toLowerCase() === "x"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : all;
      }
      return ENTITIES[code.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, " ")
    .trim();
  return text || slug;
}

// EmailOctopus fills these at send time; stand-ins keep the footer legible
// and the links inert in the preview.
const TAGS: Record<string, string> = {
  UnsubscribeURL: "#",
  RewardsURL: "#",
  SenderInfoLine: "Metagame · (sender address filled in by EmailOctopus)",
};

/** The template with its merge tags replaced, for rendering in the catalog. */
export const previewEmail = (source: string): string =>
  source.replace(/\{\{(\w+)\}\}/g, (all, tag: string) => TAGS[tag] ?? all);

const listDir = (dir: string) => readdir(dir).catch(() => [] as string[]);

export async function listEmails(): Promise<SavedEmail[]> {
  const [sent, draft] = await Promise.all([
    listDir(EMAIL_DIRS.sent),
    listDir(EMAIL_DIRS.draft),
  ]);
  return Promise.all(
    catalogEmailFiles({ sent, draft }).map(
      async ({ slug, status, variants }) => {
        const file = path.join(EMAIL_DIRS[status], FILE_NAME.html(slug));
        const [html, { size }] = await Promise.all([
          readFile(file, "utf8"),
          stat(file),
        ]);
        return {
          slug,
          status,
          subject: emailSubject(html, slug),
          bytes: size,
          variants,
        };
      },
    ),
  );
}

/**
 * One variant's source, or null when the slug or file doesn't exist. The
 * sent folder is tried first, matching the catalog's precedence.
 */
export async function readEmail(
  slug: string,
  variant: EmailVariant = "html",
): Promise<string | null> {
  if (!isEmailSlug(slug)) return null;
  for (const status of EMAIL_STATUSES) {
    const source = await readFile(
      path.join(EMAIL_DIRS[status], FILE_NAME[variant](slug)),
      "utf8",
    ).catch(() => null);
    if (source != null) return source;
  }
  return null;
}

export async function findEmail(slug: string): Promise<SavedEmail | null> {
  if (!isEmailSlug(slug)) return null;
  return (await listEmails()).find((e) => e.slug === slug) ?? null;
}
