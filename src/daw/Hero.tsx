import ainPfp from "/src/assets/images/daw-art/ain-pfp.jpg";
import { roles, aboutParagraphs } from "./data/site";
import { RoleChip } from "./components/RoleChip";
import { TrackSection } from "./components/TrackSection";
import { scrollToId } from "./lab-utils";

export function Hero() {
  return (
    <TrackSection
      id="hero"
      label="hero"
      rail="00"
      className="min-h-[calc(100vh-52px)] content-start pt-30"
    >
      <div className="grid grid-cols-[1fr_280px] items-center gap-12 max-[980px]:grid-cols-1">
        <div className="min-w-0">
          <div className="mb-4.5 font-mono text-[12px] tracking-[0.08em] text-accent">
            audio engineer · producer · ableton expert — los angeles
          </div>
          <h1 className="m-0 mb-6.5 text-[clamp(40px,6.5vw,84px)] leading-none font-extrabold tracking-[-0.03em] wrap-break-word">
            actually
            <wbr />
            its
            <wbr />
            nathaniel
            <span className="cursor-blink font-normal text-accent">_</span>
          </h1>
          <div className="mb-7.5 flex max-w-160 flex-wrap gap-1.75">
            {roles.map((r) => (
              <RoleChip key={r}>{r}</RoleChip>
            ))}
          </div>
          <p className="m-0 mb-3.5 max-w-[64ch] text-pretty text-dim">
            {aboutParagraphs[0]}
          </p>
          <p className="m-0 mb-7.5 max-w-[64ch] text-pretty text-dim">
            {aboutParagraphs[1]}
          </p>
          <div className="flex flex-wrap gap-2.5">
            <button
              className="inline-flex items-center gap-2.25 rounded-[3px] border border-accent bg-accent px-4.5 py-2.75 text-[13px] font-semibold whitespace-nowrap text-[#111] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)]"
              onClick={() => scrollToId("audiolab")}
            >
              <span className="icon-play tiny" /> hear the audio lab
            </button>
            <button
              className="inline-flex items-center gap-2.25 rounded-[3px] border border-line2 bg-panel px-4.5 py-2.75 text-[13px] font-semibold whitespace-nowrap transition-[border-color,background] duration-150 hover:border-dim hover:bg-panel2"
              onClick={() => scrollToId("projects")}
            >
              browse projects
            </button>
          </div>
        </div>
        <div className="relative rounded-sm border border-line2 bg-panel p-2 max-[980px]:max-w-60">
          <img
            src={ainPfp}
            alt="Nathaniel Bowman"
            className="aspect-square w-full rounded-xs object-cover saturate-[0.85]"
          />
          {/* <div className="absolute bottom-4 left-4 rounded-[2px] border border-line2 bg-[rgba(8,8,10,0.85)] px-2 py-[3px] font-mono text-[10px] tracking-[0.08em] text-dim">
            input 01 · me
          </div> */}
        </div>
      </div>
    </TrackSection>
  );
}
