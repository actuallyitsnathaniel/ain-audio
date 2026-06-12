import { press } from "./data/site";
import { SectionHead } from "./components/SectionHead";
import { TrackSection } from "./components/TrackSection";

export function PressSection() {
  return (
    <TrackSection id="press" label="press" rail="03">
      <SectionHead num="03" title="press" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
        {press.map((pr) => (
          <a
            key={pr.href}
            className="flex flex-col gap-[6px] rounded-[4px] border border-line bg-panel px-[22px] py-5 no-underline transition-[border-color,transform] duration-150 hover:-translate-y-[2px] hover:border-line2"
            href={pr.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="text-[16px] font-semibold">{pr.title}</span>
            <span className="font-mono text-[11px] text-dim">{pr.subtitle}</span>
            <span className="mt-2 font-mono text-[11px] text-accent">read ↗</span>
          </a>
        ))}
      </div>
    </TrackSection>
  );
}
