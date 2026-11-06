import {
  BabyIcon,
  BookOpenIcon,
  CalendarIcon,
  DatabaseIcon,
  DicesIcon,
  DollarSignIcon,
  KeyIcon,
  LinkIcon,
  type LucideIcon,
  MailIcon,
  MicIcon,
  QrCodeIcon,
  SignpostIcon,
  SwordsIcon,
  TicketIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import SignIn from "../SignIn";
import { teamAccess } from "@/lib/access";
import { toolAccess } from "@/lib/admin-auth";
import type { Permission } from "@/lib/permissions";

// `perm`: holding any one of them lists the tool.
const TOOLS: {
  href: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  perm: Permission | Permission[];
}[] = [
  {
    href: "/backstage/links",
    icon: LinkIcon,
    name: "Tracking links",
    blurb: "Short /go/ links with UTM attribution.",
    perm: "links.manage",
  },
  {
    href: "/backstage/emails",
    icon: MailIcon,
    name: "Emails",
    blurb:
      "The announcements and other emails we've sent, plus drafts in progress.",
    perm: "emails.view",
  },
  {
    href: "/backstage/promo",
    icon: DollarSignIcon,
    name: "Promo codes",
    blurb: "Mint comp and discount codes on Stripe or BTC.",
    perm: "promo.view",
  },
  {
    href: "/backstage/users",
    icon: UserIcon,
    name: "Users",
    blurb: "Accounts, their roles and permissions.",
    perm: "users.view",
  },
  {
    href: "/backstage/roles",
    icon: UsersIcon,
    name: "Roles",
    blurb: "Bundles of permissions to hand out, like Volunteer.",
    perm: "roles.manage",
  },
  {
    href: "/backstage/tickets",
    icon: TicketIcon,
    name: "Tickets",
    blurb: "Every ticket with its buyer, holder and attendee.",
    perm: "tickets.view",
  },
  {
    href: "/backstage/children",
    icon: BabyIcon,
    name: "Children",
    blurb:
      "Every registered child, with childcare sessions and parent contacts.",
    perm: "children.view",
  },
  {
    href: "/backstage/schedule",
    icon: CalendarIcon,
    name: "Schedule",
    blurb: "Rooms and sessions for the 2026 program, on a day-by-room grid.",
    perm: "schedule.manage",
  },
  {
    href: "/backstage/speaker-committee",
    icon: MicIcon,
    name: "Speaker committee",
    blurb: "Session proposals from grading through scheduling.",
    perm: "schedule.manage",
  },
  {
    href: "/backstage/megagame",
    icon: SwordsIcon,
    name: "Quest Board",
    blurb: "Confirm quest completions and record level-ups.",
    perm: "megagame.verify",
  },
  {
    href: "/backstage/budget",
    icon: WalletIcon,
    name: "Budget",
    blurb: "New Xero lines, categorized for review into the budget sheet.",
    perm: "budget.view",
  },
  {
    href: "/backstage/api-keys",
    icon: KeyIcon,
    name: "API keys",
    blurb:
      "Keys for scripts and Claude sessions to act as an account over HTTP.",
    perm: ["api_keys.self", "api_keys.manage"],
  },
  {
    href: "/backstage/api-docs",
    icon: BookOpenIcon,
    name: "API docs",
    blurb: "Every admin API endpoint, plus a guide to hand to an agent.",
    perm: "api_docs.view",
  },
  {
    href: "/backstage/schema",
    icon: DatabaseIcon,
    name: "Database schema",
    blurb: "ER diagram and column-by-column reference for the Postgres schema.",
    perm: "schema.view",
  },
  {
    href: "/backstage/dice-lab",
    icon: DicesIcon,
    name: "Dice lab",
    blurb:
      "Arrange the hero dice and export transparent PNG or SVG assets for print.",
    perm: "misc.dice_lab",
  },
  {
    href: "/backstage/qr",
    icon: QrCodeIcon,
    name: "QR codes",
    blurb: "Any link or text as a QR code in the poster styles, as SVG or PNG.",
    perm: "misc.qr",
  },
  {
    href: "/backstage/signs",
    icon: SignpostIcon,
    name: "Sign maker",
    blurb:
      "Print-ready event signs and banners, with drafts shared across the team.",
    perm: "misc.signs",
  },
];

export default async function AdminIndexPage() {
  await connection();

  const access = await toolAccess();
  if (!access) return <SignIn next="/backstage" />;

  const held = (await teamAccess())?.permissions ?? new Set<Permission>();
  const tools = TOOLS.filter((t) => [t.perm].flat().some((p) => held.has(p)));

  return (
    <>
      <h1 className="font-bebas mb-4 text-2xl tracking-wide text-navy">
        Tools
      </h1>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="group flex h-full gap-3 rounded-xl border border-line bg-white p-4 shadow-sm transition-colors hover:border-navy"
            >
              <t.icon
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-navy/70 group-hover:text-meeple"
              />
              <div>
                <span className="font-semibold text-navy group-hover:text-meeple">
                  {t.name}
                </span>
                <p className="text-sm text-ink/60">{t.blurb}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
