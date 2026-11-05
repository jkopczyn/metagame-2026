import { type MegagameClass } from "@/lib/megagame-levels";
import { type HostedSession } from "@/lib/schedule";
import SectionHeading from "@/v2/components/SectionHeading";
import SpeakerCard from "@/v2/components/SpeakerCard";
import SpeakerCtaCard from "@/v2/components/SpeakerCtaCard";
import { SECTION } from "@/v2/components/styles";
import { SPEAKERS, type Speaker } from "@/v2/data/speakers";
import { RFP_FORM_URL } from "@/v2/lib/links";

const CARD =
  "w-[calc(33.333%-0.3334rem)] sm:w-[calc(33.333%-0.8334rem)] lg:w-[calc(20%-1rem)]";

type Props = {
  factionsFor: (speaker: Speaker, i: number) => MegagameClass[];
  sessionsFor?: (speaker: Speaker) => HostedSession[] | undefined;
  note?: React.ReactNode;
};

/** The home page's speakers grid; /dev/faction-badges renders it with stand-in picks. */
export default function SpeakersSection({
  factionsFor,
  sessionsFor,
  note,
}: Props) {
  return (
    <section id="speakers" className={`${SECTION} md:py-14`}>
      <div className="mx-auto max-w-[1180px] px-8">
        <SectionHeading eyebrow="Who will be there?" title="Speakers" />
        {note}
        {/* Wrapping flex, not a grid, so a short last row centers. */}
        <div className="mt-10 flex flex-wrap justify-center gap-2 sm:gap-5">
          {SPEAKERS.map((speaker, i) => (
            <div key={speaker.name} className={CARD}>
              <SpeakerCard
                {...speaker}
                factions={factionsFor(speaker, i)}
                sessions={sessionsFor?.(speaker)}
              />
            </div>
          ))}
          <div className={CARD}>
            <SpeakerCtaCard href={RFP_FORM_URL} />
          </div>
        </div>
        <p className="mt-8 text-center text-base text-ink/70">
          And many more&hellip;
        </p>
      </div>
    </section>
  );
}
