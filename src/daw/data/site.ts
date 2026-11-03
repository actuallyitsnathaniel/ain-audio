// ── Site-level data for the DAW redesign ─────────────────────────────────
// Ported from the prototype's js/data.js (AINDATA).

export const socials = {
  email: "mailto:nathanielrbowman@gmail.com",
  instagram: "https://instagram.com/actuallyitsnathaniel",
  youtube: "https://www.youtube.com/@actuallyitsnathaniel",
  spotify:
    "https://open.spotify.com/playlist/5YIJBk2ASIJqbd07gyOGdY?si=1cf595b570c24bf0",
  soundbetter: "https://soundbetter.com/profiles/45520-actuallyitsnathaniel",
} as const;

/** Locked produce/mix offer — keep in sync with SoundBetter. */
export const HIRE_EMAIL =
  "mailto:nathanielrbowman@gmail.com?subject=" +
  encodeURIComponent("produce+mix — [song title]");

export type HireOffer = {
  headline: string
  lead: string
  produceMix: string
  mixOnly: string
  scope: string
  payment: string
  mailto: string
  primaryCta: string
  soundBetterCta: string
}

export const hireOffer: HireOffer = {
  headline: "Production and mixing for release-ready songs.",
  lead:
    "Selected work includes sound design for Adidas × Messi, assisted sound work for Netflix, sound design and presets for EVAbeat's Melody Sauce 2 (12 presets, 5 .sfz demos), mastering for Jessica Lea Mayfield (prod. Day Wave), Brand X Music library placements, and Aubit Sound packs used by artists including U2 and Cheat Codes. Produce and mix credits include Sam Denton, John White, KRPTK, and Platinum Roses.",
  produceMix: "$1,000 / song",
  mixOnly: "$400 / song",
  scope: "Includes two revision rounds. Mastering quoted separately.",
  payment: "New clients: SoundBetter escrow preferred; otherwise 50% deposit, 50% on delivery.",
  mailto: HIRE_EMAIL,
  primaryCta: "Start a project",
  soundBetterCta: "Book on SoundBetter",
}

export const siteDescription =
  "Los Angeles producer and mix engineer. Credits include Adidas × Messi sound design, Jessica Lea Mayfield mastering, Brand X Music, EVAbeat Melody Sauce 2, and Aubit packs used by U2 and Cheat Codes."

export const roles: string[] = [
  "production",
  "mixing",
  "mastering",
  "sound design",
  "composition",
];

// Two hero paragraphs — the old "about" section was merged into the hero.
export const aboutParagraphs: string[] = [
  "Los Angeles producer, mix engineer, and sound designer with over twelve years behind the board. Credits span artist records, commercial campaigns, trailer library cues, and sample libraries — digital and analog tools shaped into work that holds up on a release.",
  "Selected work: sound design for Adidas × Messi; mastering for Jessica Lea Mayfield (produced by Day Wave); composition for Brand X Music; Aubit Sound packs used by artists including U2, Cheat Codes, and Virginia to Vegas; produce and mix for Sam Denton, John White, KRPTK, and Platinum Roses.",
];

export interface PressItem {
  title: string;
  subtitle: string;
  href: string;
}

export const press: PressItem[] = [
  {
    title: "Conversations with Nate Bowman",
    subtitle: "write-up by Voyage LA",
    href: "https://voyagela.com/interview/conversations-with-nate-bowman/",
  },
  {
    title: "Meet Nathaniel Bowman | Software & Audio Engineer",
    subtitle: "write-up by Shoutout LA",
    href: "https://shoutoutla.com/meet-nathaniel-bowman-software-audio-engineer/",
  },
];
