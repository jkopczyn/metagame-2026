import { airtableConfig } from "@/lib/airtable-config";
import { FINANCIAL_AID_FORM_URL, VOLUNTEER_APPLY_PATH } from "@/v2/lib/links";
import type { Answers, FormDef } from "./engine";
import { isEmpty, picked } from "./engine";
import {
  aboutYou,
  availability,
  basicFacts,
  disability,
  howFound,
  questions,
  reference,
  opts,
  skills,
  teamLists,
  VOLUNTEER_UTM_FIELDS,
} from "./shared";

const OFF_100 = "$100 off (ticket price: $325)";
const TRAVEL =
  "I would need travel assistance as well as a free ticket to be able to attend";
const OTHER = "Other";

const price = (a: Answers) => a.price;
// $100 off is honor-system: without a ticket yet, it's a coupon code away.
const instant100 = (a: Answers) =>
  price(a) === OFF_100 && picked(a.ticket, "No");
// Someone who has already applied to volunteer answered the volunteer
// questions there, so only a fresh yes (or an unsure) gets them here.
const canVolunteer = (a: Answers) =>
  a.volunteer === "Yes" || a.volunteer === "Unsure";

// The financial aid application, on the volunteer table. Anyone who could
// volunteer gets the volunteer questions too, as their own steps.
export const financialAid: FormDef = {
  slug: "financial-aid",
  path: FINANCIAL_AID_FORM_URL,
  tableId: airtableConfig.volunteersTableId,
  name: "Financial aid application",
  eyebrow: "Application · Metagame 2026",
  title: "Apply for financial aid",
  pitch:
    "Metagame has a scholarship fund with a limited number of free and reduced-price tickets, for anyone for whom the full price would be a hardship. Tell us the highest price that would work for you and a little about your situation, and we'll email you once we've reviewed it.",
  aside: "This application should only take about 5 minutes.",
  notice:
    "Your application will be visible to the Metagame team. If you'd rather tell us something privately, [contact Ricki](contact:ricki).",
  utmFields: VOLUNTEER_UTM_FIELDS,
  steps: [
    {
      key: "you",
      title: "Who are you?",
      items: basicFacts(),
    },
    {
      key: "price",
      title: "What would work?",
      intro:
        "A full-price ticket is $425. Pick the highest price that would still let you come.",
      items: [
        {
          key: "ticket",
          field: "fldhK2vXDqnEMr9oV",
          type: "choice",
          asList: true,
          label: "Do you already have a ticket?",
          help: "Already have one and looking for a refund? Pick your target net price and we'll work out the difference.",
          required: true,
          // Airtable's options name the ticket type; typecast adds a plain
          // "Yes" the first time someone picks it, as on the volunteer form.
          options: opts("Yes", "No"),
        },
        {
          key: "price",
          field: "fldBdxOA9RX6B8OEl",
          type: "choice",
          label: "Highest viable price",
          layout: "list",
          options: [
            {
              value: OFF_100,
              label: "$325 · $100 off",
              hint: "Open to anyone who needs it, on the honor system.",
            },
            {
              value: "50% off (ticket price: $212.50)",
              label: "$212.50 · 50% off",
              hint: "If $325 wouldn't work but half price would.",
            },
            {
              value: "75% off ticket (ticket price: $106.25)",
              label: "$106.25 · 75% off",
              hint: "If the first two don't work but $106 would.",
            },
            {
              value: "100% off ticket (ticket price: $0)",
              label: "$0 · free",
              hint: "If paying for the conference isn't feasible.",
            },
            {
              value: TRAVEL,
              label: "$0 + travel help",
              hint: "A free ticket plus some scholarship money for travel. How much we can grant depends on the fund.",
            },
            { value: OTHER, label: "Something else" },
          ],
        },
        {
          type: "note",
          key: "approved",
          tone: "win",
          title: "Approved. Your $325 ticket is waiting.",
          body: "Use the coupon code DEFAULTDISCOUNT at checkout; the button applies it for you. No need to finish this application.",
          cta: {
            label: "Get my $325 ticket",
            href: "/ticket/DEFAULTDISCOUNT",
          },
          show: instant100,
        },
        {
          key: "otherWhy",
          field: "fldRpWM4U2ldHsOie",
          type: "longtext",
          label: "Why something else?",
          help: "Tell us a little about what would work for you.",
          show: (a) => price(a) === OTHER,
        },
        {
          key: "details",
          field: "fldWRqImN3mrMmkFx",
          type: "longtext",
          label: "Tell us more about your situation",
          help: "We're trying to send the fund where it's needed most, so some context helps. If you'd rather talk it through on a call with someone from the team, say so here and we'll send you some times.",
          show: (a) => !isEmpty(price(a)) && price(a) !== OFF_100,
        },
        {
          key: "travelFrom",
          field: "fldxO7ojOEYt7wseJ",
          type: "text",
          label: "Where will you be traveling to and from?",
          show: (a) => price(a) === TRAVEL || price(a) === OTHER,
        },
        {
          key: "travelFunding",
          field: "fldvA5ryRLY5JevOe",
          type: "longtext",
          label: "How much travel funding are you asking for?",
          help: "Break down your travel costs and the amount you'd like covered. Often we can cover some but not all of it.",
          show: (a) => price(a) === TRAVEL || price(a) === OTHER,
        },
      ],
    },
    {
      key: "volunteer",
      title: "Could you volunteer?",
      intro:
        "Most reduced-price tickets come from volunteering. Financial aid is a smaller fund, for people who can't volunteer or who need help with travel too.",
      items: [
        {
          key: "volunteer",
          field: "fldZjtgeJ9rcvMlUf",
          type: "choice",
          label: "Are you able to volunteer at or in the lead-up to Metagame?",
          required: true,
          // Airtable has Yes, No and Unsure; typecast adds the fourth the
          // first time someone picks it.
          options: [
            { value: "Yes" },
            {
              value: "Yes, and I've already applied",
              hint: "Then we'll skip the volunteer questions here.",
            },
            { value: "No" },
            { value: "Unsure" },
          ],
        },
      ],
    },
    {
      key: "shifts",
      title: "When are you available?",
      intro:
        "Select any times you could be available. These are not hard commitments, and you are not committing to work during every slot you select.",
      view: "schedule",
      items: availability((day) => day),
      show: canVolunteer,
    },
    {
      key: "teams",
      title: "Team interests",
      intro:
        "You'd likely end up on one or two teams, and every volunteer attends a 1–2 hour orientation before the event.",
      view: "teams",
      items: teamLists("What kind of work are you most excited about?"),
      show: canVolunteer,
    },
    {
      key: "skills",
      title: "Skills and details",
      items: [skills(), ...aboutYou()],
      show: canVolunteer,
    },
    {
      key: "more",
      title: "A few more things",
      items: [
        ...disability,
        reference(
          "If we don't already know you, is there anyone who does that you'd recommend we talk to?",
        ),
        howFound,
        questions,
      ],
    },
  ],
  done: {
    title: "Your application is in.",
    body: "Applications are processed in the order they arrive. We'll email you once we've reviewed yours.",
    links: [
      { label: "Apply to volunteer too", href: VOLUNTEER_APPLY_PATH },
      { label: "Back to the homepage", href: "/" },
    ],
  },
};
