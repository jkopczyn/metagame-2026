// Each featured speaker's account: the `user.id` whose hosted sessions their
// homepage card lists (public already, at /u/<id>), and their name. SPEAKERS
// (speakers.ts) spreads these in; the dev seed (scripts/db-seed.mjs) creates
// an account for each, so it imports this file untranspiled: keep it to plain
// data. TODO ids are placeholders until the prod id is filled in.
export const SPEAKER_ACCOUNTS = {
  chrisGrace: {
    name: "Chris Grace",
    userId: "kcZBuUrXJ4ql5CP200iEXrmpZ8nDOW7s",
  },
  caroMurphy: {
    name: "Caro Murphy",
    userId: "qezIaN21EpW2vuc6Yv0ob7D8No7XMmQb",
  },
  peihGeeLaw: {
    name: "Peih-Gee Law",
    userId: "JbL5b2bjIwxSxVEAOz8V3oB1aUdUajco",
  },
  tommyHonton: {
    name: "Tommy Honton",
    userId: "XdJOUZ2rkePZ8Cmxh0dzw7GEUWMx1Sbs",
  },
  aella: { name: "Aella", userId: "p4OsCChdJOU6bLlRZ13sMg82Kyzg4WCU" },
  lexiKohanski: {
    name: "Lexi Kohanski",
    userId: "iEXCt5pJ2QbZIvHXlen0fd4wa4P1riRU",
  },
  amySchneider: { name: "Amy Schneider", userId: "TODO-amy-schneider" },
  andrewNathenson: {
    name: "Andrew Nathenson",
    userId: "jO5Dc0eNbxNbu9RiaMqjH7dM72ySARIQ",
  },
  davidTurner: {
    name: "David Turner",
    userId: "NhGDnPnvTmeCxSnoLORUd0ckvHLObWfh",
  },
  elliFuredy: {
    name: "Elli Furedy",
    userId: "lvlVQb8iC0z05E1YLldN8X7cRfukop6U",
  },
  raphDAmico: {
    name: "Raph D’Amico",
    userId: "W6gVgkKjFxQ30BYEvIcc0B9MfhFIbFo7",
  },
  randyLubin: {
    name: "Randy Lubin",
    userId: "8cEKR8xydoZuU8tFB9Rg9Xhirus6vWXT",
  },
  jamieWahls: {
    name: "Jamie Wahls",
    userId: "FbWMy1gaYsNh4ghhshT52lvvEV7GH4Pm",
  },
  marleeHonton: {
    name: "Marlee Honton",
    userId: "eKpqIeoWuyqo5ETWUj8tolFQvxTFXCZ5",
  },
  aemiliaDixon: {
    name: "Aemilia Dixon",
    userId: "x4cFUpIkofGleAuAdRdJICsvdtYbGSHi",
  },
  irisLemony: {
    name: "iris lemony",
    userId: "OZZFfxtiQJAcpmhUxuzaVCg31Pa5lmgN",
  },
  spencerBeebe: {
    name: "Spencer Beebe",
    userId: "yAOhXRTcpvA1SeEyeLh4VDSpyNZZGt6R",
  },
  chrisKay: { name: "Chris Kay", userId: "ulrPJOihomRGSnhDMB6hgb0in2jVLQww" },
  rickiHeicklen: {
    name: "Ricki Heicklen",
    userId: "bnoEVZ36sfvVbDaHmITKIv6clLZoaSX6",
  },
};
