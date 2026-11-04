import type { StaticImageData } from "next/image";
import { HATS, type Hat } from "@/v2/hat-trick/hats";
import ben from "../../../public/images/team/ben.jpg";
import brendan from "../../../public/images/team/brendan.jpg";
import brian from "../../../public/images/team/brian.jpg";
import damon from "../../../public/images/team/damon.jpg";
import davidHolt from "../../../public/images/team/david_holt.jpg";
import jisk from "../../../public/images/team/jisk.jpg";
import john from "../../../public/images/team/john_bromels.jpg";
import kai from "../../../public/images/team/kai.jpg";
import michael from "../../../public/images/team/michael_sheely.jpg";
import patrick from "../../../public/images/team/patrick.jpg";
import ricki from "../../../public/images/team/ricki.jpg";
import sparr from "../../../public/images/team/sparr.jpg";
import tommy from "../../../public/images/team/tommy.jpg";
import yemima from "../../../public/images/team/yemima.jpg";

// The people running the con (TEAM) and the advisors (ADVISORS), shown on
// /team in display order. To add someone: add an entry and import their photo from
// public/images/team/ (800px JPEGs). Omit `photo` for an initials placeholder,
// `contactKey` if they'd rather not be contacted directly.
export type Person = {
  name: string;
  title: string;
  // When set, the title renders as a link (speaker bylines).
  titleUrl?: string;
  photo?: StaticImageData;
  // Contactable through the site form. The address isn't here (this repo is
  // public): it's the server-only env var CONTACT_EMAIL_<CONTACTKEY>.
  contactKey?: string;
  // Hat Trick: hats hidden in this photo (see src/v2/hat-trick).
  hats?: Hat[];
};

export const TEAM: Person[] = [
  {
    name: "Ricki Heicklen",
    title: "Game and Conference Master",
    photo: ricki,
    contactKey: "ricki",
  },
  {
    name: "Ben Karcher",
    title: "Chief of Staff",
    photo: ben,
    contactKey: "ben",
  },
  {
    name: "Brian Smiley",
    title: "Operations Lead",
    photo: brian,
    contactKey: "brian",
  },
  {
    name: "Yemima Morris",
    title: "Volunteer Coordinator",
    photo: yemima,
    contactKey: "yemima",
  },
  { name: "John Bromels", title: "Megagame Lead", photo: john },
  {
    name: "Jisk Kopczynski",
    title: "Megagame Chief of Staff",
    photo: jisk,
    hats: [HATS.pirate],
  },
  {
    name: "David Holt",
    title: "Marketing & Sponsorships",
    photo: davidHolt,
    contactKey: "david",
  },
  { name: "Sparr Risher", title: "Generalist", photo: sparr },
  { name: "Kai Geffen", title: "Generalist", photo: kai },
  { name: "Michael Sheely", title: "Generalist", photo: michael },
  {
    name: "Damon Pourtahmaseb-Sasi",
    title: "Community Health Liaison",
    photo: damon,
    contactKey: "damon",
  },
];

export const ADVISORS: Person[] = [
  {
    name: "Brendan Hurst",
    title: "Advisor",
    photo: brendan,
    hats: [HATS.sequin],
  },
  { name: "Tommy Honton", title: "Advisor", photo: tommy },
  { name: "Patrick McKenzie", title: "Advisor", photo: patrick },
];
