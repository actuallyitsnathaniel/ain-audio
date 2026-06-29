import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "./data/projects";
import { projects } from "./data/projects";
import { trackForProject } from "./data/tracks";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { RoleChip } from "./components/RoleChip";
import { SectionHead } from "./components/SectionHead";
import { TrackSection } from "./components/TrackSection";
import { loadLabEntry } from "./lab-utils";

function ClipCard({ p, active, onClick }: { p: Project; active: boolean; onClick: () => void }) {
  return (
    <button
      className={
        "group flex flex-col items-stretch overflow-hidden rounded-[4px] border bg-panel text-left transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-[2px] " +
        (active
          ? "border-[var(--clip)] shadow-[0_0_0_1px_var(--clip),0_8px_28px_-12px_color-mix(in_srgb,var(--clip)_55%,transparent)]"
          : "border-line hover:border-line2")
      }
      onClick={onClick}
      style={{ "--clip": p.color } as React.CSSProperties}
    >
      <span className="h-[5px] bg-[var(--clip)] opacity-85" />
      <span className="block">
        <img
          src={p.art}
          alt={p.artist}
          loading="lazy"
          className="aspect-square w-full object-cover saturate-90 transition-[filter] duration-200 group-hover:saturate-100"
        />
      </span>
      <span className="px-3 pt-[10px] pb-[1px] text-[15px] font-semibold">{p.artist}</span>
      <span className="px-3 pb-[11px] font-mono text-[10.5px] tracking-[0.04em] text-dim">{p.subtitle}</span>
    </button>
  );
}

const accentBtn =
  "inline-flex items-center gap-[9px] rounded-[3px] border border-accent bg-accent px-[18px] py-[11px] text-[13px] font-semibold whitespace-nowrap text-[#111] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)]";
const ghostBtn =
  "inline-flex items-center gap-[9px] rounded-[3px] border border-line2 bg-panel px-[18px] py-[11px] text-[13px] font-semibold whitespace-nowrap transition-[border-color,background] duration-150 hover:border-dim hover:bg-panel2";

// Shared inner content for both the desktop inline panel and the mobile sheet.
function DetailBody({ p, onAction }: { p: Project; onAction?: () => void }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="m-0 text-[21px] font-bold">{p.artist}</h3>
        <span className="font-mono text-[11px] text-dim">{p.subtitle}</span>
      </div>
      <div className="my-[10px] mb-3 flex flex-wrap gap-[6px]">
        {p.roles.map((r) => (
          <RoleChip key={r}>{r}</RoleChip>
        ))}
      </div>
      <p className="m-0 mb-[14px] max-w-[76ch] text-pretty text-daw-text">{p.desc}</p>
      <div className="flex flex-wrap gap-[10px]">
        <button
          className={accentBtn}
          onClick={() => {
            onAction?.();
            navigate("/projects/" + p.id);
          }}
        >
          open project page ▸
        </button>
        <button
          className={ghostBtn}
          onClick={() => {
            onAction?.();
            loadLabEntry(trackForProject(p));
          }}
        >
          ▹ send preview to lab
        </button>
      </div>
    </>
  );
}

// Desktop: detail panel injected as a full-width grid row right under the clicked
// card (col-span-full → CSS grid auto-placement starts it on a fresh row and reflows
// the cards after it, no column math). No cover art — the card above already shows
// it; this reads as that card unfolding into a detail strip.
function DetailPanel({ p, onClose }: { p: Project; onClose: () => void }) {
  return (
    <div
      className="mt-1 mb-[6px] grid grid-cols-[6px_1fr] overflow-hidden rounded-[4px] border border-[var(--clip)] bg-panel shadow-[0_8px_28px_-14px_color-mix(in_srgb,var(--clip)_55%,transparent)] motion-safe:animate-[fade-in_.18s_ease]"
      style={{ "--clip": p.color } as React.CSSProperties}
    >
      <div className="bg-[var(--clip)]" />
      <div className="relative min-w-0 px-[26px] py-[22px]">
        <button
          className="absolute top-[14px] right-[14px] flex h-7 w-7 items-center justify-center rounded-[4px] border border-line2 text-dim transition-colors hover:border-dim hover:text-daw-text"
          aria-label="close detail"
          onClick={onClose}
        >
          ✕
        </button>
        <DetailBody p={p} />
      </div>
    </div>
  );
}

