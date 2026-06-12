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

function DiscoRow({ d }: { d: DiscoEntry }) {
  return (
    <div className="grid grid-cols-[52px_1fr_auto_auto] items-center gap-3 rounded-[4px] border border-line bg-panel py-2 pr-3 pl-2 transition-[border-color] duration-150 hover:border-line2">
      <img className="h-[52px] w-[52px] rounded-[2px] object-cover" src={d.art} alt={d.title} loading="lazy" />
      <span className="min-w-0 overflow-hidden text-[13.5px] font-semibold text-ellipsis whitespace-nowrap">
        {d.title}
      </span>
      <span className="rounded-[2px] border border-line2 px-[6px] py-[2px] font-mono text-[9.5px] tracking-[0.08em] text-dim uppercase">
        {d.type}
      </span>
      <PlatformLinks links={d.links} />
    </div>
  );
}

export function DiscoGroup({ label, items }: { label: string; items: DiscoEntry[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] tracking-[0.1em] text-faint uppercase">
        {label} · {items.length}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-2 max-[760px]:grid-cols-1">
        {items.map((d) => (
          <DiscoRow key={d.title} d={d} />
        ))}
      </div>
    </div>
  );
}
