"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createLink, type CreateState } from "./actions";
import { retryable } from "@/lib/action-retry";
import {
  buttonClass,
  fieldClass,
  smallButtonClass,
  selectClass,
  selectStyle,
  useCopy,
} from "../ui";
import Combobox from "./Combobox";
import QrDownload from "./QrDownload";
import {
  defaultCampaign,
  GO_PREFIX,
  matchSitePage,
  normalizeSlug,
  OPEN_SELECTS,
  shortUrl,
  SITE_PAGES,
  sitePageUrl,
  suggestSlug,
  UTM_VALUE_MAX,
  type LinkOptions,
  type TrackingLink,
} from "@/lib/tracking-links";

const CUSTOM = "__custom__";

type Draft = {
  /** A SITE_PAGES path, or CUSTOM. */
  page: string;
  customDestination: string;
  source: string;
  medium: string;
  campaign: string;
  placement: string;
  slug: string;
  internalName: string;
  /** Short name and label follow placement/source until the user edits them. */
  slugDirty: boolean;
  labelDirty: boolean;
};

const emptyDraft = (options: LinkOptions): Draft => ({
  page: SITE_PAGES[0].path,
  customDestination: "",
  source: "",
  medium: "",
  campaign: defaultCampaign(options),
  placement: "",
  slug: "",
  internalName: "",
  slugDirty: false,
  labelDirty: false,
});

const fromTemplate = (
  link: TrackingLink,
  prev: Draft,
  origin: string,
): Draft => {
  const page = matchSitePage(link.destination, origin);
  return {
    ...prev,
    page: page ?? CUSTOM,
    customDestination: page ? "" : link.destination,
    source: link.source,
    medium: link.medium,
    campaign: link.campaign,
    placement: link.placement,
  };
};

const autoLabel = (draft: Draft) =>
  [draft.placement, draft.source]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" · ");

const initial: CreateState = {};

