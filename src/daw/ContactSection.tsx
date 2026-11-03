import { ClientLogoMarquee } from "./components/ClientLogoMarquee";
import { SectionHead } from "./components/SectionHead";
import { TrackSection } from "./components/TrackSection";
import { HIRE_EMAIL } from "./data/site";
import { scrollToId } from "./lab-utils";
import { useAudioContent } from "../sanity/AudioContentContext";

const ctaBtn =
  "inline-flex items-center gap-[9px] rounded-[3px] border border-line2 bg-panel px-[18px] py-[11px] text-[13px] font-semibold whitespace-nowrap no-underline transition-[border-color,background] duration-150 hover:border-dim hover:bg-panel2";
const ctaAccent =
  "inline-flex items-center gap-[9px] rounded-[3px] border border-accent bg-accent px-[18px] py-[11px] text-[13px] font-semibold whitespace-nowrap text-[#111] no-underline transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)]";

export function ContactSection() {
  const { socials, hireOffer } = useAudioContent();

  return (
    <TrackSection id="hire" label="hire" rail="01">
      <SectionHead num="01" title="hire" sub="produce · mix" />
      <div className="flex flex-col items-start gap-[18px] rounded-[4px] border border-line bg-panel p-8">
        <p className="m-0 text-[22px] font-bold tracking-[-0.01em]">{hireOffer.headline}</p>
        <p className="m-0 max-w-[68ch] text-pretty text-dim">{hireOffer.lead}</p>
        <button
          type="button"
          className="m-0 cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] text-accent underline underline-offset-2 hover:text-daw-text"
          onClick={() => scrollToId("projects")}
        >
          View full portfolio ↓
        </button>

        <ClientLogoMarquee />

        <dl className="m-0 grid w-full max-w-[36ch] gap-3 font-mono text-[12px] leading-relaxed">
          <div className="grid grid-cols-[1fr_auto] gap-x-6">
            <dt className="text-faint">Produce + mix</dt>
            <dd className="m-0 text-right text-daw-text">{hireOffer.produceMix}</dd>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-x-6">
            <dt className="text-faint">Mix only</dt>
            <dd className="m-0 text-right text-daw-text">{hireOffer.mixOnly}</dd>
          </div>
        </dl>

        <p className="m-0 max-w-[62ch] font-mono text-[11px] leading-relaxed text-faint">
          {hireOffer.scope}
          <br />
          {hireOffer.payment}
        </p>

        <div className="flex flex-wrap gap-[10px]">
          <a className={ctaAccent} href={HIRE_EMAIL}>
            Start a project
          </a>
          <a
            className={ctaBtn}
            href={socials.soundbetter}
            target="_blank"
            rel="noopener noreferrer"
          >
            Book on SoundBetter
          </a>
        </div>

        <p className="m-0 mt-[10px] font-mono text-[11px] text-faint">
          © {new Date().getFullYear()} Nathaniel Bowman · audio.actuallyitsnathaniel.com ·{" "}
          <a className="underline underline-offset-2 hover:text-dim" href="/usage-and-ai-policy">
            usage &amp; ai policy
          </a>
        </p>
      </div>
    </TrackSection>
  );
}
