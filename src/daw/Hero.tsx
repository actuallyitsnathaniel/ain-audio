import ainPfp from "/src/assets/images/daw-art/ain-pfp.jpg";
import { roles, aboutParagraphs } from "./data/site";
import { RoleChip } from "./components/RoleChip";
import { TrackSection } from "./components/TrackSection";
import { scrollToId } from "./lab-utils";

export function Hero() {
  return (
    <TrackSection id="hero" label="hero" rail="00" className="min-h-[calc(100vh-52px)] content-start pt-[120px]">
      <div className="grid grid-cols-[1fr_280px] items-center gap-12 max-[980px]:grid-cols-1">
        <div className="min-w-0">
          <div className="mb-[18px] font-mono text-[12px] tracking-[0.08em] text-accent">
            audio engineer · producer · ableton expert — los angeles
          </div>
          <h1 className="m-0 mb-[26px] text-[clamp(40px,6.5vw,84px)] leading-none font-extrabold tracking-[-0.03em] break-words">
            actually<wbr />its<wbr />nathaniel
            <span className="cursor-blink font-normal text-accent">_</span>
          </h1>
          <div className="mb-[30px] flex max-w-[640px] flex-wrap gap-[7px]">
            {roles.map((r) => (
              <RoleChip key={r}>{r}</RoleChip>
            ))}
          </div>
          <p className="m-0 mb-[14px] max-w-[64ch] text-pretty text-dim">{aboutParagraphs[0]}</p>
          <p className="m-0 mb-[30px] max-w-[64ch] text-pretty text-dim">{aboutParagraphs[1]}</p>
          <div className="flex flex-wrap gap-[10px]">
            <button
              className="inline-flex items-center gap-[9px] rounded-[3px] border border-accent bg-accent px-[18px] py-[11px] text-[13px] font-semibold whitespace-nowrap text-[#111] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)]"
              onClick={() => scrollToId("audiolab")}
            >
              <span className="icon-play tiny" /> hear the audio lab
            </button>
            <button
              className="inline-flex items-center gap-[9px] rounded-[3px] border border-line2 bg-panel px-[18px] py-[11px] text-[13px] font-semibold whitespace-nowrap transition-[border-color,background] duration-150 hover:border-dim hover:bg-panel2"
              onClick={() => scrollToId("projects")}
            >
              browse projects
            </button>
          </div>
        </div>
        <div className="relative rounded-[4px] border border-line2 bg-panel p-2 max-[980px]:max-w-[240px]">
          <img
            src={ainPfp}
            alt="Nathaniel Bowman"
            className="aspect-square w-full rounded-[2px] object-cover saturate-[0.85]"
          />
          <div className="absolute bottom-4 left-4 rounded-[2px] border border-line2 bg-[rgba(8,8,10,0.85)] px-2 py-[3px] font-mono text-[10px] tracking-[0.08em] text-dim">
            input 01 · me
          </div>
        </div>
      </div>
    </TrackSection>
  );
}
