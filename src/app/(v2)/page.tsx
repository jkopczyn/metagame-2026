import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import AnagramEmail from "@/v2/components/AnagramEmail";
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
import PlayWeb from "@/v2/components/PlayWeb";
import PublicSchedule from "@/v2/components/schedule/PublicSchedule";
import {
  DISPLAY,
  EYEBROW,
  SECTION,
  SECTION_ANCHOR,
} from "@/v2/components/styles";
import { Button } from "@/v2/components/ui/button";
import { CAROUSEL } from "@/v2/data/carousel";
import {
  GOLD_SPONSORS,
  PATRON_SPONSORS,
  SILVER_SPONSORS,
} from "@/v2/data/sponsors";
import { SPEAKERS } from "@/v2/data/speakers";
import SpeakersSection from "@/v2/components/SpeakersSection";
import {
  HOTELS_SEARCH_URL,
  HOUSING_URL,
  PODCAST_EPISODE_URL,
  LIGHTHAVEN_URL,
  RFP_FORM_URL,
  SPONSOR_FORM_URL,
} from "@/v2/lib/links";
import HatImage from "@/v2/hat-trick/HatImage";
import { HATS } from "@/v2/hat-trick/hats";
import { SOCIAL_LINKS } from "@/v2/lib/urls";
import { env } from "@/env";
import { activeFactions, NO_LEVELS } from "@/lib/megagame-levels";
import { loadMegagameLevelsFor } from "@/lib/megagame-store";
import {
  buildDays,
  hostedSessions,
  hostsBoard,
  publicSchedule,
  type PublicLocation,
} from "@/lib/schedule";
import { loadSchedule } from "@/lib/schedule-store";
import { boardNote, type BoardData } from "@/lib/unconference";
import { listNotesIn } from "@/lib/unconference-store";
import lighthavenCutout from "../../../public/images/lighthaven_cutout.png";
import megagameChess from "../../../public/images/megagame-chess.jpg";
import nightMarketCooks from "../../../public/images/email/night_market_cooks.jpg";

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
        Please do! Let us know{" "}
        <a href={RFP_FORM_URL} className={BODY_LINK}>
          here
        </a>{" "}
        if you&apos;d like to run a game, event, or session.
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

/**
 * The unconference board as anyone sees it, for this static page: no viewer,
 * so nothing is theirs and nothing can be posted or reacted to here. Null
 * when no public room hosts the board, or if the notes can't be read — the
 * schedule still shows without them.
 */
async function homeBoard(
  locations: PublicLocation[],
): Promise<BoardData | null> {
  const rooms = locations.filter(hostsBoard);
  if (rooms.length === 0) return null;
  try {
    const notes = await listNotesIn(
      rooms.map((r) => r.id),
      null,
    );
    return {
      notes: notes.map((n) => boardNote(n, null, { withPoster: false })),
      signedIn: false,
      canPost: false,
      isTeam: false,
      readOnly: true,
    };
  } catch (e) {
    console.error("home board notes", e);
    return null;
  }
}

export default async function Home() {
  // Public rooms only and no per-viewer state, so the page stays static. CI
  // prerenders it with no database (Vercel builds have one), so the grid is
  // skipped rather than failing the build. The same goes for a database the
  // code is ahead of: a deploy builds before it migrates, so a schema change
  // the schedule reads would otherwise fail the build that ships it. The
  // page revalidates every ten minutes and fills in once the migration has
  // run.
  // The speakers' Megagame picks ride along for their cards' medals; they're
  // decoration, so if that query fails the cards just go without.
  const [raw, levels] = env.DATABASE_URL
    ? await Promise.all([
        loadSchedule().catch((e: unknown) => {
          console.error("home schedule", e);
          return null;
        }),
        loadMegagameLevelsFor(SPEAKERS.map((s) => s.userId)).catch(
          (e: unknown) => {
            console.error("speaker megagame levels", e);
            return null;
          },
        ),
      ])
    : [null, null];
  const schedule = raw && publicSchedule(raw, "public");
  const board = schedule && (await homeBoard(schedule.locations));
  // The sessions each speaker hosts, for the backs of their cards.
  const speaking = raw && schedule && hostedSessions(raw, schedule);
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
      <SpeakersSection
        factionsFor={(speaker) =>
          activeFactions(levels?.get(speaker.userId) ?? NO_LEVELS)
        }
        sessionsFor={(speaker) => speaking?.get(speaker.userId)}
      />

      <CardSuitsDivider />

      {/* schedule */}
      <section id="schedule" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <SectionHeading title="2026 Schedule" />
        </div>
        {schedule && (
          <div className="mt-10 px-4 sm:px-8">
            <PublicSchedule
              days={buildDays(schedule.sessions)}
              locations={schedule.locations}
              board={board}
              mine={null}
            />
          </div>
        )}
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
                  puzzles.
                </p>
              </div>
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

      {/* Bottom padding matches the next section's top, so the divider sits
          midway between the photo and the heading. */}
      <div className="pt-6 pb-8 md:pb-14">
        <Carousel images={CAROUSEL} />
      </div>

      <SetCardDivider />

      {/* sponsors */}
      <section id="sponsors" className={`${SECTION} md:py-14`}>
        <div className={CONTAINER}>
          <SectionHeading eyebrow="With gratitude" title="2026 Sponsors" />
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
              Interested in making Metagame 2027 happen?
            </h3>
            <p className="mt-3">
              <Link href={SPONSOR_FORM_URL} className={BODY_LINK}>
                Sponsor form
              </Link>
            </p>
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
