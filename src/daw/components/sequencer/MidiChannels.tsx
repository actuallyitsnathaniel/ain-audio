// ── MIDI CHANNELS — melodic piano-roll lanes inside the beat maker ──────────
// Each channel is its own instrument (a sampled preset or JS-synth patch) plus
// its own note clip, played on the SAME transport/clock as the drum grid. The
// grid is the shared PianoRoll bound to the channel via its `channelId` prop.
// Channels are nameable, collapsible (fold the roll, keep the header), loopable
// over their own clip length, and show a playback-position marker.
// Adding past SOFT_CHANNELS warns weaker machines; MAX_CHANNELS is a hard cap so
// a dense pattern can't spawn unbounded voices.

import { useRef, useState } from "react";
import { engine, SOFT_CHANNELS, MAX_CHANNELS } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { cloneClip, clipBeats, type MidiChannel, type NoteClip } from "../../data/clips";
import { PianoRoll } from "../piano-roll/PianoRoll";
import { Knob } from "../Knob";
import { requestMidiEnable } from "../midi-gate-bus";
import { openContextMenu } from "../context-menu-bus";

const CLIP_SLOTS_KEY = "ain-channel-clips"; // localStorage: { slotName: NoteClip }
const readClipSlots = (): Record<string, NoteClip> => {
  try {
    return JSON.parse(localStorage.getItem(CLIP_SLOTS_KEY) || "{}");
  } catch {
    return {};
  }
};

