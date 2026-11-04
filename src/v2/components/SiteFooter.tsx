import Link from "next/link";
import { FaDiscord, FaEnvelope, FaGithub } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import ContactLink from "./contact/ContactLink";
import ContributeLink from "./ContributeLink";
import { SOCIAL_LINKS } from "@/v2/lib/urls";
import { NAV_LINKS } from "./nav/links";

const CONTACT =
  "flex items-center gap-2.5 text-[15px] font-semibold text-navy hover:text-meeple";

export default function SiteFooter() {
  return (
    <footer className="border-t border-line py-8 text-ink/70">
      <div className="mx-auto max-w-[1180px] px-8 max-[760px]:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
            <ContactLink className={CONTACT}>
              <FaEnvelope aria-hidden />
              Contact us
            </ContactLink>
            <a
              href={SOCIAL_LINKS.DISCORD}
              target="_blank"
              rel="noopener noreferrer"
              className={CONTACT}
            >
              <FaDiscord aria-hidden />
              Discord
            </a>
            <a
              href={SOCIAL_LINKS.TWITTER}
              target="_blank"
              rel="noopener noreferrer"
              className={CONTACT}
            >
              <FaXTwitter aria-hidden />
              Twitter
            </a>
            <ContributeLink className={CONTACT}>
              <FaGithub aria-hidden />
              Contribute to this site
            </ContributeLink>
          </div>
          <div
            aria-label="Event details"
            className="flex items-center gap-x-3 gap-y-1 font-space-mono text-xs tracking-[0.08em] whitespace-nowrap text-ink/60 uppercase max-[420px]:flex-col max-[420px]:items-start"
          >
            <span>November 6&ndash;8, 2026</span>
            <span
              aria-hidden="true"
              className="h-1 w-1 rounded-full bg-brand-blue max-[420px]:hidden"
            />
            <span>Berkeley, California</span>
          </div>
        </div>

        {/* Same pages as the corner nav, in the same order. */}
        <nav aria-label="Footer navigation" className="mt-7">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            {NAV_LINKS.map(({ id, label, href }) => (
              <li key={id}>
                <Link href={href} className="hover:text-navy hover:underline">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className="mt-7 text-center text-[12.5px] text-ink/45">
          &copy; 2026 Metagame LLC{" · "}
          <Link href="/credits" className="underline hover:text-ink/70">
            Attributions
          </Link>
        </p>
      </div>
    </footer>
  );
}
