"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  PlusIcon,
  ShieldCheckIcon,
  TicketIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { removeUser, setBanned, setRole, type Result } from "./actions";
import { assignRole } from "./[id]/actions";
import NewUserDialog, { type Created } from "./NewUserDialog";
import { fieldClass, selectClass, selectStyle, smallButtonClass } from "../ui";
import { ticketBadge } from "@/lib/admin-tickets";
import { Button } from "@/v2/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";

export type RoleOption = { id: string; name: string };

export type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  admin: boolean;
  roles: RoleOption[];
  banned: boolean;
  joined: string;
  /** Full date and time, for hover. */
  joinedExact: string;
  /** Epoch ms, for sorting. */
  joinedAt: number;
  /** The viewer's own row has no buttons. */
  self: boolean;
  /** Tickets they've claimed. */
  tickets: number;
  /** Four-digit badge number on their claimed ticket, once the desk assigned one. */
  badge: string | null;
};

type SortKey = "name" | "email" | "tickets" | "joined" | "roles";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "tickets", label: "Ticket" },
  { key: "joined", label: "Joined" },
  { key: "roles", label: "Roles" },
];

/** Role names with Admin first, the text shown in the picker and searched. */
const roleText = (u: UserRow) =>
  [u.admin ? "Admin" : null, ...u.roles.map((r) => r.name)]
    .filter(Boolean)
    .join(", ");

const compare = (a: UserRow, b: UserRow, key: SortKey): number => {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "email":
      return a.email.localeCompare(b.email);
    case "tickets":
      return a.tickets - b.tickets;
    case "joined":
      return a.joinedAt - b.joinedAt;
    case "roles":
      return roleText(a).localeCompare(roleText(b));
  }
};

