import { socials } from "./data/site";
import { SectionHead } from "./components/SectionHead";
import { TrackSection } from "./components/TrackSection";

const ctaBtn =
  "inline-flex items-center gap-[9px] rounded-[3px] border border-line2 bg-panel px-[18px] py-[11px] text-[13px] font-semibold whitespace-nowrap no-underline transition-[border-color,background] duration-150 hover:border-dim hover:bg-panel2";
const ctaAccent =
  "inline-flex items-center gap-[9px] rounded-[3px] border border-accent bg-accent px-[18px] py-[11px] text-[13px] font-semibold whitespace-nowrap text-[#111] no-underline transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)]";

export function ContactSection() {
  return (
    <TrackSection id="contact" label="contact" rail="04">
      <SectionHead num="04" title="contact" />
      <div className="flex flex-col items-start gap-[18px] rounded-[4px] border border-line bg-panel p-8">
        <p className="m-0 text-[22px] font-bold">got a record that needs finishing?</p>
        <div className="flex flex-wrap gap-[10px]">
          <a className={ctaAccent} href={socials.email}>
            email me
          </a>
          <a className={ctaBtn} href={socials.instagram} target="_blank" rel="noopener noreferrer">
            instagram
          </a>
          <a className={ctaBtn} href={socials.youtube} target="_blank" rel="noopener noreferrer">
            youtube
          </a>
          <a className={ctaBtn} href={socials.spotify} target="_blank" rel="noopener noreferrer">
            spotify
          </a>
        </div>
        <p className="m-0 mt-[10px] font-mono text-[11px] text-faint">
          © {new Date().getFullYear()} nathaniel bowman · audio.actuallyitsnathaniel.com
        </p>
      </div>
    </TrackSection>
  );
}
