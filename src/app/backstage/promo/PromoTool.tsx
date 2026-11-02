"use client";

import { useState, useTransition } from "react";
import { FaStripeS } from "react-icons/fa";
import { listCodes, mint, setActive, type MintState } from "./actions";
import {
  buttonClass,
  fieldClass,
  selectClass,
  selectStyle,
  smallButtonClass,
  useCopy,
} from "../ui";
import { PURPOSES, type MintResult } from "@/lib/promo-codes";
import type { Coupon, StripeCode } from "@/lib/promo-codes-stripe";
import type { PromoMode } from "@/lib/stripe-promo";

// New codes start at $80 off, not a free ticket.
const DEFAULT_AMOUNT_OFF = 80;

const CUSTOM = "__custom__";
// Coupons are made by hand in the dashboard (the key is Coupons: Read only).
const STRIPE_ACCOUNT = "acct_1QeQd1CtO443EG3n";

const codeUrl = (origin: string, path: "buy" | "ticket", code: string) =>
  `${origin.replace(/\/$/, "")}/${path}/${code}`;
const usable = (active: boolean, redeemed: number, max: number | null) =>
  active && (max == null || redeemed < max);

const initial: MintState = {};

export default function PromoTool({
  coupons,
  couponError,
  mode,
  origin,
  canMint,
  canArchive,
}: {
  coupons: Coupon[];
  couponError: string | null;
  mode: PromoMode;
  origin: string;
  canMint: boolean;
  canArchive: boolean;
}) {
  const [state, setState] = useState<MintState>(initial);
  const [pending, startTransition] = useTransition();
  const [purpose, setPurpose] = useState("");
  const [unlimited, setUnlimited] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [lists, setLists] = useState<StripeCode[] | null>(null);
  const [listsBusy, setListsBusy] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);

  const stripeReady = !couponError && coupons.length > 0;
  const defaultCoupon =
    coupons.find(
      (c) =>
        c.kind === "amount" &&
        c.amountOff === DEFAULT_AMOUNT_OFF &&
        c.currency === "usd",
    ) ??
    coupons.find((c) => c.isDefault) ??
    coupons[0];

  const err = (field: string) =>
    state.field === field ? (state.error ?? null) : null;

  const loadLists = async () => {
    setListsBusy(true);
    setListsError(null);
    try {
      setLists(await listCodes());
    } catch (e) {
      setListsError(e instanceof Error ? e.message : String(e));
    } finally {
      setListsBusy(false);
    }
  };

  // Plain submit handler rather than a form action so the post-mint cleanup
  // (reset the fields, refresh an open list) can live next to the result.
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const next = await mint(state, formData);
      setState(next);
      if (next.minted) {
        form.reset();
        setCustomCode("");
        if (lists) void loadLists();
      }
    });
  };

  return (
    <div className="space-y-10">
      {canMint && (
        <section className="relative rounded-xl border border-line bg-white p-6 shadow-sm">
          <ModeBadge mode={mode} />
          <h1 className="font-bebas mb-4 text-2xl tracking-wide text-navy">
            New code
          </h1>

          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <Field
              label="Coupon"
              required
              className="md:col-span-2"
              hint="The discount tier the code attaches to. Defaults to the 100%-off comp coupon."
              error={couponError}
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  name="couponId"
                  defaultValue={defaultCoupon?.id ?? ""}
                  disabled={!stripeReady}
                  className={`${selectClass} flex-1`}
                  style={selectStyle}
                >
                  {!stripeReady && (
                    <option value="">No coupons available</option>
                  )}
                  {(
                    [
                      ["amount", "Dollar amount off"],
                      ["percent", "Percent off"],
                    ] as const
                  ).map(([kind, title]) => {
                    const group = coupons.filter((c) => c.kind === kind);
                    return (
                      group.length > 0 && (
                        <optgroup key={kind} label={title}>
                          {group.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </optgroup>
                      )
                    );
                  })}
                </select>
                <a
                  href={`https://dashboard.stripe.com/${STRIPE_ACCOUNT}/${mode === "live" ? "" : "test/"}coupons`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${smallButtonClass} self-start py-2 whitespace-nowrap`}
                >
                  Create new coupon ↗
                </a>
              </div>
            </Field>

            <Field
              label="Name"
              required
              hint="Who this is for — a person, pseudonym, or group."
              error={err("name")}
            >
              <input
                name="name"
                required
                maxLength={120}
                className={fieldClass}
              />
            </Field>
            <Field
              label="Email"
              hint="Optional. The code is hashed from the email when given, otherwise from the name."
              error={err("email")}
            >
              <input
                name="email"
                type="email"
                autoComplete="off"
                className={fieldClass}
              />
            </Field>

            <Field
              label="Purpose"
              required
              hint="Recorded in the Purpose column of the “Discount Codes” table."
              error={err("purpose")}
              className="md:col-span-2"
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  name="purpose"
                  required
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className={`${selectClass} w-full sm:w-64`}
                  style={selectStyle}
                >
                  <option value="">Select…</option>
                  {PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value={CUSTOM}>Custom…</option>
                </select>
                {purpose === CUSTOM && (
                  <input
                    name="customPurpose"
                    required
                    autoFocus
                    placeholder="e.g. Contest winner"
                    maxLength={60}
                    className={fieldClass}
                  />
                )}
              </div>
              {purpose === CUSTOM && (
                <p className="mt-2 rounded-lg border border-tan bg-peach/40 px-3 py-2 text-xs text-ink/80">
                  A custom purpose becomes a <strong>permanent</strong> option
                  in Airtable, offered for every future code. Make sure it’s a
                  genuinely distinct category, not a variant of an existing one.
                </p>
              )}
            </Field>

            <Field
              label="Custom code"
              hint="Leave blank for a deterministic COMP-XXXXX code."
              error={err("customCode")}
            >
              <input
                name="customCode"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                className={`${fieldClass} font-mono`}
              />
            </Field>
            <Field
              label="Uses"
              hint={
                unlimited
                  ? "Redeemable unlimited times (no max_redemptions on the promo)."
                  : "How many times it can be redeemed. Default 1 (single guest); enforced by Stripe via max_redemptions."
              }
            >
              <div className="flex items-center gap-4">
                <input
                  name="uses"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={1}
                  disabled={unlimited}
                  className={`${fieldClass} w-28 disabled:bg-cream disabled:text-ink/40`}
                />
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    name="unlimited"
                    type="checkbox"
                    checked={unlimited}
                    onChange={(e) => setUnlimited(e.target.checked)}
                  />
                  Unlimited
                </label>
              </div>
            </Field>

            <Field label="Notes" className="md:col-span-2">
              <textarea
                name="notes"
                rows={2}
                maxLength={500}
                placeholder="Anything worth remembering about this code"
                className={`${fieldClass} resize-y`}
              />
            </Field>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={pending || !stripeReady}
                className={buttonClass}
              >
                {pending ? "Minting…" : "Generate code"}
              </button>
              <p aria-live="polite" className="min-h-5 text-sm text-meeple">
                {state.error && !state.field ? state.error : null}
              </p>
            </div>
          </form>

          {state.minted && (
            <Result
              key={state.minted.code}
              minted={state.minted}
              origin={origin}
            />
          )}
        </section>
      )}

      <Existing
        lists={lists}
        busy={listsBusy}
        error={listsError}
        origin={origin}
        canArchive={canArchive}
        onLoad={loadLists}
      />
    </div>
  );
}

function ModeBadge({ mode }: { mode: PromoMode }) {
  return (
    <span
      className={`absolute top-4 right-4 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase ${
        mode === "live"
          ? "border-moss/40 bg-moss/15 text-moss"
          : "border-tan bg-peach/50 text-ink/80"
      }`}
    >
      {mode === "live" ? "Live" : "Test mode"}
    </span>
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
    <div className={`min-w-0 text-sm ${className}`}>
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
    </div>
  );
}

function CopyButtons({
  code,
  origin,
  checkout,
}: {
  code: string;
  origin: string;
  checkout: boolean;
}) {
  const codeCopy = useCopy();
  const urlCopy = useCopy();
  const checkoutCopy = useCopy();
  const label = (status: string, idle: string) =>
    status === "copied" ? "Copied" : status === "failed" ? "Select it" : idle;
  return (
    <>
      <button
        type="button"
        onClick={() => codeCopy.copy(code)}
        className={smallButtonClass}
      >
        {label(codeCopy.status, "Copy code")}
      </button>
      <button
        type="button"
        onClick={() => urlCopy.copy(codeUrl(origin, "buy", code))}
        title="Lands on the home page with the code saved for checkout"
        className={smallButtonClass}
      >
        {label(urlCopy.status, "Copy link")}
      </button>
      {checkout && (
        <button
          type="button"
          onClick={() => checkoutCopy.copy(codeUrl(origin, "ticket", code))}
          title="Goes straight to Standard checkout with the code applied"
          className={`${smallButtonClass} inline-flex items-center gap-1.5`}
        >
          <FaStripeS aria-hidden className="text-[#635BFF]" />
          {label(checkoutCopy.status, "Copy checkout link")}
        </button>
      )}
    </>
  );
}

function Result({ minted, origin }: { minted: MintResult; origin: string }) {
  const { prior } = minted;
  const checkout = usable(minted.active, prior?.redeemed ?? 0, minted.max);
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        minted.reused ? "border-tan bg-peach/30" : "border-navy/30 bg-cream"
      }`}
    >
      {minted.reused ? (
        <div className="text-sm text-ink/80">
          <p className="font-semibold">
            Not a new code — this one was already issued
          </p>
          <p>
            to <strong>{prior?.name || "unnamed"}</strong> (
            {prior?.email || "no email"})
            {prior?.created
              ? ` on ${new Date(prior.created * 1000).toLocaleDateString()}`
              : ""}
            {prior?.purpose ? ` as ${prior.purpose}` : ""}
            {prior?.redeemed ? ` · already redeemed ${prior.redeemed}×` : ""}.
            Purpose/notes updated to what you just entered.
          </p>
          <p className="mt-1 text-xs text-ink/60">
            Different person with the same name? Add their email and generate
            again to get a distinct code.
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink/70">New code</p>
      )}
      <p className="my-2 font-mono text-2xl break-all text-navy select-all">
        {minted.code}
      </p>
      <p className="font-mono text-sm break-all text-ink/70 select-all">
        {codeUrl(origin, "buy", minted.code)}
      </p>
      {checkout && (
        <p className="font-mono text-sm break-all text-ink/70 select-all">
          {codeUrl(origin, "ticket", minted.code)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButtons code={minted.code} origin={origin} checkout={checkout} />
      </div>
      <p className="mt-3 text-xs text-ink/60">
        {minted.max == null
          ? "Redeemable unlimited times"
          : minted.max > 1
            ? `Redeemable up to ${minted.max} times`
            : "Single use"}
        {" · "}
        {minted.purpose}
      </p>
    </div>
  );
}

function Existing({
  lists,
  busy,
  error,
  origin,
  canArchive,
  onLoad,
}: {
  lists: StripeCode[] | null;
  busy: boolean;
  error: string | null;
  origin: string;
  canArchive: boolean;
  onLoad: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (c: {
    name: string;
    email: string;
    code: string;
    purpose: string;
  }) =>
    !q ||
    `${c.name} ${c.email} ${c.code} ${c.purpose}`.toLowerCase().includes(q);

  const toggle = async (c: StripeCode) => {
    const active = !c.active;
    if (
      !active &&
      !window.confirm(
        `Archive ${c.code}? It stops working (you can restore it later).`,
      )
    )
      return;
    setActing(c.id);
    setActionError(null);
    const res = await setActive(c.id, active);
    if (res.error) setActionError(res.error);
    else onLoad();
    setActing(null);
  };

  if (!lists) {
    return (
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-bebas text-2xl tracking-wide text-navy">
            Existing codes
          </h2>
          <button
            type="button"
            onClick={onLoad}
            disabled={busy}
            className={smallButtonClass}
          >
            {busy ? "Loading…" : "Load"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-meeple">{error}</p>}
      </section>
    );
  }

  const shown = lists.filter(matches);
  const active = shown.filter((c) => c.active);
  const archived = shown.filter((c) => !c.active);

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-bebas text-2xl tracking-wide text-navy">
          Existing codes
        </h2>
        <div className="flex w-full gap-2 sm:w-auto">
          <input
            type="search"
            placeholder="Filter by name, email, code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${fieldClass} min-w-0 flex-1 sm:w-56 sm:flex-none`}
          />
          <button
            type="button"
            onClick={onLoad}
            disabled={busy}
            className={smallButtonClass}
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      {(error || actionError) && (
        <p className="text-sm text-meeple">{error ?? actionError}</p>
      )}

      <div>
        {shown.length === 0 ? (
          <p className="text-sm text-ink/60">
            {lists.length ? "No matches." : "No codes yet."}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-line rounded-xl border border-line bg-white">
              {active.map((c) => (
                <StripeRow
                  key={c.id}
                  code={c}
                  origin={origin}
                  acting={acting === c.id}
                  onToggle={canArchive ? () => toggle(c) : undefined}
                />
              ))}
            </ul>
            {archived.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowArchived((s) => !s)}
                  aria-expanded={showArchived}
                  className="text-sm text-ink/60 underline-offset-2 hover:underline"
                >
                  {showArchived ? "Hide" : "Show"} archived ({archived.length})
                </button>
                {showArchived && (
                  <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-white opacity-70">
                    {archived.map((c) => (
                      <StripeRow
                        key={c.id}
                        code={c}
                        origin={origin}
                        acting={acting === c.id}
                        onToggle={canArchive ? () => toggle(c) : undefined}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StripeRow({
  code: c,
  origin,
  acting,
  onToggle,
}: {
  code: StripeCode;
  origin: string;
  acting: boolean;
  /** Absent for view-only users, who get no archive control. */
  onToggle?: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold">{c.code}</span>
          {c.coupon && <Tag>{c.coupon}</Tag>}
          {c.purpose && <Tag title={c.notes || undefined}>{c.purpose}</Tag>}
          {c.max != null && c.max > 1 ? (
            <Tag warn={c.redeemed > 0}>
              {c.redeemed}/{c.max} used
            </Tag>
          ) : c.max == null ? (
            <Tag>unlimited{c.redeemed ? ` · ${c.redeemed} used` : ""}</Tag>
          ) : (
            c.redeemed > 0 && <Tag warn>used</Tag>
          )}
        </div>
        <p className="truncate text-xs text-ink/60">
          {c.name ? `${c.name} · ` : ""}
          {c.email || "—"} · {new Date(c.created * 1000).toLocaleDateString()}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButtons
          code={c.code}
          origin={origin}
          checkout={usable(c.active, c.redeemed, c.max)}
        />
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            disabled={acting}
            className={smallButtonClass}
          >
            {c.active ? "Archive" : "Restore"}
          </button>
        )}
      </div>
    </li>
  );
}

function Tag({
  children,
  warn,
  title,
}: {
  children: React.ReactNode;
  warn?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`rounded px-1.5 py-0.5 text-[11px] tracking-wide uppercase ${
        warn ? "bg-peach/60 text-ink/80" : "bg-navy/10 text-navy"
      }`}
    >
      {children}
    </span>
  );
}
