// ── Site-level data for the DAW redesign ─────────────────────────────────
// Ported from the prototype's js/data.js (AINDATA).

export const socials = {
  email: "mailto:nathanielrbowman@gmail.com",
  instagram: "https://instagram.com/actuallyitsnathaniel",
  youtube: "https://www.youtube.com/@actuallyitsnathaniel",
  spotify:
    "https://open.spotify.com/playlist/5YIJBk2ASIJqbd07gyOGdY?si=1cf595b570c24bf0",
} as const;

export const roles: string[] = [
  "music production",
  "mixing",
  "mastering",
  "sound design",
  "recording",
  "sample packs",
  "synth presets",
  "live sound",
  "film scoring",
  "audio repair",
];

// Two hero paragraphs — the old "about" section was merged into the hero.
export const aboutParagraphs: string[] = [
  "i'm a music producer, sound designer, composer, arranger, songwriter, and recording artist. i've been messing around with beats and sounds for over 12 years, blending digital and analog stuff to make sounds that are nostalgic, but still fresh. i love using sounds and tones from all sorts of gadgets, like computer processors and even smart ovens. you can hear my work all over the place — from small artists, big artists, even adidas commercials. if i'm not doing music, i'm probably either writing code or playing video games.",
  "feel free to poke around my projects — i'm really proud of my portfolio so far and i love collaborating, so reach out if my stuff interests you!",
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
