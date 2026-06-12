// ── Projects (clip grid + project pages) ─────────────────────────────────
// Ported from the prototype's js/data.js (AINDATA.projects). Hero art is
// imported from src/assets so Vite fingerprints + optimizes it.

import jlmArt from "/src/assets/images/daw-art/jlm.webp";
import rileyArt from "/src/assets/images/daw-art/riley.jpg";
import adidasArt from "/src/assets/images/daw-art/adidas-messi.jpg";
import samDentonArt from "/src/assets/images/daw-art/sam-denton.jpg";
import rylandArt from "/src/assets/images/daw-art/ryland.png";
import aubitArt from "/src/assets/images/daw-art/aubit.jpg";
import johnWhiteArt from "/src/assets/images/daw-art/john-white.jpg";
import brandXArt from "/src/assets/images/daw-art/brand-x.jpg";
import krptkArt from "/src/assets/images/daw-art/krptk.jpg";
import platinumRosesArt from "/src/assets/images/daw-art/platinum-roses.jpg";

export interface VimeoEmbed {
  src: string;
  ratio: string;
}

export interface Project {
  id: string;
  artist: string;
  subtitle: string;
  roles: string[];
  art: string;
  color: string;
  desc: string;
  vimeo?: VimeoEmbed[];
  labNotes?: string;
}

export const projects: Project[] = [
  {
    id: "jlm",
    artist: "Jessica Lea Mayfield",
    subtitle: "alt grunge · prod. Day Wave",
    roles: ["mastered"],
    art: jlmArt,
    color: "#8E7DE0",
    desc: "Produced by Day Wave and sounding fantastic before I ever touched it — lots of guitar, sampled drums, and synths. My mastering: specific-band dynamic saturation to bring up highs that were missing from the source, plus very modest punch from classic compression practices. Load it in the lab and A/B the mix against my master — phase-locked, with honest meters.",
  },
  {
    id: "riley",
    artist: "riley",
    subtitle: "artist — solo project",
    roles: ["produced", "mixed", "mastered"],
    art: rileyArt,
    color: "#7D9BD1",
    desc: "My personal passion project. Produced, mixed, and mastered by me. Ranging in styles from heavy bass-hitters all the way to somber songwriters. Take a look around, stay a while!",
  },
  {
    id: "adidas-messi",
    artist: "Adidas × Messi",
    subtitle: "marketing campaign",
    roles: ["sound design", "foley"],
    art: adidasArt,
    color: "#5FB8A6",
    vimeo: [
      { src: "https://player.vimeo.com/video/893859181?h=bbbd4b0aae", ratio: "4 / 5" },
      { src: "https://player.vimeo.com/video/873468787?h=ebe0c2ae9f", ratio: "16 / 9.25" },
    ],
    desc: "Sound design for the campaign welcoming Lionel Messi to Inter Miami with Adidas, alongside videographer Jake Dahm. Impacts, sweeps, and foley-esque sounds of mine helped welcome Messi to the U.S.",
  },
  {
    id: "sam-denton",
    artist: "Sam Denton",
    subtitle: "singer / songwriter",
    roles: ["produced", "mixed", "mastered"],
    art: samDentonArt,
    color: "#D1A05F",
    desc: "A dear friend and talented singer/songwriter and designer. Very proud to say I've produced, mixed, and mastered every work on this page. We're currently writing more, so be on the lookout!",
  },
  {
    id: "ryland",
    artist: "Ryland",
    subtitle: "band",
    roles: ["synths", "samples", "bg vocals"],
    art: rylandArt,
    color: "#C97D7D",
    desc: "Not to be confused with riley — ryland is my band! Five friends that make music since 2019. My role is synths, samples, and background vocals, plus audio clean-up when requested. We play live too — come out to the next gig!",
  },
  {
    id: "aubit-sound",
    artist: "Aubit Sound",
    subtitle: "sample / sound library company",
    roles: ["sound design", "sample packs", "presets"],
    art: aubitArt,
    color: "#9B7DC9",
    desc: "From late 2018 to late 2019 I put together a prolific number of producer-packs — presets, loops, one-shots. Nearly every pack became a #1 best-seller for over two weeks across platforms like ADSRSounds.com, used by artists including Cheat Codes, U2, and Virginia to Vegas.",
  },
  {
    id: "john-white",
    artist: "John White",
    subtitle: "artist",
    roles: ["produced", "mixed", "remixed", "mastered"],
    art: johnWhiteArt,
    color: "#7DC98F",
    desc: "One of my longest collaborators and dearest friends. I've produced, mixed, remixed, and mastered a number of songs for him, and continue to do so all the time.",
  },
  {
    id: "brand-x",
    artist: "Brand X Music",
    subtitle: "trailer / library music",
    roles: ["composed", "produced"],
    art: brandXArt,
    color: "#5F8FD1",
    desc: "I wrote and produced songs and demos for this composer-owned library, heard across film scores, commercials, and video games. BXM strives to make the highest quality music on the market.",
  },
  {
    id: "krptk",
    artist: "KRPTK",
    subtitle: "r&b / hip hop artist",
    roles: ["produced", "mixed", "mastered"],
    art: krptkArt,
    color: "#C9B07D",
    desc: "I produced, mixed, and mastered all of KRPTK's songs. A Korean American R&B/Hip Hop musician and cinematic artist from SoCal — his message is hope and his standard is substance.",
  },
  {
    id: "platinum-roses",
    artist: "Platinum Roses",
    subtitle: "electronic duo",
    roles: ["produced", "co-wrote", "mixed", "mastered"],
    art: platinumRosesArt,
    color: "#C97DB4",
    desc: "Producer / co-songwriter in this duo (featuring the voice of John White!). It gained solid traction before we split to focus on individual projects — a testament to my standards for professional electronic music.",
  },
];

export const projectById = (id: string): Project | undefined =>
  projects.find((p) => p.id === id);
