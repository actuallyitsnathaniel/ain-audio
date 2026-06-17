import { useEffect, useState } from "react";
import spotifyIcon from "/src/assets/images/icons/music-platforms/spotify.svg";
import appleIcon from "/src/assets/images/icons/music-platforms/apple-music.svg";
import tidalIcon from "/src/assets/images/icons/music-platforms/tidal.svg";
import youtubeIcon from "/src/assets/images/icons/music-platforms/youtube.svg";
import soundcloudIcon from "/src/assets/images/icons/music-platforms/soundcloud.svg";
import type { DiscoEntry, PlatformLinkSet } from "../data/discography";

const PLATFORM_ICONS: Record<keyof PlatformLinkSet, string> = {
  spotify: spotifyIcon,
  apple: appleIcon,
  tidal: tidalIcon,
  youtube: youtubeIcon,
  soundcloud: soundcloudIcon,
};
const PLATFORM_NAMES: Record<keyof PlatformLinkSet, string> = {
  spotify: "Spotify",
  apple: "Apple Music",
  tidal: "Tidal",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
};

export function PlatformLinks({ links }: { links: PlatformLinkSet }) {
  const keys = Object.keys(links || {}) as (keyof PlatformLinkSet)[];
  if (!keys.length) return null;
  return (
    <span className="flex gap-[5px]">
      {keys.map((k) => (
        <a
          key={k}
          className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-line bg-panel2 transition-[border-color,transform] duration-150 hover:-translate-y-[1px] hover:border-dim"
          href={links[k]}
          target="_blank"
          rel="noopener noreferrer"
          title={PLATFORM_NAMES[k]}
          aria-label={PLATFORM_NAMES[k]}
        >
          <img src={PLATFORM_ICONS[k]} alt={PLATFORM_NAMES[k]} className="h-[15px] w-[15px]" />
        </a>
      ))}
    </span>
  );
}

const typeChip =
  "rounded-[2px] border border-line2 px-[6px] py-[2px] font-mono text-[9.5px] tracking-[0.08em] text-dim uppercase";

function DiscoRow({ d, onOpen }: { d: DiscoEntry; onOpen: (d: DiscoEntry) => void }) {
  return (
    <div className="grid grid-cols-[64px_1fr_auto_auto] items-center gap-3 rounded-[4px] border border-line bg-panel py-2 pr-3 pl-2 transition-[border-color] duration-150 hover:border-line2">
      <button
        className="group relative overflow-hidden rounded-[2px]"
        onClick={() => onOpen(d)}
        aria-label={"view " + d.title}
        title="view cover"
      >
        <img
          className="h-[64px] w-[64px] object-cover transition-transform duration-200 group-hover:scale-[1.06]"
          src={d.art}
          alt={d.title}
          loading="lazy"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 font-mono text-[14px] text-transparent transition-colors duration-150 group-hover:bg-black/45 group-hover:text-white">
          ⤢
        </span>
      </button>
      <button
        className="min-w-0 cursor-pointer text-left text-[13.5px] font-semibold transition-colors duration-150 hover:text-accent"
        onClick={() => onOpen(d)}
      >
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{d.title}</span>
      </button>
      <span className={typeChip}>{d.type}</span>
      <PlatformLinks links={d.links} />
    </div>
  );
}

// Full-size cover + metadata in a centered modal. Reuses the backdrop / scroll-lock /
// Escape pattern from ProjectsSection's DetailSheet.
function ReleaseLightbox({ d, onClose }: { d: DiscoEntry; onClose: () => void }) {
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={d.title}>
      <button
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px] motion-safe:animate-[fade-in_.18s_ease]"
        aria-label="close"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-[420px] overflow-y-auto rounded-[8px] border border-line2 bg-panel motion-safe:animate-[fade-in_.2s_ease]">
        <button
          className="absolute top-2 right-2 z-[1] flex h-8 w-8 items-center justify-center rounded-[4px] border border-line2 bg-panel/80 text-dim backdrop-blur transition-colors hover:border-dim hover:text-daw-text"
          aria-label="close"
          onClick={onClose}
        >
          ✕
        </button>
        <img className="aspect-square w-full object-cover" src={d.art} alt={d.title} />
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="m-0 text-[18px] leading-tight font-bold text-pretty">{d.title}</h3>
            <span className={typeChip + " shrink-0"}>{d.type}</span>
          </div>
          {d.note ? <p className="m-0 text-[13px] leading-[1.6] text-pretty text-daw-text">{d.note}</p> : null}
          <PlatformLinks links={d.links} />
        </div>
      </div>
    </div>
  );
}

export function DiscoGroup({ label, items }: { label: string; items: DiscoEntry[] }) {
  const [open, setOpen] = useState<DiscoEntry | null>(null);
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] tracking-[0.1em] text-faint uppercase">
        {label} · {items.length}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-2 max-[760px]:grid-cols-1">
        {items.map((d) => (
          <DiscoRow key={d.title} d={d} onOpen={setOpen} />
        ))}
      </div>
      {open ? <ReleaseLightbox d={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
