import { airtableConfig } from "@/lib/airtable-config";
import { MEGAGAME_PROPOSAL_FORM_URL, RFP_FORM_URL } from "@/v2/lib/links";
import type { Answers, FormDef } from "./engine";
import { opts } from "./shared";

// Airtable's option for someone who wasn't at Metagame 2025. The form asks
// about last year only of those who tick that they were there, and writes
// this for everyone else.
const DID_NOT_ATTEND = "Did not attend";

// A puzzle or game for the Megagame, on the table the Airtable form wrote
// to. The spoilers (the factions and the elements they're after) only show
// to those who ask for them.
export const megagame: FormDef = {
  slug: "megagame",
  path: MEGAGAME_PROPOSAL_FORM_URL,
  tableId: airtableConfig.megagameSubmissionsTableId,
  name: "Megagame puzzle or game",
  eyebrow: "Submission · Metagame 2026",
  title: "Build part of the Megagame",
  pitch:
    "The Megagame runs all weekend: a puzzle hunt, a gauntlet of games and a story, threaded through the rest of Metagame and built from puzzles and games people send in. Tell us about yours here. You don't need to be coming to Metagame to contribute, and pieces that touch alliances, maps, alchemy, space travel, gems or stars are especially welcome. Submissions were due October 10, but the form is still open.",
  aside: "This should take about 10 minutes.",
  steps: [
    {
      key: "contact",
      title: "Who are you?",
      items: [
        {
          key: "name",
          field: "fldTqzxnASesmYX4X",
          fill: "name",
          type: "text",
          label: "Your name",
          required: true,
          autoComplete: "name",
          row: "you",
        },
        {
          key: "email",
          field: "fldgegcVZpKUTiu7I",
          fill: "email",
          type: "email",
          label: "Email",
          required: true,
          autoComplete: "email",
          row: "you",
        },
        {
          key: "phone",
          field: "fldrkSLCbbb1gbNVM",
          type: "phone",
          label: "Phone",
          autoComplete: "tel",
          row: "reach",
        },
        {
          key: "otherContact",
          field: "fldBuhCqNVLwNhYwE",
          fill: "discordContact",
          type: "text",
          label: "Other contact info",
          help: "Say which app, like Discord @cool_designer or Signal designer.1337.",
          row: "reach",
        },
        // A tick with no field of its own: it opens the question below, and
        // leaving it clear writes "Did not attend" (see beforeWrite).
        {
          key: "attended",
          type: "toggle",
          label: "Metagame 2025",
          text: "I was at Metagame 2025.",
        },
        {
          key: "lastYear",
          field: "fldCHYyOzYiMqkeXX",
          type: "choices",
          label: "What was your part in it?",
          help: "Select any of these that apply.",
          required: true,
          missing: "Say what you did at Metagame 2025, or untick the box.",
          options: opts(
            "Ran a Megagame Session",
            "Ran a Session/Game, not part of the Megagame",
            "Contributed Part of the Megagame",
            "Attended (but not the others)",
          ),
          show: (a) => a.attended === true,
        },
      ],
    },
    {
      key: "game",
      title: "What are you making?",
      intro:
        "Tell us as much as you like, and say which parts are fixed and which could change if we asked. For difficulty, think of a Friday or Saturday NYT crossword: the early rounds of the MIT Mystery Hunt are about right, and we want plenty of easier 15-minute puzzles too.",
      items: [
        {
          key: "kind",
          field: "flddvKrskxNgGNCl9",
          type: "choice",
          label: "What kind of thing is it?",
          required: true,
          // The first four and Other are Airtable's; the rest are added to
          // the field (by typecast) the first time someone picks them.
          options: [
            { value: "Tabletop Board/Card Game", glyph: "board-games" },
            { value: "Puzzle", glyph: "puzzles" },
            { value: "Role-playing Game", glyph: "larps" },
            { value: "Video Game", glyph: "video-games" },
            { value: "LARP", glyph: "larps" },
            { value: "Escape Room", glyph: "escape-rooms" },
            { value: "Scavenger Hunt", glyph: "treasure" },
            { value: "Word Game", glyph: "crosswords" },
            { value: "Trivia", glyph: "trivia" },
            { value: "Party/Social Game", glyph: "party-games" },
            { value: "Physical Challenge", glyph: "physical" },
            {
              value: "Other",
              more: {
                key: "kindOther",
                label: "What kind of thing it is",
                into: "description",
              },
            },
          ],
        },
        {
          key: "title",
          field: "fldKe1Q2avmln1MXl",
          type: "text",
          label: "Its title",
          help: "A working title is fine.",
        },
        {
          key: "description",
          field: "fldLbUVlw9RcMLEUR",
          type: "longtext",
          label: "Describe it",
          required: true,
        },
      ],
    },
    {
      key: "play",
      title: "How does it play?",
      items: [
        {
          key: "age",
          field: "fldKyyMBfS0hxDJx2",
          type: "choices",
          label: "Who's it for?",
          required: true,
          options: [
            ...opts("All ages"),
            // The Airtable option keeps its "?"; only the page text drops it.
            {
              value: "Primarily for children/teens?",
              label: "Primarily for children/teens",
            },
            ...opts("Adults only (18+)"),
            {
              value: "Other",
              more: {
                key: "ageOther",
                label: "Who it's for",
                into: "description",
              },
            },
          ],
        },
        {
          key: "minPlayers",
          field: "fldE111n1ccDpMr4w",
          type: "number",
          label: "Minimum players",
          min: 1,
          max: 1000,
          row: "players",
        },
        {
          key: "maxPlayers",
          field: "fldJ2mK2mcxm3YDWr",
          type: "number",
          label: "Maximum players",
          min: 1,
          max: 1000,
          row: "players",
        },
        {
          key: "teams",
          field: "fldj2tswW75BJciI4",
          type: "choices",
          label: "Played in teams? How many?",
          options: opts(
            "0 (individuals only)",
            "1 (cooperative)",
            "2",
            "3",
            "4",
            "5",
            "6",
            ">6",
          ),
        },
        {
          key: "minutes",
          field: "fldjuIJl7dNI3oocb",
          type: "number",
          label: "How many minutes does it take?",
          help: "Assume half the players don't know the rules, if it uses existing ones.",
          min: 1,
          max: 10000,
        },
        {
          key: "output",
          field: "fldmnRZvkyd3GX0EP",
          type: "choices",
          label: "What could solving it give?",
          help: "The Megagame chains puzzles together, so a result we can use as a clue for the next step helps. Select any it could give.",
          required: true,
          options: opts(
            "Word",
            "String of letters",
            "String of numbers",
            "Coordinates",
            "Image",
            "Physical token",
            "None of the above",
          ),
        },
      ],
    },
    {
      key: "needs",
      title: "What does it need?",
      items: [
        {
          key: "materials",
          field: "fldjogoPanvFzks1Z",
          type: "longtext",
          label: "Materials and requirements",
          help: "What do you need to make it happen? What will you bring, and what would we need to provide?",
        },
        {
          key: "preexisting",
          field: "fldoPLQxwYoqHhwh5",
          type: "choice",
          label:
            "Will it happen at Metagame even if it's not part of the Megagame?",
          options: opts(
            "Definitely Happening",
            "May Happen",
            "Will Not Happen",
          ),
        },
      ],
    },
    {
      key: "spoilers",
      title: "Spoilers?",
      intro:
        "We know this year's themes, but knowing them spoils the surprise. Some people would rather not, and still want to make something.",
      items: [
        {
          key: "spoilers",
          field: "fld57efCgXtANO2kJ",
          type: "toggle",
          label: "Show me the spoilers",
          text: "Yes, tell me the themes. I don't mind knowing.",
        },
        {
          type: "note",
          key: "themes",
          tone: "info",
          title: "Pirates, Wizards and Aliens",
          body: "Players join three factions and can move between them: Pirates, Wizards, and Aliens/Astronauts. Each pursues its own goal, and they can collaborate as much as they compete: repairing the crashed spaceship with recovered parts, finding and hoarding treasure, completing star charts and a lost tome. Word games lean wizard, logic puzzles alien, physical tasks and searches pirate, but none of that is a rule: a word game about the Caribbean goes to the pirates.",
          show: (a) => a.spoilers === true,
        },
        {
          key: "elements",
          field: "flds2AXpXTJDHRZ4s",
          type: "choices",
          label: "Elements you could include or adapt",
          help: "Select any of these that apply.",
          options: opts(
            "Pirates",
            "Wizards",
            "Aliens",
            "Stars",
            "Navigation",
            "Word games/Ciphers",
            "Logic/Deduction",
            "Dexterity/Speed/Strength",
            "Exploration/Searching",
            "Construction",
            "Trading/Negotiation",
            "Jigsaws",
          ),
          show: (a) => a.spoilers === true,
        },
        {
          key: "themeIdeas",
          field: "fldCTZWoV4PjkezbW",
          type: "longtext",
          label: "Theme ideas",
          help: "What themes would you like to include, or be willing to? If you read the spoilers, skip those and add anything else that seems helpful.",
        },
      ],
    },
  ],
  beforeWrite: (a: Answers) =>
    a.attended === true
      ? a
      : { ...a, attended: true, lastYear: [DID_NOT_ATTEND] },
  done: {
    title: "Thanks, we've got it.",
    body: "The Megagame team will look it over and be in touch about where it fits.",
    links: [
      { label: "Read about the Megagame", href: "/#megagame" },
      { label: "Propose a session too", href: RFP_FORM_URL },
      { label: "Back to the homepage", href: "/" },
    ],
  },
};
