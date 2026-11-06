"use client";

import { useState, useTransition } from "react";
import { createUser, type CreateResult } from "./actions";
import type { RoleOption } from "./UsersTable";
import { fieldClass } from "../ui";
import { Button } from "@/v2/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";

export type Created = CreateResult & { name: string; email: string };

export default function NewUserDialog({
  open,
  onOpenChange,
  allRoles,
  canAssignRoles,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allRoles: RoleOption[];
  /** `users.edit`: the roles picker shows only for holders. */
  canAssignRoles: boolean;
  onDone: (result: Created) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [invite, setInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    setName("");
    setEmail("");
    setRoleIds([]);
    setInvite(false);
    setError(null);
    onOpenChange(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createUser({ name, email, roleIds, invite });
      if (result.error && !result.userId) {
        setError(result.error);
        return;
      }
      onDone({
        ...result,
        name: name.trim(),
        email: email.trim().toLowerCase(),
      });
      close();
    });
  };

  const inputClass = `${fieldClass} text-ink`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-w-[480px] flex-col gap-5 px-8 py-7">
        <DialogTitle className="font-bebas text-2xl tracking-wide text-cream">
          New user
        </DialogTitle>
        <DialogDescription className="text-base text-cream/80">
          Makes an unverified account they claim by signing in with an email
          code at /login.
        </DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="block text-sm text-cream/80">
            <span className="mb-1 block">Name</span>
            <input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-sm text-cream/80">
            <span className="mb-1 block">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              className={inputClass}
            />
          </label>
          {canAssignRoles && allRoles.length > 0 && (
            <fieldset className="text-sm text-cream/80">
              <legend className="mb-1">Roles</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {allRoles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={roleIds.includes(r.id)}
                      onChange={(e) => {
                        const on = e.currentTarget.checked;
                        setRoleIds((ids) =>
                          on ? [...ids, r.id] : ids.filter((id) => id !== r.id),
                        );
                      }}
                      className="size-4 accent-meeple"
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="flex items-start gap-2 text-sm text-cream/80">
            <input
              type="checkbox"
              checked={invite}
              onChange={(e) => setInvite(e.currentTarget.checked)}
              className="mt-0.5 size-4 accent-meeple"
            />
            <span>
              Send invite
              <span className="block text-xs text-cream/50">
                Emails them that an account exists and how to sign in.
              </span>
            </span>
          </label>
          {error && <p className="text-sm text-salmon">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Creating…" : "Create account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
