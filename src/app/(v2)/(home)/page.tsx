import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import AnagramEmail from "@/v2/components/AnagramEmail";
import VolunteerFormLink from "@/v2/components/VolunteerFormLink";
import Carousel from "@/v2/components/Carousel";
import ContactLink from "@/v2/components/contact/ContactLink";
import CrypticsLightbox from "@/v2/components/CrypticsLightbox";
import BloodOnTheClocktowerDivider from "@/v2/components/dividers/blood-on-the-clocktower";
import CardSuitsDivider from "@/v2/components/dividers/card-suits";
import CastlingDivider from "@/v2/components/dividers/castling";
import CatanDivider from "@/v2/components/dividers/catan";
import DiceDivider from "@/v2/components/dividers/dice";
import GoDivider from "@/v2/components/dividers/go";
import MonopolyDivider from "@/v2/components/dividers/monopoly";
import ScrabbleDivider from "@/v2/components/dividers/scrabble";
import SetCardDivider from "@/v2/components/dividers/set-cards";
import SpaceInvadersDivider from "@/v2/components/dividers/space-invaders";
import TetrisDivider from "@/v2/components/dividers/tetris";
import FaqItem from "@/v2/components/FaqItem";
import Highlights2025 from "@/v2/components/Highlights2025";
import SectionHeading from "@/v2/components/SectionHeading";
import SignupForm from "@/v2/components/signup/SignupForm";
import SiteHero from "@/v2/components/SiteHero";
import SpeakerCard from "@/v2/components/SpeakerCard";
import PlayWeb from "@/v2/components/PlayWeb";
import PublicSchedule from "@/v2/components/schedule/PublicSchedule";
import {
  DISPLAY,
  EYEBROW,
  HEADING,
  SECTION,
  SECTION_ANCHOR,
} from "@/v2/components/styles";
import TicketsPanel from "@/v2/components/tickets/TicketsPanel";
import { Button } from "@/v2/components/ui/button";
import { PartifulLogo } from "@/v2/components/tickets/PartifulInvite";
import { CAROUSEL } from "@/v2/data/carousel";
import {
  GOLD_SPONSORS,
  PATRON_SPONSORS,
  SILVER_SPONSORS,
} from "@/v2/data/sponsors";
import { SPEAKERS } from "@/v2/data/speakers";
import SpeakerCtaCard from "@/v2/components/SpeakerCtaCard";
import {
  HOTELS_SEARCH_URL,
  HOUSING_URL,
  PODCAST_EPISODE_URL,
  LIGHTHAVEN_URL,
  MEGAGAME_PROPOSAL_FORM_URL,
  NIGHT_MARKET_FORM_URL,
  NIGHT_PARTIFUL_URL,
  RFP_FORM_URL,
  VOLUNTEER_FORM_PATH,
} from "@/v2/lib/links";
import HatImage from "@/v2/hat-trick/HatImage";
import { HATS } from "@/v2/hat-trick/hats";
import { SOCIAL_LINKS } from "@/v2/lib/urls";
import { EARLY_BIRD_DEADLINE, isEarlyBirdActive } from "@/lib/early-bird";
import { env } from "@/env";
import { buildDays, hostedSessions, publicSchedule } from "@/lib/schedule";
import { loadSchedule } from "@/lib/schedule-store";
import lighthavenCutout from "../../../../public/images/lighthaven_cutout.png";
import megagameChess from "../../../../public/images/megagame-chess.jpg";
import nightMarketCooks from "../../../../public/images/email/night_market_cooks.jpg";

// Re-render hourly so the early-bird gate flips at the deadline and the key
// dates' "Today" stop advances without a deploy.
// Ten minutes, so schedule edits reach the homepage soon; /schedule is live.
export const revalidate = 600;

export const metadata: Metadata = {
  title: "Metagame — Nov 6-8, 2026",
  description:
    "A convention of games, designs, and puzzles. Nov 6-8, 2026 at Lighthaven, Berkeley, California.",
};

const BODY_LINK = "font-semibold text-navy underline underline-offset-2";
const CONTAINER = "mx-auto max-w-[1180px] px-8";
const PROSE = "mt-3.5 text-base text-ink/70";

