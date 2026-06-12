import { engine } from "../engine";
import { useEngine } from "../hooks/useEngine";

export function PlayButton({ size = 44 }: { size?: number }) {
  const eng = useEngine(["state"]);
  return (
    <button
      className="flex flex-none items-center justify-center rounded-[3px] bg-accent text-[#111] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)]"
      style={{ width: size, height: size }}
      onClick={() => engine.toggle()}
      aria-label={eng.playing ? "pause" : "play"}
    >
      {eng.loading ? (
        <span className="play-spinner" />
      ) : eng.playing ? (
        <span className="icon-pause" />
      ) : (
        <span className="icon-play" />
      )}
    </button>
  );
}
