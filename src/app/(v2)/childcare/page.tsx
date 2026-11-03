import type { Metadata } from "next";
import ContentPage from "@/v2/components/ContentPage";
import LastYearSchedule from "@/v2/components/schedule/LastYearSchedule";
import { HEADING } from "@/v2/components/styles";
import Testimonials from "@/v2/components/Testimonials";
import { Button } from "@/v2/components/ui/button";
import { CHILDCARE_TESTIMONIALS } from "@/v2/data/childcare-testimonials";
import ContactLink from "@/v2/components/contact/ContactLink";
import { CHILD_REGISTRATION_FORM_URL } from "@/v2/lib/links";

export const metadata: Metadata = {
  title: "Childcare — Metagame 2026",
  description: "Childcare and children's programming at Metagame 2026.",
};

export default function ChildcarePage() {
  return (
    <ContentPage
      eyebrow="What of the children?"
      title="Childcare"
      intro={
        <>
          <p>
            Metagame is for the whole family. Children under 13 attend Metagame
            for free, and we hope to see many in attendance! We offer childcare
            for kids ages 5-12 (for free!), so that the parents can have fun
            too. The schedule for childcare availability is listed on the
            registration form below.
          </p>
          <p className="mt-3">
            All children attending Metagame must be registered, whether or not
            they&apos;re signing up for childcare.
          </p>
          <Button asChild variant="navy" className="mt-5">
            <a href={CHILD_REGISTRATION_FORM_URL}>Register your children</a>
          </Button>
          <p className="mt-5">
            Our 2026 schedule is still in progress, but you can take a look at{" "}
            <a
              href="#family-room"
              className="font-semibold text-navy underline underline-offset-2"
            >
              what we offered last year
            </a>{" "}
            to get a sense for what the Metagame children&apos;s experience
            might look like.
          </p>
          <p className="mt-3">
            Questions or particular needs?{" "}
            <ContactLink
              subject="Childcare"
              className="font-semibold text-navy underline underline-offset-2"
            >
              Get in touch
            </ContactLink>
            .
          </p>
        </>
      }
    >
      <h2 className={`${HEADING} mb-6 text-[clamp(24px,3vw,34px)] text-navy`}>
        What the kids said
      </h2>
      <Testimonials items={CHILDCARE_TESTIMONIALS} className="mb-14" />

      <h2
        id="family-room"
        className={`${HEADING} mb-6 scroll-mt-24 text-[clamp(24px,3vw,34px)] text-navy`}
      >
        Last year in The Family Room
      </h2>
      <LastYearSchedule
        locationNames={["The Family Room"]}
        ages={["KIDS"]}
        variant="sequential"
        defaultView="list"
        showViewToggle={false}
      />
    </ContentPage>
  );
}
