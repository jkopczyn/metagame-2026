"use client";

import type { CSSProperties } from "react";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { CircleUserRound, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { signOutInPlace } from "@/app/(v2)/account/actions";
import { notifyAccountChanged } from "./useAccountStatus";

const ITEM =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-base text-cream/85 outline-none select-none data-[highlighted]:bg-cream/10 data-[highlighted]:text-cream data-[disabled]:opacity-50 md:text-sm";

/**
 * The nav's Account entry for a signed-in visitor: a menu with the account
 * page, their public profile, Backstage for the team, and log out. Styled by
 * the caller like the links around it; the menu itself portals out, since the
 * nav clips its overflow.
 */
export default function AccountMenu({
  admin,
  userId,
  current,
  className,
  style,
  tabIndex,
  onPick,
}: {
  admin: boolean;
  userId: string | null;
  current: boolean;
  className: string;
  style?: CSSProperties;
  tabIndex?: number;
  /** After choosing an entry, e.g. to fold the mobile menu away. */
  onPick?: () => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={className}
          style={style}
          tabIndex={tabIndex}
          aria-current={current ? "page" : undefined}
        >
          Account
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-nav-menu=""
          align="start"
          sideOffset={6}
          className="z-50 min-w-44 rounded-lg border border-cream/15 bg-ink p-1 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        >
          <DropdownMenu.Item asChild>
            <Link href="/account" className={ITEM} onClick={onPick}>
              <CircleUserRound size={16} />
              Account
            </Link>
          </DropdownMenu.Item>
          {userId && (
            <DropdownMenu.Item asChild>
              <Link
                href={`/u/${encodeURIComponent(userId)}`}
                className={ITEM}
                onClick={onPick}
              >
                <UserRound size={16} />
                Profile
              </Link>
            </DropdownMenu.Item>
          )}
          {admin && (
            <DropdownMenu.Item asChild>
              <Link href="/backstage" className={ITEM} onClick={onPick}>
                <ShieldCheck size={16} />
                Backstage
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-cream/15" />
          <DropdownMenu.Item
            className={ITEM}
            disabled={pending}
            onSelect={(e) => {
              e.preventDefault();
              start(async () => {
                await signOutInPlace();
                // The nav only re-asks on a path change, so tell it; the
                // refresh re-renders whatever server content was personal.
                notifyAccountChanged();
                router.push("/");
                router.refresh();
              });
            }}
          >
            <LogOut size={16} />
            {pending ? "Logging out…" : "Log out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