export default function LinksTool({
  links: initialLinks,
  options,
  origin,
  me,
}: {
  links: TrackingLink[];
  options: LinkOptions;
  origin: string;
  me: string;
}) {
  const [state, action, pending] = useActionState(
    retryable(createLink),
    initial,
  );
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(options));
  const [links, setLinks] = useState(initialLinks);
  const formRef = useRef<HTMLFormElement>(null);
  const lastCreated = useRef<string | null>(null);

  // A fresh create lands in the existing list immediately and resets the form; the
  // server's revalidated list catches up on the next navigation.
  useEffect(() => {
    const created = state.created?.link;
    if (!created || created.id === lastCreated.current) return;
    lastCreated.current = created.id;
    setLinks((prev) => [created, ...prev.filter((l) => l.id !== created.id)]);
    setDraft((prev) => ({
      ...prev,
      placement: "",
      slug: "",
      internalName: "",
      slugDirty: false,
      labelDirty: false,
    }));
  }, [state.created]);

  const set =
    (key: keyof Draft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((prev) => ({ ...prev, [key]: e.target.value }));
  const setValue = (key: keyof Draft) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const applyTemplate = (link: TrackingLink) => {
    setDraft((prev) => fromTemplate(link, prev, origin));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const templates = links.filter((l) => l.template);
  const err = (field: string) =>
    state.field === field ? (state.error ?? null) : null;
  const destination =
    draft.page === CUSTOM
      ? draft.customDestination
      : sitePageUrl(origin, draft.page);

  const taken = useMemo(() => new Set(links.map((l) => l.slug)), [links]);
  const slug = draft.slugDirty
    ? draft.slug
    : suggestSlug(draft.placement, taken);
  const internalName = draft.labelDirty ? draft.internalName : autoLabel(draft);
  const previewSlug = normalizeSlug(slug);
  const placements = useMemo(() => {
    const seen = new Set(options.placement.map((p) => p.toLowerCase()));
    const extra = links
      .map((l) => l.placement)
      .filter((p) => p && !seen.has(p.toLowerCase()));
    return [...options.placement, ...new Set(extra)];
  }, [options.placement, links]);

  const combobox = (
    field: "source" | "medium" | "placement",
    label: string,
    choices: string[],
  ) => (
    <Combobox
      name={field}
      label={label}
      value={draft[field]}
      options={choices}
      open={OPEN_SELECTS.has(field)}
      required
      maxLength={UTM_VALUE_MAX}
      onChange={setValue(field)}
    />
  );

  return (
    <div className="space-y-10">
      <section
        ref={formRef}
        className="rounded-xl border border-line bg-white p-6 shadow-sm"
      >
        <h1 className="font-bebas mb-4 text-2xl tracking-wide text-navy">
          New link
        </h1>

        {templates.length > 0 && (
          <label className="mb-4 block text-sm">
            <span className="mb-1 block text-ink/70">
              Start from a template
            </span>
            <select
              className={selectClass}
              style={selectStyle}
              value=""
              onChange={(e) => {
                const t = templates.find((l) => l.id === e.target.value);
                if (t) applyTemplate(t);
              }}
            >
              <option value="">Pick one…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.internalName || t.slug}
                </option>
              ))}
            </select>
          </label>
        )}

        <form action={action} className="grid gap-4 md:grid-cols-2">
          <Field
            label="Destination"
            required
            hint={draft.page === CUSTOM ? undefined : destination}
            error={err("destination")}
            className="md:col-span-2"
          >
            <input type="hidden" name="destination" value={destination} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="Destination page"
                value={draft.page}
                onChange={set("page")}
                className={selectClass}
                style={selectStyle}
              >
                {SITE_PAGES.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.label} · {p.path}
                  </option>
                ))}
                <option value={CUSTOM}>Custom URL…</option>
              </select>
              {draft.page === CUSTOM && (
                <input
                  type="url"
                  required
                  autoFocus
                  placeholder={`${origin}/…`}
                  aria-label="Custom destination URL"
                  value={draft.customDestination}
                  onChange={set("customDestination")}
                  className={fieldClass}
                />
              )}
            </div>
          </Field>
          <Field
            label="Location"
            required
            hint="The exact place it's posted, e.g. Puzzle World, r/boardgames, Bay Area Puzzlers newsletter."
            error={err("placement")}
          >
            {combobox("placement", "Location", placements)}
          </Field>
          <Field
            label="Platform"
            required
            hint="Kind of channel, e.g. discord, email, dm, website."
            error={err("source")}
          >
            {combobox("source", "Platform", options.source)}
          </Field>
          <Field
            label="Medium"
            required
            hint="Kind of post, e.g. community post, newsletter, dm, physical poster."
            error={err("medium")}
          >
            {combobox("medium", "Medium", options.medium)}
          </Field>
          <input type="hidden" name="campaign" value={draft.campaign} />
          <Field
            label="Short name"
            required
            hint="The part after /go/, e.g. puzzle-world. Follows the location until you edit it."
            error={err("slug")}
          >
            <input
              name="slug"
              required
              value={slug}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  slug: e.target.value,
                  slugDirty: true,
                }))
              }
              className={fieldClass}
            />
            <p className="mt-1 truncate font-mono text-sm text-ink/60">
              {origin}
              {GO_PREFIX}
              <strong className="text-navy">{previewSlug || "[___]"}</strong>
            </p>
          </Field>
          <Field
            label="Label"
            hint="Name in our list, e.g. Puzzle World · discord. Follows location and platform until you edit it."
          >
            <input
              name="internalName"
              maxLength={120}
              value={internalName}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  internalName: e.target.value,
                  labelDirty: true,
                }))
              }
              className={fieldClass}
            />
          </Field>
          <div className="md:col-span-2">
            <button type="submit" disabled={pending} className={buttonClass}>
              {pending ? "Creating…" : "Create and copy link"}
            </button>
            <p aria-live="polite" className="min-h-5 text-sm text-meeple">
              {state.error && (!state.field || state.field === "campaign")
                ? state.error
                : null}
            </p>
          </div>
        </form>

        {state.created && (
          <Result
            key={state.created.link.id}
            url={state.created.shortUrl}
            link={state.created.link}
          />
        )}
      </section>

      <Library
        links={links}
        origin={origin}
        me={me}
        onUseTemplate={applyTemplate}
      />
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  required,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-ink/70">
        {label}
        {required && (
          <span aria-hidden className="text-meeple">
            {" "}
            *
          </span>
        )}
      </span>
      {children}
      <span
        aria-live="polite"
        className={`mt-1 block text-xs ${error ? "text-meeple" : "text-ink/50"}`}
      >
        {error ?? hint}
      </span>
    </label>
  );
}

