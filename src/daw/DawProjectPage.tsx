import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Project } from "./data/projects";
import { engine } from "./engine";
import { trackForProject } from "./data/tracks";
import { discographyFor } from "./data/discography";
import { useEngine } from "./hooks/useEngine";
import { RoleChip } from "./components/RoleChip";
import { PlayButton } from "./components/PlayButton";
import { TimeReadout } from "./components/TimeReadout";
import { Waveform } from "./components/Waveform";
import { Spectrum } from "./components/Spectrum";
import { DiscoGroup } from "./components/Discography";
import { ABDial } from "./components/audio-lab/ABDial";
import { LabErrorBanner } from "./components/audio-lab/LabErrorBanner";
import { lockChip } from "./lab-utils";

// Compact lab player wired to the global engine; loads this project's preview.
function ProjectLab({ p }: { p: Project }) {
  const eng = useEngine(["state", "track"]);
  const isCurrent = eng.track && eng.track.id === p.id;
  const track = useMemo(() => trackForProject(p), [p]);
  const isPairTrack = track.kind === "pair";

  if (!isCurrent) {
    return (
      <div className="mb-5 flex flex-col gap-3 rounded-[4px] border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-4">
          <button
            className="inline-flex items-center gap-[9px] rounded-[3px] border border-accent bg-accent px-[18px] py-[11px] text-[13px] font-semibold whitespace-nowrap text-[#111] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)]"
            onClick={() => engine.loadTrack(track, { autoplay: true })}
          >
            <span className="icon-play tiny" />{" "}
            {isPairTrack ? "load mix ↔ master A/B into the lab" : "load preview into the lab"}
          </button>
          <span className="font-mono text-[11px] text-faint">
            {isPairTrack
              ? "full record · phase-locked A/B · plays through the global master chain"
              : "20–30s preview · plays through the global master chain"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-[4px] border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-[14px]">
        <PlayButton />
        <TimeReadout />
        <span className={lockChip}>
          ▸ {p.artist} {track.kind === "pair" ? "· mix ↔ master" : "preview"}
        </span>
      </div>
      <LabErrorBanner />
      <Waveform height={84} />
      {track.kind === "pair" ? <ABDial /> : null}
      <Spectrum height={64} />
    </div>
  );
}

export function DawProjectPage({ project }: { project: Project }) {
  const p = project;
  const disco = discographyFor(p.id);

  const singles = disco.filter((d) => d.type === "single" || d.type === "ep");
  const albums = disco.filter((d) => d.type === "album");
  const general = disco.filter((d) => d.type === "general");

  return (
    <section
      data-screen-label={"project: " + p.artist}
      className="mx-auto grid max-w-[1280px] grid-cols-[56px_1fr] px-6 pt-[72px] pb-9 max-[760px]:grid-cols-1 max-[760px]:px-4 max-[760px]:pt-14 max-[760px]:pb-6"
      style={{ "--clip": p.color } as React.CSSProperties}
    >
      <div className="mr-6 border-r border-line pt-2 font-mono text-[11px] tracking-[0.1em] text-faint max-[760px]:hidden">
        ▸
      </div>
      <div className="min-w-0">
        <Link
          to="/#projects"
          className="mb-[14px] inline-block py-2 font-mono text-[11.5px] tracking-[0.06em] whitespace-nowrap text-dim transition-colors duration-150 hover:text-daw-text"
        >
          ◂ back to session
        </Link>

        <div className="mb-[14px] grid grid-cols-[6px_320px_1fr] overflow-hidden rounded-[4px] border border-line bg-panel max-[980px]:grid-cols-[6px_260px_1fr] max-[760px]:grid-cols-[6px_1fr]">
          <div className="bg-[var(--clip)] max-[760px]:row-span-2" />
          <img
            className="h-full min-h-[320px] w-[320px] border-r border-line object-cover max-[980px]:min-h-[260px] max-[980px]:w-[260px] max-[760px]:max-h-[360px] max-[760px]:min-h-0 max-[760px]:w-full max-[760px]:border-r-0 max-[760px]:border-b max-[760px]:border-line"
            src={p.art}
            alt={p.artist}
          />
          <div className="min-w-0 px-[26px] py-[22px]">
            <div className="mb-2 font-mono text-[10.5px] tracking-[0.12em] text-[var(--clip)] uppercase">
              project · {p.id}
            </div>
            <h1 className="m-0 text-[clamp(28px,4vw,44px)] leading-[1.05] font-extrabold tracking-[-0.02em]">{p.artist}</h1>
            <div className="mt-[6px] font-mono text-[12px] text-dim">{p.subtitle}</div>
            <div className="my-3 flex flex-wrap gap-[6px]">
              {p.roles.map((r) => (
                <RoleChip key={r}>{r}</RoleChip>
              ))}
            </div>
            <p className="m-0 max-w-[76ch] text-pretty text-daw-text">{p.desc}</p>
          </div>
        </div>

        <ProjectLab p={p} />

        {p.vimeo ? (
          <div className="mb-5">
            <div className="mb-2 font-mono text-[11px] tracking-[0.1em] text-faint uppercase">campaign videos</div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
              {p.vimeo.map((v) => (
                <iframe
                  key={v.src}
                  className="w-full rounded-[4px] border border-line bg-black"
                  style={{ aspectRatio: v.ratio }}
                  src={v.src}
                  allowFullScreen
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  loading="lazy"
                  title="campaign video"
                />
              ))}
            </div>
          </div>
        ) : null}

        {disco.length ? (
          <div className="flex flex-col gap-[22px]">
            <DiscoGroup label="singles / EPs" items={singles} />
            <DiscoGroup label="albums" items={albums} />
            <DiscoGroup label="works" items={general} />
          </div>
        ) : !p.vimeo && p.id !== "jlm" ? (
          <p className="font-mono text-[12px] text-faint">discography coming soon.</p>
        ) : null}
      </div>
    </section>
  );
}