// Mobile: dismissible bottom sheet so the selection change is unmistakable.
function DetailSheet({ p, onClose }: { p: Project; onClose: () => void }) {
  // lock body scroll while the sheet is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={p.artist}>
      {/* backdrop */}
      <button
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px] motion-safe:animate-[fade-in_.18s_ease]"
        aria-label="close"
        onClick={onClose}
      />
      {/* sheet */}
      <div
        className="relative max-h-[85vh] overflow-y-auto rounded-t-[12px] border-t border-line2 bg-panel pb-[max(20px,env(safe-area-inset-bottom))] motion-safe:animate-[sheet-up_.24s_cubic-bezier(0.22,1,0.36,1)]"
        style={{ "--clip": p.color } as React.CSSProperties}
      >
        {/* accent strip + grab handle */}
        <div className="h-[5px] bg-[var(--clip)]" />
        <div className="sticky top-0 z-[1] flex items-center justify-between bg-panel/95 px-4 pt-3 pb-2 backdrop-blur">
          <span className="mx-auto h-1 w-10 rounded-full bg-line2" />
          <button
            className="absolute top-2 right-3 flex h-8 w-8 items-center justify-center rounded-[4px] border border-line2 text-dim transition-colors hover:border-dim hover:text-daw-text"
            aria-label="close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="flex gap-4 px-4 pt-1">
          <img
            className="h-24 w-24 flex-none rounded-[4px] border border-line object-cover"
            src={p.art}
            alt={p.artist}
          />
          <div className="min-w-0 flex-1">
            <DetailBody p={p} onAction={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectsSection() {
  // sel is nullable now: clicking the open card collapses it (accordion). On
  // mobile the sheet opens instead of the inline row.
  const [sel, setSel] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const selProject = projects.find((x) => x.id === sel) || null;
  const selIdx = projects.findIndex((x) => x.id === sel); // -1 when none

  // Live column count of the auto-fill grid. The inline detail panel spans the
  // full width, so to keep the selected card's row intact we inject it after the
  // LAST card of that row (not after the card itself) — that needs the column
  // count, which changes as the grid reflows. Read it off the computed
  // grid-template-columns and keep it current with a ResizeObserver.
  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const tpl = getComputedStyle(el).gridTemplateColumns;
      setCols(tpl ? tpl.split(" ").length : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // index of the last card in the selected card's row (desktop accordion anchor)
  const rowEndIdx = selIdx < 0 ? -1 : Math.min(projects.length - 1, Math.floor(selIdx / cols) * cols + cols - 1);

  const onSelect = (id: string) => {
    if (isMobile) {
      setSel(id);
      setSheetOpen(true);
      return;
    }
    setSel((cur) => (cur === id ? null : id)); // toggle on desktop
  };

  return (
    <TrackSection id="projects" label="projects" rail="01">
      <SectionHead num="01" title="projects" sub={projects.length + " clips · tap to load"} />
      <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-[10px] max-[767px]:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] max-[767px]:gap-[7px]">
        {projects.map((proj, i) => (
          <Fragment key={proj.id}>
            <ClipCard p={proj} active={proj.id === sel} onClick={() => onSelect(proj.id)} />
            {/* desktop: inline detail injected after the LAST card of the selected
                row so that row stays full and the rest reflow below the panel */}
            {selProject && i === rowEndIdx ? (
              <div className="col-span-full max-[767px]:hidden">
                <DetailPanel p={selProject} onClose={() => setSel(null)} />
              </div>
            ) : null}
          </Fragment>
        ))}
      </div>

      {/* mobile sheet */}
      {isMobile && sheetOpen && selProject ? <DetailSheet p={selProject} onClose={() => setSheetOpen(false)} /> : null}
    </TrackSection>
  );
}
