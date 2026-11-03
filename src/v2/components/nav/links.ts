import type { ComponentType } from "react";
import {
  Award,
  CalendarDays,
  CircleUserRound,
  HeartHandshake,
  History,
  LogIn,
  Mail,
  MapPin,
  MessageCircleQuestion,
  Puzzle,
  ShieldCheck,
  Ticket,
  UserRound,
  Users,
} from "lucide-react";
import RubberDuck from "../RubberDuck";
import Mg2Die from "./Mg2Die";
import PartyPopperRight from "./PartyPopperRight";

// The nav's pages, in order. Home is the logo itself (no link); the rest
// unfold from it. The active page's icon shows on the die's top face.
type IconProps = { size?: number; strokeWidth?: number; className?: string };
export type NavIcon = ComponentType<IconProps>;
export type NavLink = {
  id: string;
  label: string;
  href: string;
  icon: NavIcon;
};

export const NAV_LINKS: readonly NavLink[] = [
  { id: "home", label: "Home", href: "/", icon: Mg2Die },
  { id: "tickets", label: "Tickets", href: "/#tickets", icon: Ticket },
  {
    id: "schedule",
    label: "Schedule",
    href: "/#schedule",
    icon: CalendarDays,
  },
  { id: "last-year", label: "Last Year", href: "/last-year", icon: History },
  {
    id: "get-involved",
    label: "Get Involved",
    href: "/#get-involved",
    icon: HeartHandshake,
  },
  { id: "sponsor", label: "Sponsor", href: "/sponsor", icon: Award },
  { id: "childcare", label: "Childcare", href: "/childcare", icon: RubberDuck },
  { id: "team", label: "Team", href: "/team", icon: Users },
] as const;

// Appended for signed-in team members only.
export const ADMIN_LINK: NavLink = {
  id: "admin",
  label: "Backstage",
  href: "/backstage",
  icon: ShieldCheck,
};

// Always last: sign in when signed out, the account page once signed in.
export const LOGIN_LINK: NavLink = {
  id: "login",
  label: "Log in",
  href: "/login",
  icon: LogIn,
};
export const ACCOUNT_LINK: NavLink = {
  id: "account",
  label: "Account",
  href: "/account",
  icon: CircleUserRound,
};

// The one-pager's sections, in page order, keyed by their `id`. On "/" the
// die's top face follows scroll-spy through these; the ones that are also nav
// links (tickets, get-involved) share the link's icon and light the
// link up.
export const HOME_SECTIONS: readonly { id: string; icon: NavIcon }[] = [
  { id: "about", icon: Puzzle },
  { id: "speakers", icon: UserRound },
  { id: "schedule", icon: CalendarDays },
  { id: "get-involved", icon: HeartHandshake },
  { id: "venue", icon: MapPin },
  { id: "highlights", icon: PartyPopperRight },
  { id: "tickets", icon: Ticket },
  { id: "sponsors", icon: Award },
  { id: "faq", icon: MessageCircleQuestion },
  { id: "stay-in-the-loop", icon: Mail },
] as const;