// per-channel phrase save/load — stash/recall just this channel's clip, independent
// of the whole sequence (mirrors the drum pattern slots in SequencerTransport).
function ChannelClipSlots({ channelId, canvasEl }: { channelId: string; canvasEl: () => HTMLCanvasElement | null }) {
  const [slots, setSlots] = useState<Record<string, NoteClip>>(readClipSlots);
  const [slot, setSlot] = useState("");
  const names = Object.keys(slots).sort();

  const persist = (next: Record<string, NoteClip>) => {
    localStorage.setItem(CLIP_SLOTS_KEY, JSON.stringify(next));
    setSlots(next);
  };
  const save = () => {
    const clip = engine.getChannelClip(channelId);
    if (!clip) return;
    const name = (slot || window.prompt("save phrase as", "phrase " + (names.length + 1)) || "").trim();
    if (!name) return;
    persist({ ...slots, [name]: cloneClip(clip) });
    setSlot(name);
  };
  const load = () => {
    const clip = slots[slot];
    if (!clip) return;
    const copy = cloneClip(clip);
    engine.setChannelClip(channelId, copy);
    canvasEl()?.dispatchEvent(new CustomEvent("pr-load", { detail: copy })); // reload the live roll
  };
  const del = () => {
    if (!slots[slot]) return;
    const next = { ...slots };
    delete next[slot];
    persist(next);
    setSlot("");
  };

  const btn = "rounded-[3px] border border-line2 px-[8px] py-[3px] font-mono text-[9px] tracking-[0.05em] text-dim transition-colors hover:border-accent hover:text-accent";
  return (
    <div className="flex items-center gap-[5px]">
      <span className="font-mono text-[8.5px] tracking-[0.08em] text-faint">phrase</span>
      <span className="relative inline-flex items-center">
        <select
          value={slot}
          onChange={(e) => setSlot(e.target.value)}
          aria-label="channel phrase slot"
          className="cursor-pointer appearance-none rounded-[3px] border border-line2 bg-panel2 py-[3px] pr-[20px] pl-[8px] font-mono text-[9.5px] text-daw-text hover:border-accent focus:border-accent focus:outline-none"
        >
          <option value="" className="bg-panel2 text-daw-text">
            {names.length ? "— recall —" : "no saves"}
          </option>
          {names.map((n) => (
            <option key={n} value={n} className="bg-panel2 text-daw-text">
              {n}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-[7px] text-[7px] text-faint">▼</span>
      </span>
      <button onClick={save} className={btn} title="save this channel's phrase to a slot">
        save
      </button>
      <button onClick={load} className={btn + (slots[slot] ? "" : " pointer-events-none opacity-40")} title="load the selected phrase">
        load
      </button>
      <button onClick={del} className={btn + (slots[slot] ? "" : " pointer-events-none opacity-40")} title="delete the selected phrase">
        del
      </button>
    </div>
  );
}

const selectCls =
  "cursor-pointer appearance-none rounded-[3px] border border-line2 bg-panel2 py-[4px] pr-[22px] pl-[9px] font-mono text-[10.5px] tracking-[0.03em] text-daw-text transition-colors hover:border-accent focus:border-accent focus:outline-none";

const chip = (active: boolean, accent: boolean) =>
  "rounded-[3px] border px-[7px] py-[3px] font-mono text-[9px] tracking-[0.06em] transition-colors " +
  (active
    ? accent
      ? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent"
      : "border-[color-mix(in_srgb,#e0654f_60%,transparent)] bg-[color-mix(in_srgb,#e0654f_22%,transparent)] text-[#e98c79]"
    : "border-line text-faint hover:text-dim");

// thin imperative position marker — accent line sweeping the channel's loop span
// (no per-frame React render; mirrors the StepGrid playhead pattern).
function ChannelMarker({ ch }: { ch: MidiChannel }) {
  const fill = useRef<HTMLDivElement>(null);
  useRafLoop(() => {
    const el = fill.current;
    if (!el) return;
    const pos = engine.channelPosition(ch.id); // beats into the channel's loop, or -1
    const span = ch.loop ? clipBeats(ch.clip) : 0;
    if (pos < 0 || span <= 0) {
      el.style.opacity = "0";
      return;
    }
    el.style.opacity = "1";
    el.style.left = `${(pos / span) * 100}%`;
  });
  return (
    <span className="relative h-[8px] w-[60px] shrink-0 overflow-hidden rounded-[2px] border border-line bg-[#0c0c10]" title="playback position">
      <span ref={fill} className="absolute top-0 bottom-0 w-[2px] bg-accent shadow-[0_0_5px_var(--accent)]" style={{ opacity: 0 }} />
    </span>
  );
}

function ChannelRow({ ch, armed, onArm }: { ch: MidiChannel; armed: boolean; onArm: (id: string | null) => void }) {
  const eng = useEngine(["clip", "preset"]);
  const [editing, setEditing] = useState(false);
  const rollWrap = useRef<HTMLDivElement>(null);
  const canvasEl = () => rollWrap.current?.querySelector("canvas") || null;
  const collapsed = !!ch.collapsed;

  // change the loop length, then reload the roll so its visible grid width follows
  const setLength = (bars: number) => {
    engine.setChannelLength(ch.id, bars);
    const clip = engine.getChannelClip(ch.id);
    if (clip) canvasEl()?.dispatchEvent(new CustomEvent("pr-load", { detail: cloneClip(clip) }));
  };

  // right-click the channel header → lane actions (the inner piano roll has its
  // own note menu). Shift+right-click falls through to the browser menu.
  const headerMenu = (e: React.MouseEvent) => {
    if (e.shiftKey) return;
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: "channel: " + ch.name,
      items: [
        { label: armed ? "disarm" : "arm for keyboard", onClick: () => onArm(armed ? null : ch.id) },
        { label: ch.mute ? "unmute" : "mute", onClick: () => engine.toggleChannelMute(ch.id) },
        { label: ch.solo ? "unsolo" : "solo", onClick: () => engine.toggleChannelSolo(ch.id) },
        { separator: true },
        { label: ch.loop ? "loop off" : "loop on", onClick: () => engine.toggleChannelLoop(ch.id) },
        { label: collapsed ? "expand" : "collapse", onClick: () => engine.toggleChannelCollapsed(ch.id) },
        { label: "rename…", onClick: () => setEditing(true) },
        { separator: true },
        { label: "remove channel", danger: true, onClick: () => engine.removeChannel(ch.id) },
        { separator: true },
        { label: "browser menu", hint: "⇧right-click", disabled: true },
      ],
    });
  };

  return (
    <div
      className={
        "flex flex-col gap-[6px] rounded-[4px] border bg-[#101014] p-[10px] transition-colors " +
        (armed ? "border-[color-mix(in_srgb,var(--accent)_70%,transparent)]" : "border-line")
      }
    >
      <div className="flex flex-wrap items-center gap-[8px]" onContextMenu={headerMenu}>
        <button
          onClick={() => engine.toggleChannelCollapsed(ch.id)}
          title={collapsed ? "expand" : "collapse"}
          className="font-mono text-[10px] text-faint transition-colors hover:text-accent"
          aria-label={collapsed ? "expand channel" : "collapse channel"}
        >
          {collapsed ? "▸" : "▾"}
        </button>

        {editing ? (
          <input
            autoFocus
            defaultValue={ch.name}
            onBlur={(e) => {
              engine.renameChannel(ch.id, e.target.value.trim() || ch.name);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-[96px] rounded-[3px] border border-accent bg-panel2 px-[6px] py-[2px] font-mono text-[10px] tracking-[0.05em] text-daw-text focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            title="rename channel"
            className="min-w-[60px] text-left font-mono text-[10px] tracking-[0.05em] text-dim transition-colors hover:text-daw-text"
          >
            {ch.name}
          </button>
        )}

        <button
          onClick={() => onArm(armed ? null : ch.id)}
          title={armed ? "armed — keyboard plays this channel (click to disarm)" : "arm: route the keyboard to this channel"}
          className={"flex items-center gap-[5px] " + chip(armed, true)}
        >
          <span className={"h-[6px] w-[6px] rounded-full " + (armed ? "bg-accent shadow-[0_0_6px_var(--accent)]" : "bg-faint")} />
          {armed ? "ARMED" : "arm"}
        </button>

        <span className="relative inline-flex items-center">
          <select value={ch.presetId} onChange={(e) => engine.setChannelPreset(ch.id, e.target.value)} aria-label={`${ch.name} instrument`} className={selectCls}>
            {eng.samplePresets.map((p) => (
              <option key={p.id} value={p.id} className="bg-panel2 text-daw-text">
                {p.name}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-[8px] text-[8px] text-faint">▼</span>
        </span>

        <span className="ml-auto flex items-center gap-[8px]">
          <Knob value={ch.vol ?? 0.8} min={0} max={1} defaultValue={0.8} size={30} onChange={(v) => engine.setChannelVol(ch.id, v)} label="vol" fmt={(v) => Math.round(v * 100) + "%"} />
          <Knob value={ch.pan ?? 0} min={-1} max={1} defaultValue={0} size={30} onChange={(v) => engine.setChannelPan(ch.id, v)} label="pan" fmt={(v) => (Math.abs(v) < 0.04 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100))} />
          <ChannelMarker ch={ch} />
          <button onClick={() => engine.toggleChannelLoop(ch.id)} title={ch.loop ? "loop on — repeats over this clip's length" : "loop off — plays through once per grid cycle"} className={chip(ch.loop, true)}>
            ↻ loop
          </button>
          <span className="flex items-center rounded-[3px] border border-line" title="loop length (bars)">
            <button onClick={() => setLength(ch.clip.bars - 1)} className="px-[5px] py-[2px] font-mono text-[10px] text-faint transition-colors hover:text-accent" aria-label="shorter">
              −
            </button>
            <span className="min-w-[34px] text-center font-mono text-[9px] tabular-nums text-dim">{ch.clip.bars}bar</span>
            <button onClick={() => setLength(ch.clip.bars + 1)} className="px-[5px] py-[2px] font-mono text-[10px] text-faint transition-colors hover:text-accent" aria-label="longer">
              +
            </button>
          </span>
          <button onClick={() => engine.toggleChannelMute(ch.id)} title="mute" className={chip(ch.mute, false)}>
            M
          </button>
          <button onClick={() => engine.toggleChannelSolo(ch.id)} title="solo" className={chip(ch.solo, true)}>
            S
          </button>
          <button
            onClick={() => engine.removeChannel(ch.id)}
            title="remove channel"
            className="rounded-[3px] border border-line px-[7px] py-[3px] font-mono text-[10px] text-faint transition-colors hover:border-[#e0654f] hover:text-[#e98c79]"
          >
            ✕
          </button>
        </span>
      </div>
      {!collapsed && (
        <div ref={rollWrap} className="flex flex-col gap-[6px]">
          <ChannelClipSlots channelId={ch.id} canvasEl={canvasEl} />
          <PianoRoll height={170} channelId={ch.id} />
        </div>
      )}
    </div>
  );
}

export function MidiChannels() {
  const eng = useEngine(["clip", "preset", "midi"]);
  const channels = eng.sequence.channels;
  const atCap = channels.length >= MAX_CHANNELS;
  const warn = channels.length >= SOFT_CHANNELS; // warn about the *next* add

  // Arm the channel, and offer to connect MIDI for it. The shared MidiGate shows
  // the explainer modal (once) before the browser's own permission prompt; arming
  // itself doesn't depend on the MIDI answer (computer keys always work).
  const handleArm = (id: string | null) => {
    engine.armChannel(id);
    if (id) requestMidiEnable();
  };

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10.5px] tracking-[0.1em] text-daw-text">MIDI CHANNELS</span>
        <button
          onClick={() => engine.addChannel()}
          disabled={atCap}
          title={atCap ? `max ${MAX_CHANNELS} channels` : "add a melodic channel"}
          className={
            "rounded-[3px] border px-[10px] py-[5px] font-mono text-[10.5px] transition-colors " +
            (atCap ? "border-line text-faint opacity-40" : "border-line text-dim hover:border-accent hover:text-accent")
          }
        >
          + add channel
        </button>
        {warn && (
          <span className="font-mono text-[9.5px] tracking-[0.03em] text-[#e0a24f]">
            {atCap ? `max ${MAX_CHANNELS} — weaker machines may struggle` : `${SOFT_CHANNELS}+ channels may strain weaker machines`}
          </span>
        )}
      </div>

      {channels.map((ch) => (
        <ChannelRow key={ch.id} ch={ch} armed={eng.armedChannel === ch.id} onArm={handleArm} />
      ))}
    </div>
  );
}
