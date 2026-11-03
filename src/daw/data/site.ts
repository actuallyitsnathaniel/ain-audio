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

/** Hire mailto — keep in sync with SoundBetter where rates overlap. */
export const HIRE_EMAIL =
  "mailto:nathanielrbowman@gmail.com?subject=" +
  encodeURIComponent("audio project — [what you need]");

export type HireOffer = {
  headline: string
  lead: string
  produceMix: string
  mixOnly: string
  mastering: string
  scope: string
  payment: string
  mailto: string
  primaryCta: string
  soundBetterCta: string
}

export const hireOffer: HireOffer = {
  headline: "Production, mixing, mastering, and whatever else the record needs.",
  lead: "Clientele includes: Netflix, Prime, Adidas, Brand X, and many more.",
  produceMix: "$1,000 / song",
  mixOnly: "$400 / song",
  mastering: "quoted / song",
  scope:
    "Starting rates for common song packages. Sound design, composition, and custom work quoted per project. Produce/mix includes two revision rounds.",
  payment: "New clients: SoundBetter escrow preferred; otherwise 50% deposit, 50% on delivery.",
  mailto: HIRE_EMAIL,
  primaryCta: "Start a project",
  soundBetterCta: "Book on SoundBetter",
}

export const siteDescription =
  "Los Angeles producer, mix & mastering engineer, and sound designer. Credits include Adidas × Messi, Jessica Lea Mayfield, Brand X Music, EVAbeat Melody Sauce 2, and Aubit packs used by U2 and Cheat Codes."

export const roles: string[] = [
  "production",
  "mixing",
  "mastering",
  "sound design",
  "composition",
];

// Hero about copy — selected-work credits live in ClientLogoMarquee instead.
export const aboutParagraphs: string[] = [
  "Los Angeles producer, mix engineer, and sound designer with over twelve years behind the board. Credits span artist records, commercial campaigns, trailer library cues, and sample libraries — digital and analog tools shaped into work that holds up on a release.",
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