function TicketCell({
  id,
  count,
  badge,
}: {
  id: string;
  count: number;
  badge: string | null;
}) {
  const { has, label } = ticketBadge(count);
  return (
    <Link
      href={`/backstage/tickets?user=${encodeURIComponent(id)}`}
      title={has ? `${count} claimed` : "No claimed ticket"}
      className={`inline-flex items-center gap-1 hover:text-meeple ${has ? "text-navy" : "text-ink/25"}`}
    >
      <TicketIcon className="size-4" aria-label="Tickets" />
      {label && <span className="text-xs font-semibold">{label}</span>}
      {badge && <span className="font-mono text-xs">#{badge}</span>}
    </Link>
  );
}

function AdminShield() {
  return (
    <span title="Admin" className="inline-flex">
      <ShieldCheckIcon className="size-4 text-navy" aria-label="Admin" />
    </span>
  );
}

export default function UsersTable({
  rows,
  initialQuery,
  allRoles,
  viewerIsAdmin,
  viewerCanCreate,
  viewerCanEdit,
  viewerCanDelete,
}: {
  rows: UserRow[];
  initialQuery: string;
  /** Assignable roles; built-in ones attach themselves and aren't listed. */
  allRoles: RoleOption[];
  /** Only `user.role = 'admin'` accounts may change the admin role and bans. */
  viewerIsAdmin: boolean;
  /** `users.create`: the New user button. */
  viewerCanCreate: boolean;
  /** `users.edit`: assign and remove roles. */
  viewerCanEdit: boolean;
  /** `users.delete`; deleting an admin account still needs an admin. */
  viewerCanDelete: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  /** Rows with an action in flight; only those rows' controls lock. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [promoting, setPromoting] = useState<UserRow | null>(null);
  const [openRoles, setOpenRoles] = useState<string | null>(null);
  // An id, not a row: rows refresh after each action and the sheet must follow.
  const [openId, setOpenId] = useState<string | null>(null);
  const openUser = rows.find((u) => u.id === openId) ?? null;
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const [query, setQuery] = useState(initialQuery);
  /** "" = everyone, "admin", "none", or a role id. */
  const [roleFilter, setRoleFilter] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "joined", dir: "desc" });

  const shown = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (u: UserRow) => {
      if (roleFilter === "admin" && !u.admin) return false;
      if (roleFilter === "none" && (u.admin || u.roles.length > 0))
        return false;
      if (
        roleFilter &&
        roleFilter !== "admin" &&
        roleFilter !== "none" &&
        !u.roles.some((r) => r.id === roleFilter)
      )
        return false;
      if (terms.length === 0) return true;
      const hay = [
        u.name,
        u.email,
        roleText(u),
        u.joined,
        u.banned ? "banned" : "",
        u.emailVerified ? "" : "unverified",
        u.tickets > 0 ? "ticket" : "no ticket",
        u.badge ? `#${u.badge}` : "",
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    };
    const out = rows.filter(matches);
    out.sort((a, b) => {
      const c = compare(a, b, sort.key);
      return sort.dir === "asc" ? c : -c;
    });
    return out;
  }, [rows, query, roleFilter, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "joined" || key === "tickets" ? "desc" : "asc" },
    );

  const run = (userId: string, action: () => Promise<Result>) => {
    setBusy((b) => new Set(b).add(userId));
    startTransition(async () => {
      setError((await action()).error ?? null);
      setBusy((b) => {
        const next = new Set(b);
        next.delete(userId);
        return next;
      });
    });
  };

  const canPickRoles = viewerCanEdit || viewerIsAdmin;
  const filtered = query.trim() !== "" || roleFilter !== "";

  return (
    <div className="space-y-4">
      <div className="flex max-w-2xl flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search name, email, role…"
          aria-label="Search accounts"
          className={`${fieldClass} min-w-56 flex-1`}
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.currentTarget.value)}
          aria-label="Filter by role"
          className={selectClass}
          style={selectStyle}
        >
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          {allRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          <option value="none">No roles</option>
        </select>
        {viewerCanCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={`${smallButtonClass} inline-flex items-center gap-1`}
          >
            <PlusIcon className="size-3.5" />
            New user
          </button>
        )}
      </div>
      <p className="text-sm text-ink/60">
        {filtered
          ? `${shown.length} of ${rows.length} accounts`
          : `${rows.length} ${rows.length === 1 ? "account" : "accounts"}`}
        {error && <span className="ml-3 text-meeple">{error}</span>}
        {created && (
          <span className="ml-3">
            {created.existed
              ? `${created.email} already has an account`
              : `Created ${created.name}`}
            {created.userId && (
              <>
                {" · "}
                <Link
                  href={`/backstage/users/${created.userId}`}
                  className="text-navy hover:underline"
                >
                  view
                </Link>
              </>
            )}
            {created.error && (
              <span className="ml-2 text-meeple">{created.error}</span>
            )}
          </span>
        )}
      </p>
      {/* overflow-x-auto also clips vertically, which would cut off the roles
          menu when the list is only a row or two tall — so let the box
          overflow while a menu is open. */}
      <div
        className={`hidden rounded-xl border border-line bg-white shadow-sm md:block ${openRoles ? "overflow-visible" : "overflow-x-auto"}`}
      >
        <table className="w-full text-left text-sm">
          <thead className="text-xs tracking-wide text-ink/50 uppercase">
            <tr>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                const Arrow =
                  sort.dir === "asc" ? ChevronUpIcon : ChevronDownIcon;
                return (
                  <th
                    key={c.key}
                    className="px-4 py-2 font-medium"
                    aria-sort={
                      active
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 uppercase hover:text-navy ${active ? "text-navy" : ""}`}
                    >
                      {c.label}
                      {active && <Arrow className="size-3.5" />}
                    </button>
                  </th>
                );
              })}
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((u) => {
              const names = roleText(u);
              const pickable = canPickRoles && !u.self;
              const pending = busy.has(u.id);
              return (
                <tr key={u.id} className={u.banned ? "text-ink/50" : ""}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/backstage/users/${u.id}`}
                      className="text-navy underline-offset-2 hover:text-meeple hover:underline"
                    >
                      {u.name.trim() || "Unnamed"}
                    </Link>
                    {u.banned && (
                      <span className="ml-2">
                        <BannedTag />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {u.email}
                    {!u.emailVerified && (
                      <span className="ml-2 text-ink/40">unverified</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <TicketCell id={u.id} count={u.tickets} badge={u.badge} />
                  </td>
                  <td
                    className="px-4 py-2 whitespace-nowrap"
                    title={u.joinedExact}
                  >
                    {u.joined}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {pickable ? (
                        <span className="relative">
                          <button
                            type="button"
                            disabled={pending}
                            aria-haspopup="menu"
                            aria-expanded={openRoles === u.id}
                            onClick={() =>
                              setOpenRoles(openRoles === u.id ? null : u.id)
                            }
                            className={`${smallButtonClass} inline-flex items-center gap-1 ${names ? "" : "text-ink/50"}`}
                          >
                            {names || "No roles"}
                            <ChevronDownIcon className="size-3.5" />
                          </button>
                          {openRoles === u.id && (
                            <>
                              <button
                                type="button"
                                aria-label="Close"
                                onClick={() => setOpenRoles(null)}
                                className="fixed inset-0 z-10 cursor-default"
                              />
                              <div
                                role="menu"
                                className="absolute left-0 z-20 mt-1 min-w-48 rounded-lg border border-line bg-white p-2 text-left shadow-lg"
                              >
                                <RoleChecks
                                  u={u}
                                  pending={pending}
                                  allRoles={allRoles}
                                  viewerIsAdmin={viewerIsAdmin}
                                  viewerCanEdit={viewerCanEdit}
                                  onPromote={() => {
                                    setOpenRoles(null);
                                    setPromoting(u);
                                  }}
                                  run={run}
                                />
                              </div>
                            </>
                          )}
                        </span>
                      ) : (
                        <span className={names ? "" : "text-ink/50"}>
                          {names || "—"}
                        </span>
                      )}
                      {u.admin && <AdminShield />}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {!u.self && (viewerIsAdmin || viewerCanDelete) && (
                      <span className="inline-flex gap-2">
                        {viewerIsAdmin && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(u.id, () => setBanned(u.id, !u.banned))
                            }
                            className={smallButtonClass}
                          >
                            {u.banned ? "Unban" : "Ban"}
                          </button>
                        )}
                        {viewerCanDelete && (viewerIsAdmin || !u.admin) && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => setDeleting(u)}
                            className={`${smallButtonClass} hover:border-meeple hover:text-meeple`}
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink/50">
                  No accounts{filtered && " match"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line bg-white text-sm shadow-sm md:hidden">
        {shown.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => setOpenId(u.id)}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${u.banned ? "text-ink/50" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{u.name.trim() || "Unnamed"}</span>
                  {u.admin && <AdminShield />}
                  {u.banned && <BannedTag />}
                </span>
                <span className="block truncate font-mono text-xs text-ink/60">
                  {u.email}
                </span>
              </span>
              {u.tickets > 0 && (
                <TicketIcon
                  className="size-4 shrink-0 text-navy"
                  aria-label="Has a ticket"
                />
              )}
              <ChevronRightIcon
                className="size-4 shrink-0 text-ink/40"
                aria-hidden
              />
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-4 py-6 text-center text-ink/50">
            No accounts{filtered && " match"}.
          </li>
        )}
      </ul>
      <Dialog
        open={openUser !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
      >
        <DialogContent
          aria-describedby={undefined}
          className="flex max-w-[480px] flex-col gap-4 px-6 py-6"
        >
          {openUser && (
            <UserDetail
              u={openUser}
              pending={busy.has(openUser.id)}
              allRoles={allRoles}
              viewerIsAdmin={viewerIsAdmin}
              viewerCanEdit={viewerCanEdit}
              viewerCanDelete={viewerCanDelete}
              run={run}
              onPromote={() => {
                setOpenId(null);
                setPromoting(openUser);
              }}
              onDelete={() => {
                setOpenId(null);
                setDeleting(openUser);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <NewUserDialog
        open={creating}
        onOpenChange={setCreating}
        allRoles={allRoles}
        canAssignRoles={viewerCanEdit}
        onDone={(result) => {
          setError(null);
          setCreated(result);
        }}
      />
      <Dialog
        open={promoting !== null}
        onOpenChange={(o) => !o && setPromoting(null)}
      >
        <DialogContent className="flex max-w-[480px] flex-col gap-5 px-8 py-7">
          <DialogTitle className="font-bebas text-2xl tracking-wide text-cream">
            Make this person an admin?
          </DialogTitle>
          <DialogDescription className="text-base text-cream/80">
            <span className="font-semibold text-cream">{promoting?.email}</span>{" "}
            would hold every permission: grant and revoke admin, ban and delete
            accounts, and everything the roles cover. For anything less than all
            of it, give them a role instead.
          </DialogDescription>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPromoting(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={promoting !== null && busy.has(promoting.id)}
              onClick={() => {
                if (!promoting) return;
                const { id } = promoting;
                setPromoting(null);
                run(id, () => setRole(id, "admin"));
              }}
            >
              Make admin
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <DialogContent className="flex max-w-[480px] flex-col gap-5 px-8 py-7">
          <DialogTitle className="font-bebas text-2xl tracking-wide text-cream">
            Delete this account?
          </DialogTitle>
          <DialogDescription className="text-base text-cream/80">
            This{" "}
            <span className="font-bold text-salmon underline">
              permanently deletes
            </span>{" "}
            <span className="font-semibold text-cream">{deleting?.email}</span>.
            This is irreversible. To keep the account but lock them out, use Ban
            instead.
          </DialogDescription>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={deleting !== null && busy.has(deleting.id)}
              onClick={() => {
                if (!deleting) return;
                const { id } = deleting;
                setDeleting(null);
                run(id, () => removeUser(id));
              }}
            >
              Delete account
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BannedTag() {
  return (
    <span className="rounded bg-meeple/10 px-1.5 py-0.5 text-xs font-semibold text-meeple">
      Banned
    </span>
  );
}

type RoleProps = {
  u: UserRow;
  pending: boolean;
  allRoles: RoleOption[];
  viewerIsAdmin: boolean;
  viewerCanEdit: boolean;
  onPromote: () => void;
  run: (userId: string, action: () => Promise<Result>) => void;
};

/** Admin + role checkboxes; `dark` restyles them for the navy sheet. */
function RoleChecks({
  u,
  pending,
  allRoles,
  viewerIsAdmin,
  viewerCanEdit,
  onPromote,
  run,
  dark,
}: RoleProps & { dark?: boolean }) {
  const row = `flex items-center gap-2 rounded px-2 py-1 ${dark ? "hover:bg-cream/10" : "hover:bg-cream"}`;
  const muted = dark ? "text-cream/50" : "text-ink/50";
  return (
    <>
      {viewerIsAdmin && (
        <label className={row}>
          <input
            type="checkbox"
            checked={u.admin}
            disabled={pending}
            onChange={(e) => {
              if (e.currentTarget.checked) onPromote();
              else run(u.id, () => setRole(u.id, "user"));
            }}
            className="size-4 accent-meeple"
          />
          <span
            className={`font-semibold ${dark ? "text-cream" : "text-navy"}`}
          >
            Admin
          </span>
          <span className={`text-xs ${muted}`}>everything</span>
        </label>
      )}
      {allRoles.map((r) => (
        <label key={r.id} className={row}>
          <input
            type="checkbox"
            checked={u.roles.some((h) => h.id === r.id)}
            disabled={pending || !viewerCanEdit}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              run(u.id, () => assignRole(u.id, r.id, on));
            }}
            className="size-4 accent-meeple"
          />
          {r.name}
        </label>
      ))}
      {allRoles.length === 0 && (
        <p className={`px-2 py-1 text-xs ${muted}`}>
          No roles yet.{" "}
          <Link
            href="/backstage/roles"
            className={`hover:underline ${dark ? "text-cream" : "text-navy"}`}
          >
            Create one
          </Link>
          .
        </p>
      )}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-cream/50 uppercase">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

/** One account on a phone: what the table's columns and menus show, in a sheet. */
function UserDetail({
  u,
  pending,
  allRoles,
  viewerIsAdmin,
  viewerCanEdit,
  viewerCanDelete,
  run,
  onPromote,
  onDelete,
}: RoleProps & { viewerCanDelete: boolean; onDelete: () => void }) {
  const names = roleText(u);
  const pickable = (viewerCanEdit || viewerIsAdmin) && !u.self;
  const { has } = ticketBadge(u.tickets);
  return (
    <>
      <DialogTitle className="font-bebas pr-8 text-2xl tracking-wide text-cream">
        {u.name.trim() || "Unnamed"}
      </DialogTitle>
      {(u.admin || u.banned || !u.emailVerified) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {u.admin && (
            <span className="rounded bg-cream/15 px-1.5 py-0.5 font-semibold">
              Admin
            </span>
          )}
          {u.banned && <BannedTag />}
          {!u.emailVerified && (
            <span className="text-cream/50">unverified</span>
          )}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="col-span-2">
          <Field label="Email">
            <span className="font-mono text-xs break-all">{u.email}</span>
          </Field>
        </div>
        <Field label="Joined">
          <span title={u.joinedExact}>{u.joined}</span>
        </Field>
        <Field label="Tickets">
          {has ? (
            <Link
              href={`/backstage/tickets?user=${encodeURIComponent(u.id)}`}
              className="underline underline-offset-2 hover:text-salmon"
            >
              {u.tickets} claimed
            </Link>
          ) : (
            <span className="text-cream/40">None</span>
          )}
        </Field>
        <Field label="Badge">
          {u.badge ? (
            <span className="font-mono">#{u.badge}</span>
          ) : (
            <span className="text-cream/40">None</span>
          )}
        </Field>
        <div className="col-span-2">
          <Field label="Roles">
            {pickable ? (
              <div className="-mx-2 mt-1">
                <RoleChecks
                  dark
                  {...{
                    u,
                    pending,
                    allRoles,
                    viewerIsAdmin,
                    viewerCanEdit,
                    onPromote,
                    run,
                  }}
                />
              </div>
            ) : (
              <span className={names ? "" : "text-cream/40"}>
                {names || "—"}
              </span>
            )}
          </Field>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href={`/backstage/users/${u.id}`} className={smallButtonClass}>
          Profile
        </Link>
        {!u.self && viewerIsAdmin && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(u.id, () => setBanned(u.id, !u.banned))}
            className={smallButtonClass}
          >
            {u.banned ? "Unban" : "Ban"}
          </button>
        )}
        {!u.self && viewerCanDelete && (viewerIsAdmin || !u.admin) && (
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            className={`${smallButtonClass} hover:border-meeple hover:text-meeple`}
          >
            Delete
          </button>
        )}
      </div>
    </>
  );
}
