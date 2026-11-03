import ainPfp from "/src/assets/images/daw-art/ain-pfp.jpg";
import { roles } from "./data/site";
import { ClientLogoMarquee } from "./components/ClientLogoMarquee";
import { RoleChip } from "./components/RoleChip";
import { TrackSection } from "./components/TrackSection";
import { scrollToId } from "./lab-utils";
import { useAudioContent } from "../sanity/AudioContentContext";

/** Cap the desktop portrait so it keeps its size when there’s room, but can shrink inside its half. */
const DESKTOP_PFP = "w-full max-w-[23rem]";

function Portrait({ className = "" }: { className?: string }) {
  return (
    <div className={`relative rounded-sm border border-line2 bg-panel p-2 ${className}`}>
      <img
        src={ainPfp}
        alt="Nathaniel Bowman"
        className="aspect-square w-full rounded-xs object-cover saturate-[0.85]"
      />
    </div>
  );
}

function RoleChips() {
  return (
    <div className="flex flex-wrap gap-1.75">
      {roles.map((r) => (
        <RoleChip key={r}>{r}</RoleChip>
      ))}
    </div>
  );
}

function Ctas() {
  return (
    <div className="flex flex-wrap gap-2.5">
      <button
        className="inline-flex items-center gap-2.25 rounded-[3px] border border-accent bg-accent px-4.5 py-2.75 text-[13px] font-semibold whitespace-nowrap text-[#111] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)]"
        onClick={() => scrollToId("hire")}
      >
        Hire
      </button>
      <button
        className="inline-flex items-center gap-2.25 rounded-[3px] border border-line2 bg-panel px-4.5 py-2.75 text-[13px] font-semibold whitespace-nowrap transition-[border-color,background] duration-150 hover:border-dim hover:bg-panel2"
        onClick={() => scrollToId("projects")}
      >
        View work
      </button>
    </div>
  );
}

export function Hero() {
  const { aboutParagraphs } = useAudioContent();
  const eyebrow = (
    <div className="font-mono text-[12px] tracking-[0.08em] text-accent">
      producer · mix & mastering · sound design — los angeles
    </div>
  );
  const title = (
    <h1 className="m-0 max-w-full overflow-hidden whitespace-nowrap text-[clamp(1.5rem,9cqw,3.25rem)] leading-none font-extrabold tracking-[-0.03em]">
      actuallyitsnathaniel
      <span className="cursor-blink font-normal text-accent">_</span>
    </h1>
  );
  const about = (
    <p className="m-0 max-w-[64ch] text-pretty text-dim">{aboutParagraphs[0]}</p>
  );

  return (
    <TrackSection
      id="hero"
      label="hero"
      rail="00"
      className="pt-30 max-[760px]:pt-20"
    >
      {/* Desktop: fill the viewport under section pad; pin CTAs to the bottom */}
      <div className="hidden min-h-[calc(100dvh-9.75rem)] min-w-0 flex-1 flex-col justify-between gap-7.5 min-[981px]:flex">
        <div className="flex w-4/5 max-w-full min-w-0 flex-col gap-7.5">
          <div className="grid min-w-0 grid-cols-2 items-start gap-8">
            <div className="@container flex min-w-0 flex-col justify-start gap-7.5">
              <div className="flex min-w-0 flex-col gap-4.5">
                {eyebrow}
                {title}
              </div>
              <RoleChips />
              {about}
            </div>
            <div className="flex min-w-0 items-start justify-center">
              <Portrait className={DESKTOP_PFP} />
            </div>
          </div>
        </div>
        <div className="w-4/5 max-w-full min-w-0">
          <ClientLogoMarquee />
        </div>
        <Ctas />
      </div>

      {/* Mobile: name → photo → selected work → description → CTAs */}
      <div className="flex flex-col gap-6 min-[981px]:hidden">
        <div className="@container flex min-w-0 flex-col gap-3">
          {eyebrow}
          {title}
        </div>
        <Portrait className="mx-auto w-full max-w-[min(100%,22rem)]" />
        <ClientLogoMarquee />
        <RoleChips />
        {about}
        <Ctas />
      </div>
    </TrackSection>
  );
}