function Result({ url, link }: { url: string; link: TrackingLink }) {
  const { status, copy } = useCopy();
  const attempted = useRef(false);
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void copy(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-6 flex flex-wrap items-start gap-4 rounded-lg border border-navy/30 bg-cream p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink/70">
          {status === "copied" ? "Copied to clipboard" : "Link created"}
          {status === "failed" && " — copying failed, select the URL below"}
        </p>
        <p className="my-2 font-mono text-lg break-all text-navy select-all">
          {url}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => copy(url)}
            className={smallButtonClass}
          >
            {status === "copied" ? "Copied" : "Copy"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={smallButtonClass}
          >
            Open
          </a>
        </div>
        <p className="mt-3 text-xs text-ink/60">
          → {link.destination} · {link.source} / {link.medium} / {link.campaign}
          {link.placement && ` / ${link.placement}`}
        </p>
      </div>
      <QrDownload url={url} slug={link.slug} />
    </div>
  );
}

function Library({
  links,
  origin,
  me,
  onUseTemplate,
}: {
  links: TrackingLink[];
  origin: string;
  me: string;
  onUseTemplate: (link: TrackingLink) => void;
}) {
  const [query, setQuery] = useState("");
  const [creator, setCreator] = useState(() =>
    links.some((l) => l.createdBy === me) ? me : "",
  );
  const creators = useMemo(
    () =>
      Array.from(new Set(links.map((l) => l.createdBy).filter(Boolean))).sort(),
    [links],
  );

  const q = query.trim().toLowerCase();
  const shown = links.filter(
    (l) =>
      (!creator || l.createdBy === creator) &&
      (!q ||
        [
          l.internalName,
          l.slug,
          l.destination,
          l.campaign,
          l.source,
          l.placement,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-bebas text-2xl tracking-wide text-navy">
          Existing{" "}
          <span className="text-base text-ink/50">({shown.length})</span>
        </h2>
        <div className="flex gap-2">
          <input
            type="search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${fieldClass} w-48`}
          />
          <select
            value={creator}
            onChange={(e) => setCreator(e.target.value)}
            className={selectClass}
            style={selectStyle}
          >
            <option value="">Everyone</option>
            {creators.map((c) => (
              <option key={c} value={c}>
                {c === me ? `${c} (me)` : c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-ink/60">
          {creator || q ? "No links match." : "No links yet."}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {shown.map((l) => (
            <Row
              key={l.id}
              link={l}
              origin={origin}
              onUseTemplate={onUseTemplate}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({
  link,
  origin,
  onUseTemplate,
}: {
  link: TrackingLink;
  origin: string;
  onUseTemplate: (link: TrackingLink) => void;
}) {
  const url = shortUrl(origin, link.slug);
  const { status, copy } = useCopy();
  const [showQr, setShowQr] = useState(false);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {link.internalName || link.slug}
          </span>
          {!link.active && <Tag>tracking off</Tag>}
          {link.template && <Tag>template</Tag>}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono break-all text-navy hover:underline"
        >
          {url}
        </a>
        <p className="text-xs break-all text-ink/60">→ {link.destination}</p>
        <p className="text-xs text-ink/60">
          {link.source} / {link.medium} / {link.campaign}
          {link.placement && ` / ${link.placement}`}
          {link.createdBy && ` · ${link.createdBy}`}
          {" · "}
          {new Date(link.createdAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex basis-full flex-wrap gap-2 sm:basis-auto">
        <button
          type="button"
          onClick={() => copy(url)}
          className={smallButtonClass}
        >
          {status === "copied"
            ? "Copied"
            : status === "failed"
              ? "Select URL"
              : "Copy"}
        </button>
        <button
          type="button"
          onClick={() => setShowQr((v) => !v)}
          aria-expanded={showQr}
          className={smallButtonClass}
        >
          {showQr ? "Hide QR" : "QR"}
        </button>
        <button
          type="button"
          onClick={() => onUseTemplate(link)}
          className={smallButtonClass}
        >
          Use as template
        </button>
      </div>
      {showQr && (
        <div className="basis-full">
          <QrDownload url={url} slug={link.slug} compact />
        </div>
      )}
    </li>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-navy/10 px-1.5 py-0.5 text-[11px] tracking-wide text-navy uppercase">
      {children}
    </span>
  );
}
