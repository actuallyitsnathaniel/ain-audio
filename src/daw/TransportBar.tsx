import { useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { engine } from "./engine";
import { jlmTrack } from "./data/tracks";
import { useEngine } from "./hooks/useEngine";
import { useRafLoop } from "./hooks/useRafLoop";
import { scrollToId } from "./lab-utils";

const NAV = [
  { id: "projects", label: "projects", num: "01" },
  { id: "audiolab", label: "audio lab", num: "02" },
  { id: "press", label: "press", num: "03" },
  { id: "contact", label: "contact", num: "04" },
];

// Top-bar play/pause + time readout, with a hover tooltip showing the current
// track and play state.
function MiniTransport() {
  const ref = useRef<HTMLSpanElement>(null);
  const eng = useEngine(["state", "track"]);
  useRafLoop(() => {
    if (!ref.current) return;
    const p = engine.getPosition();
    const m = Math.floor(p / 60),
      s = Math.floor(p % 60),
      cs = Math.floor((p % 1) * 10);
    ref.current.textContent = m + ":" + String(s).padStart(2, "0") + "." + cs;
  });
  const cur = eng.track || jlmTrack;
  return (
    <div className="group relative flex h-8 items-center gap-2.5 rounded-[3px] border border-line bg-inset px-3">
      <button
        className="flex h-5.5 w-5.5 items-center justify-center"
        onClick={() => engine.toggle()}
        aria-label="play / pause"
      >
        {eng.loading ? (
          <span className="play-spinner small" />
        ) : eng.playing ? (
          <span className="icon-pause small" />
        ) : (
          <span className="icon-play small" />
        )}
      </button>
      <span className="min-w-14.5 font-mono text-[12px] text-accent" ref={ref}>
        0:00.0
      </span>
      <span className="pointer-events-none absolute top-[calc(100%+9px)] left-0 z-60 hidden whitespace-nowrap rounded-[3px] border border-line2 bg-panel2 px-[10px] py-[6px] font-mono text-[11px] text-daw-text shadow-[0_6px_20px_-8px_rgba(0,0,0,0.8)] group-hover:block">
        ▸ {cur ? cur.title : "—"} ·{" "}
        {eng.loading ? "loading" : eng.playing ? "playing" : "paused"}
      </span>
    </div>
  );
}

function CpuMeter() {
  const ref = useRef<HTMLSpanElement>(null);
  const acc = useRef<{ last: number; avg: number } | null>(null);
  useRafLoop(() => {
    const now = performance.now();
    if (!acc.current) acc.current = { last: now, avg: 16.7 };
    const dt = now - acc.current.last;
    acc.current.last = now;
    acc.current.avg = acc.current.avg * 0.95 + dt * 0.05;
    if (ref.current) {
      const pct = Math.min(
        99,
        Math.max(1, Math.round((acc.current.avg / 16.7) * 8)),
      );
      ref.current.textContent = String(pct) + "%";
    }
  });
  return (
    <span
      className="rounded-[3px] border border-line px-2 py-1 font-mono text-[11px] whitespace-nowrap text-faint max-[760px]:hidden"
      title="yes, it's real frame timing"
    >
      cpu <span ref={ref}>8%</span>
    </span>
  );
}

export function TransportBar() {
  const navigate = useNavigate();
  const location = useLocation();

  // On the home route, scroll to the section; from a project page, navigate home then scroll.
  const goToSection = (id: string) => {
    if (location.pathname !== "/") {
      navigate("/");
      setTimeout(() => scrollToId(id), 90);
    } else {
      scrollToId(id);
    }
  };

  return (
    <header className="tbar-bg fixed top-0 right-0 left-0 z-50 flex h-13 items-center gap-5 border-b border-line px-4 max-[760px]:gap-[10px] max-[760px]:overflow-x-auto">
      <button
        className="flex items-center gap-2.25"
        onClick={() => {
          if (location.pathname !== "/") navigate("/");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        <span className="h-3.5 w-3.5 rounded-xs bg-accent" />
        <span className="font-mono text-[12px] font-semibold tracking-[0.14em]">
          AIN·AUDIO
        </span>
      </button>
      <MiniTransport />
      <nav className="ml-auto flex gap-0.5 max-[760px]:gap-0">
        {NAV.map((n) => (
          <button
            key={n.id}
            className="rounded-[3px] px-2.5 py-1.5 font-mono text-[11px] tracking-[0.06em] whitespace-nowrap text-dim transition-[color,background] duration-150 hover:bg-panel2 hover:text-daw-text max-[760px]:px-[7px]"
            onClick={() => goToSection(n.id)}
          >
            <span className="mr-0.5 text-faint">{n.num}</span> {n.label}
          </button>
        ))}
      </nav>
      <CpuMeter />
    </header>
  );
}