const FAQS: {
  id?: string;
  open?: boolean;
  question: string;
  answer: React.ReactNode;
}[] = [
  {
    id: "first-faq",
    question: "When is Metagame?",
    answer: (
      <>2:00pm Friday, November 6th through 9:00pm, November 8th, 2026.</>
    ),
  },
  {
    question: "Where is Metagame happening?",
    answer: (
      <>
        <a href={LIGHTHAVEN_URL} className={BODY_LINK}>
          Lighthaven{" "}
        </a>
        <br />
        2740 Telegraph Ave, Berkeley, CA 94705
        <Image
          src={lighthavenCutout}
          alt="Map of the Lighthaven campus"
          className="mt-4 h-auto w-full max-w-[560px]"
        />
      </>
    ),
  },
  {
    question: "Is lodging available?",
    answer: (
      <>
        On-site housing at Lighthaven is now available.{" "}
        <a
          href={HOUSING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={BODY_LINK}
        >
          Book a room here
        </a>
        . There are also plenty of{" "}
        <a
          href={HOTELS_SEARCH_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={BODY_LINK}
        >
          hotels available in and around Berkeley
        </a>
        .
      </>
    ),
  },
  {
    question: "Are meals included?",
    answer: (
      <>
        Snacks and beverages will be available for the taking. Food trucks will
        also be on-site with meals available for purchase.
      </>
    ),
  },
  {
    question: "Are tickets refundable?",
    answer: (
      <>
        You may request a ticket refund at the price you paid until 6PM Pacific
        on October 6th. After that, we will process on a case-by-case basis.
      </>
    ),
  },
  {
    question: "Can I transfer my ticket?",
    answer: (
      <>
        Yes, as long as your ticket wasn&apos;t a special personal comp.{" "}
        <ContactLink subject="Ticket transfer" className={BODY_LINK}>
          Contact us
        </ContactLink>{" "}
        if you&apos;d like to transfer your ticket to someone else.
      </>
    ),
  },
  {
    question: "Can I bring my kids?",
    answer: (
      <>
        Yes! Children under 13 get free admission, and we offer free childcare
        and children&apos;s programming for kids ages 5-12 during the day (we
        can&apos;t provide childcare for children under 5). See the{" "}
        <Link href="/childcare" className={BODY_LINK}>
          childcare page
        </Link>{" "}
        for more. If you have particular questions or concerns feel free to{" "}
        <ContactLink subject="Childcare" className={BODY_LINK}>
          reach out
        </ContactLink>
        .
      </>
    ),
  },
  {
    question: "Is parking available?",
    answer: (
      <>
        There is very limited street parking available by Lighthaven. Lighthaven
        requests that attendees avoid parking on the streets in the surrounding
        two blocks, as this may upset their neighbors.
      </>
    ),
  },
  {
    question: "May I bring or demonstrate my own game?",
    answer: (
      <>
        Please do! Fill out our proposal form{" "}
        <a
          href={RFP_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={BODY_LINK}
        >
          here
        </a>{" "}
        to run a game, event, or session.
      </>
    ),
  },
  {
    question: "Is the venue accessible?",
    answer: (
      <>
        Some parts of the campus are easier to navigate than others. If
        accessibility is an issue for you,{" "}
        <ContactLink subject="Accessibility" className={BODY_LINK}>
          reach out
        </ContactLink>{" "}
        so we can figure out how to make it work.
      </>
    ),
  },
  {
    question: "Who can I come to with problems?",
    answer: (
      <>
        For general questions or complaints,{" "}
        <ContactLink className={BODY_LINK}>contact the team</ContactLink>. If
        you have a sensitive issue to bring to our Community Health lead, you
        can contact Damon{" "}
        <ContactLink to="damon" toName="Damon" className={BODY_LINK}>
          here
        </ContactLink>
        .
      </>
    ),
  },
  {
    question: "Where can I learn more about Metagame?",
    answer: (
      <>
        <a
          href={SOCIAL_LINKS.DISCORD}
          target="_blank"
          rel="noopener noreferrer"
          className={BODY_LINK}
        >
          Join our Discord
        </a>{" "}
        to chat with the team and other attendees, or check out Ricki&apos;s
        conversation about Metagame 2025 on the{" "}
        <a
          href={PODCAST_EPISODE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={BODY_LINK}
        >
          Complex Systems podcast
        </a>
        .
      </>
    ),
  },
];

export default async function Home() {
  // Public rooms only and no per-viewer state, so the page stays static. CI
  // prerenders it with no database (Vercel builds have one), so the grid is
  // skipped rather than failing the build.
  const raw = env.DATABASE_URL ? await loadSchedule() : null;
  const schedule = raw && publicSchedule(raw, "public");
  // The sessions each speaker hosts, for the backs of their cards.
  const speaking = raw && schedule && hostedSessions(raw, schedule);
  const earlyBird = isEarlyBirdActive();
  return (
    <>
      {/* Section ids are deep-link anchors (/#faq); the nav links to pages. */}
      <div id="home" className={SECTION_ANCHOR}>
        <SiteHero />
      </div>

      {/* about */}
      <section id="about" className={`${SECTION} md:pt-11 md:pb-12`}>
        <div
          className={`${CONTAINER} grid items-center gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-12`}
        >
          <div className="max-w-[600px]">
            <h2
              className={`${DISPLAY} text-[clamp(64px,11vw,150px)] leading-[0.84] text-navy`}
            >
              Every kind
              <br />
              of play<span className="text-meeple">.</span>
            </h2>
            <p className={`${PROSE} mt-6`}>
              Metagame is a weekend conference devoted to games and the people
              who make and play them. We mean games in the broadest sense of the
              word: any experience meant to be played or actively experienced.
            </p>
          </div>
          <div className="mx-auto w-full max-w-[480px] lg:max-w-none">
            <PlayWeb />
          </div>
        </div>
      </section>

      <CastlingDivider />

      {/* speakers */}
      <section id="speakers" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <SectionHeading eyebrow="Who will be there?" title="Speakers" />
          {/* Wrapping flex, not a grid, so a short last row centers. */}
          <div className="mt-10 flex flex-wrap justify-center gap-2 sm:gap-5">
            {SPEAKERS.map((speaker) => (
              <div
                key={speaker.name}
                className="w-[calc(33.333%-0.3334rem)] sm:w-[calc(33.333%-0.8334rem)] lg:w-[calc(20%-1rem)]"
              >
                <SpeakerCard
                  {...speaker}
                  sessions={speaking?.get(speaker.userId)}
                />
              </div>
            ))}
            <div className="w-[calc(33.333%-0.3334rem)] sm:w-[calc(33.333%-0.8334rem)] lg:w-[calc(20%-1rem)]">
              <SpeakerCtaCard href={RFP_FORM_URL} />
            </div>
          </div>
          <p className="mt-8 text-center text-base text-ink/70">
            And many more coming soon&hellip;
          </p>
        </div>
      </section>

      <CardSuitsDivider />

      {/* schedule */}
      <section id="schedule" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <SectionHeading eyebrow="What’s on?" title="Schedule" />
          <p className={`${PROSE} max-w-[600px]`}>
            <Link
              href="/schedule"
              className="font-semibold text-navy underline"
            >
              Open the full schedule
            </Link>{" "}
            to RSVP and bookmark.
          </p>
        </div>
        {schedule && (
          <div className="mt-10 px-4 sm:px-8">
            <PublicSchedule
              days={buildDays(schedule.sessions)}
              locations={schedule.locations}
              mine={null}
            />
          </div>
        )}
      </section>

      <DiceDivider />

      {/* get involved */}
      <section id="get-involved" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <SectionHeading eyebrow="Want to do more?" title="Get Involved" />
          <p className={`${PROSE} max-w-[600px]`}>
            Metagame is made by the people who show up. Here&apos;s how to be
            one of them.
          </p>
          <div className="mt-10 grid gap-6 min-[900px]:grid-cols-3">
            {[
              {
                title: "Run something",
                body: (
                  <>
                    We want your games, puzzles, competitions, indie TTRPGs,
                    immersive theater performances, tournaments, design jams,
                    LARPs, trivia, crosswords, homemade meeples, chess variants,
                    turtle doves, social deception experiments not yet ready for
                    prime time, or things that defy all of these categories
                  </>
                ),
                cta: "Propose a session",
                href: RFP_FORM_URL,
                external: true,
              },
              {
                title: "Volunteer",
                body: (
                  <>
                    Help out before or during the con by joining one of the
                    volunteer teams:
                    <ul className="mt-2 list-disc pl-5 font-medium">
                      <li className="text-[#d16d8b]">Registration desk</li>
                      <li className="text-[#d98a54]">Room check</li>
                      <li className="text-[#c9a227]">Physical labor</li>
                      <li className="text-[#6faa6f]">Set design</li>
                      <li className="text-[#5ba8a0]">Marketing</li>
                      <li className="text-[#7a8fd4]">Speaker coordination</li>
                      <li className="text-[#a582c9]">Megagame design</li>
                      <li className="text-[#c76a6a]">&hellip; and more!</li>
                    </ul>
                  </>
                ),
                cta: "Apply to volunteer",
                href: VOLUNTEER_FORM_PATH,
                external: true,
              },
              {
                title: "Sponsor Metagame",
                body: (
                  <>
                    Put your name on the weekend. Sponsor benefits include:
                    <ul className="mt-2 list-disc pl-5">
                      <li>Logo placement on the site, swag, and marketing</li>
                      <li>A booth at the night market / career fair</li>
                      <li>Tickets for your team</li>
                      <li>Main-room talk and office-hours slots</li>
                      <li>A custom-built branded event</li>
                      <li>
                        &hellip; and at the headline tier, let&apos;s dream big
                      </li>
                    </ul>
                  </>
                ),
                cta: "Sponsor tiers",
                href: "/sponsor",
                external: false,
              },
            ].map(({ title, body, cta, href, external }) => (
              <div
                key={title}
                className="flex flex-col rounded-2xl border border-navy/[0.16] bg-white p-7 shadow-[0_8px_24px_rgba(23,48,89,0.08)]"
              >
                <h3 className={`${HEADING} text-2xl text-navy`}>{title}</h3>
                {/* div, not p: the volunteer body nests a <ul>. */}
                <div className="mt-3 flex-1 text-[15px] text-ink/70">
                  {body}
                </div>
                <Button asChild variant="default" className="mt-6 w-fit">
                  {href === VOLUNTEER_FORM_PATH ? (
                    <VolunteerFormLink>{cta}</VolunteerFormLink>
                  ) : external ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {cta}
                    </a>
                  ) : (
                    <Link href={href}>{cta}</Link>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SpaceInvadersDivider />

      {/* the megagame */}
      <section id="megagame" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
            <div className="max-w-[600px]">
              <SectionHeading
                eyebrow="Want to be a part of something bigger?"
                eyebrowClassName="text-lg"
                title="The Megagame"
              />
              <div className="mt-3.5 space-y-3 text-base text-ink/70">
                <p>
                  The game begins when you step through the gate, and runs all
                  weekend. One part puzzle hunt, one part game gauntlet, one
                  part interlocking story.
                </p>
                <p>
                  The Megagame is threaded through the rest of Metagame, with
                  many puzzles and games making up larger games and larger
                  puzzles. Anyone can play it, and anyone can help create it. We
                  want puzzles! We want games! We want cryptic hints added to
                  your session! More details in the proposal form.
                </p>
              </div>
              <Button asChild variant="default" className="mt-6 w-fit">
                <a
                  href={MEGAGAME_PROPOSAL_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Build part of the Megagame
                </a>
              </Button>
            </div>
            <figure className="w-full max-w-[560px]">
              <HatImage
                src={megagameChess}
                alt="Giant orange and blue chess pieces, a knight in front"
                hats={[HATS.bishop]}
                className="aspect-[4/3] w-full lg:[--fade:linear-gradient(to_right,transparent,black_30%)]"
                sizes="(min-width: 1024px) 560px, 100vw"
              />
              <figcaption className="mt-3 text-center text-sm text-ink/70 italic">
                A puzzle and game made of smaller puzzles and games. Made
                by&hellip; you?
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <TetrisDivider />

      {/* venue */}
      <section id="venue" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          {/* Single grid so the image top-aligns with the title on wide screens. */}
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
            <div className="max-w-[560px]">
              <SectionHeading
                eyebrow="Where is it?"
                title={
                  <a
                    href={LIGHTHAVEN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-meeple"
                  >
                    Lighthaven Campus
                  </a>
                }
              />
              <p className="mt-2 text-base text-ink/60">
                2740 Telegraph Ave, Berkeley, CA 94705
              </p>
              {/* Below lg the map floats inside the copy so the paragraphs
                  wrap it; at lg it moves to its own grid column instead. */}
              <a
                href={LIGHTHAVEN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="float-right -mt-2 -mr-6 -mb-2 ml-1 w-[52%] lg:hidden"
              >
                <Image
                  src={lighthavenCutout}
                  alt="Aerial view of the Lighthaven campus"
                  className="h-auto w-full"
                  sizes="45vw"
                />
              </a>
              <p className="mt-6 text-base text-ink/70">
                Lighthaven Campus is a puzzle-seeker&apos;s paradise, with
                easter eggs wedged into every nook and cranny and games mid-play
                concealed behind secret doors.
              </p>
              <p className={PROSE}>
                Onsite housing is available for the weekend, so you can roll out
                of bed and into a game at any moment. Rooms can be booked
                directly with Lighthaven.
              </p>
              <Button asChild variant="navy" className="clear-both mt-5">
                <a href={HOUSING_URL} target="_blank" rel="noopener noreferrer">
                  Book your room
                </a>
              </Button>
            </div>
            <a
              href={LIGHTHAVEN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden w-full max-w-[560px] transition-transform duration-300 hover:scale-[1.04] lg:block"
            >
              <Image
                src={lighthavenCutout}
                alt="Aerial view of the Lighthaven campus"
                className="h-auto w-full"
                sizes="(min-width: 1024px) 560px, 100vw"
              />
            </a>
          </div>
        </div>
      </section>

      <BloodOnTheClocktowerDivider />

      {/* night market */}
      <section id="night-market" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
            <div className="max-w-[600px]">
              <SectionHeading
                eyebrow="Got something to trade?"
                title="Night Market"
              />
              <p className={PROSE}>
                Show off your game, product, or latest creation at our open
                market, or come discover what others have brought to share.
                Explore booths offering things to play, experience, and savor.
                This is open to the public on Friday evening (7:00–10:00pm).
              </p>
              <p className={PROSE}>
                It&rsquo;s free &mdash; RSVP and invite your friends on
                Partiful. Have a game, product, or creation to share? Apply for
                a booth.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild variant="navy">
                  <a
                    href={NIGHT_MARKET_FORM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Apply for a booth
                  </a>
                </Button>
                <Button asChild variant="default" className="pl-3">
                  <a
                    href={NIGHT_PARTIFUL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <PartifulLogo />
                    RSVP
                  </a>
                </Button>
              </div>
            </div>
            <figure className="w-full max-w-[560px]">
              <Image
                src={nightMarketCooks}
                alt="“Too Many Cooks” at the Night Market"
                className="h-auto w-full rounded-2xl"
                sizes="(min-width: 1024px) 560px, 100vw"
              />
              <figcaption className="mt-3 text-center text-sm text-ink/70 italic">
                &ldquo;Too Many Cooks&rdquo; at the Night Market
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <GoDivider />

      {/* highlights from 2025 */}
      <section id="highlights" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <SectionHeading
            eyebrow="What happened last year?"
            title="Highlights from 2025"
          />
          <Highlights2025 />
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Button asChild variant="navy">
              <Link href="/last-year">See the full 2025 schedule</Link>
            </Button>
          </div>
        </div>
      </section>

      <ScrabbleDivider />

      {/* tickets */}
      <section id="tickets" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <SectionHeading eyebrow="Ready to play?" title="Tickets" />
          {earlyBird && (
            <p className={`${PROSE} mb-7 max-w-[600px]`}>
              Early-bird pricing ends {EARLY_BIRD_DEADLINE}.
            </p>
          )}
          {/* The panel renders bare toggle + tiles; the column/gap is ours. */}
          <div className="flex max-w-[700px] flex-col items-start gap-6">
            <TicketsPanel
              showHeading={false}
              align="start"
              earlyBird={earlyBird}
            />
          </div>
        </div>
      </section>

      {/* Bottom padding matches the next section's top, so the divider sits
          midway between the photo and the heading. */}
      <div className="pt-6 pb-8 md:pb-14">
        <Carousel images={CAROUSEL} />
      </div>

      <SetCardDivider />

      {/* sponsors */}
      <section id="sponsors" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <SectionHeading eyebrow="With gratitude" title="Our sponsors" />
          <div className="mt-10 flex flex-col items-center gap-10">
            {[
              {
                label: "Gold",
                sponsors: GOLD_SPONSORS,
                logo: "h-28 md:h-40",
                row: "flex flex-wrap justify-center gap-x-12 gap-y-6",
              },
              {
                label: "Silver",
                sponsors: SILVER_SPONSORS,
                logo: "h-16 md:h-24",
                row: "flex flex-wrap justify-center gap-x-12 gap-y-6",
                // Equal-width cells so the logos' centres, not their inner
                // edges, sit symmetric about the page centre: the wide Walrus
                // wordmark otherwise reads as pulled toward the middle.
                cell: "flex justify-center md:w-80",
              },
              {
                label: "Patron",
                sponsors: PATRON_SPONSORS,
                logo: "h-14 md:h-[72px]",
                // Two columns on phones; logos shrink to fit their column.
                row: "grid w-full grid-cols-2 justify-items-center gap-x-6 gap-y-8 md:flex md:flex-wrap md:justify-center md:gap-x-12 md:gap-y-6",
              },
            ].map(({ label, sponsors, logo, row, cell }) => (
              <div key={label} className="flex flex-col items-center gap-4">
                <p className={`${EYEBROW} text-sm text-ink/50`}>{label}</p>
                <div className={`items-center ${row}`}>
                  {sponsors.map((s) => {
                    const cls = `w-auto max-w-full object-contain ${s.logoClass ?? logo}`;
                    const img = s.Logo ? (
                      <s.Logo className={cls} />
                    ) : (
                      <Image
                        src={s.logo}
                        alt={`${s.name} logo`}
                        className={cls}
                      />
                    );
                    return s.url ? (
                      <a
                        key={s.name}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`transition-opacity hover:opacity-75 ${cell ?? ""}`}
                      >
                        {img}
                      </a>
                    ) : (
                      <span key={s.name} className={cell}>
                        {img}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-14 text-center">
            <h3 className="font-grotesk text-xl font-semibold text-navy">
              Interested in helping make Metagame 2026 happen?
            </h3>
            <Button asChild variant="navy" size="lg" className="mt-5 text-lg">
              <Link href="/sponsor">Sponsor Metagame</Link>
            </Button>
          </div>
        </div>
      </section>

      <CatanDivider />

      {/* faq */}
      <section id="faq" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <SectionHeading
            eyebrow="But what about…"
            title="FAQ"
            className="mb-12"
          />
          {/* Photo rides alongside the list on wide screens, sized so its 3:4
              height roughly matches the collapsed list; on phones it follows
              the list. */}
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
            {/* Contact line lives in the list column so it hugs the questions
                rather than dropping below the (taller) photo. */}
            <div>
              <div className="divide-y divide-line border-y border-line">
                {FAQS.map(({ id, open, question, answer }) => (
                  <FaqItem
                    key={question}
                    id={id}
                    defaultOpen={open}
                    question={question}
                  >
                    {answer}
                  </FaqItem>
                ))}
              </div>
              <p className="mt-6 max-w-[620px] text-ink/70">
                Have more questions? Email{" "}
                <AnagramEmail className={BODY_LINK} />.
              </p>
            </div>
            <CrypticsLightbox className="block" />
          </div>
        </div>
      </section>

      <DiceDivider />

      {/* stay in the loop */}
      <section
        id="stay-in-the-loop"
        className={`${SECTION} md:pt-14 md:pb-[88px]`}
      >
        <div className={CONTAINER}>
          <SectionHeading eyebrow="Want to keep up?" title="Stay in the loop" />
          <p className="mt-3 mb-7 max-w-[520px] text-base text-ink/70">
            Get notified about ticket sales, updates, volunteer opportunities,
            future events, and more.
          </p>
          <div className="max-w-[600px]">
            <SignupForm light />
          </div>
        </div>
      </section>

      {/* Below the last section: the Monopoly race runs round whatever sits
          between the dice row and this one. */}
      <MonopolyDivider />
    </>
  );
}
