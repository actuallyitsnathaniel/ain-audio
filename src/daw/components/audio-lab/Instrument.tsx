// ── INSTRUMENT — one unified panel: select · play · design ────────────────────
// Merges the old PRESET LAB + SYNTH. One instrument list (synth patches AND sampled
// presets, which are now patches), a playable keyboard, and the full patch editor —
// including a SAMPLE source section (loop/one-shot + level + the C4 waveform) since a
// sample is now just another oscillator into the shared filter → amp spine.

import { useEffect, useRef, useState } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { Knob } from "../Knob";
import { LabPanel } from "./LabPanel";
import { PresetKeyboard } from "../preset-lab";
import { requestMidiEnable } from "../midi-gate-bus";
import { WAVES, WAVE_GLYPH, fmtSec, lfoDepthMax, PL_KEYMAP } from "./synth-ui";
import { SampleWave } from "./SampleWave";
import { EnvGraph } from "./EnvGraph";
import { FilterGraph } from "./FilterGraph";
import type { ReactNode } from "react";
import type { SynthPatch } from "../../data/patches";

// a compact segmented selector
function Seg<T extends string>({ value, options, onChange, fmt }: { value: T; options: readonly T[]; onChange: (v: T) => void; fmt?: (v: T) => string }) {
  return (
    <span className="flex items-center gap-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          title={o}
          className={"rounded-[3px] border px-1.5 py-0.75 font-mono text-[10px] transition-colors " + (o === value ? "border-accent bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent" : "border-line text-faint hover:text-dim")}
        >
          {fmt ? fmt(o) : o}
        </button>
      ))}
    </span>
  );
}

// a labeled cluster of controls within a tab — a thin left rule + small header,
// no heavy card border (the tab dashboard is the frame). Tighter than the old card.
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-l border-line pl-2.5">
      <span className="font-mono text-[8.5px] tracking-[0.12em] text-faint uppercase">{title}</span>
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-1.5">{children}</div>
    </div>
  );
}

const TABS = [
  { id: "sources", label: "SOURCES" },
  { id: "filter", label: "FILTER" },
  { id: "amp", label: "AMP" },
  { id: "lfo", label: "LFO" },
  { id: "voices", label: "VOICES" },
] as const;

export function Instrument({ enableTypingKeys = true }: { enableTypingKeys?: boolean } = {}) {
  const eng = useEngine(["patch", "synth", "preset", "midi", "transport"]);
  const id = eng.synthPatch;
  const p: SynthPatch = eng.currentPatch();
  const builtin = eng.isBuiltinPatch(id);
  const midiStatus = eng.midiStatus;
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"sources" | "filter" | "amp" | "lfo" | "voices">("sources");

  // computer-keyboard state (Ableton convention): Z/X octave, C/V velocity.
  // Studio ArrangementPage owns typing keys when `enableTypingKeys` is false (M toggle)
  // — then oct/vel chips read engine.midiOctave / midiVel instead.
  const [localOctave, setLocalOctave] = useState(0);
  const [localVel, setLocalVel] = useState(0.85);
  const octaveRef = useRef(0);
  const velRef = useRef(0.85);
  const octave = enableTypingKeys ? localOctave : eng.midiOctave;
  const vel = enableTypingKeys ? localVel : eng.midiVel;
  useEffect(() => {
    octaveRef.current = octave;
    velRef.current = vel;
  }, [octave, vel]);
  useEffect(() => {
    if (!enableTypingKeys) return;
    const held: Record<string, number> = {};
    const dn = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      const tag = (target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === "z") return setLocalOctave((o) => Math.max(-3, o - 1));
      if (key === "x") return setLocalOctave((o) => Math.min(3, o + 1));
      if (key === "c") return setLocalVel((v) => Math.max(0.1, Math.round((v - 0.1) * 100) / 100));
      if (key === "v") return setLocalVel((v) => Math.min(1, Math.round((v + 0.1) * 100) / 100));
      const base = PL_KEYMAP[key];
      if (base !== undefined && held[key] === undefined) {
        const m = base + octaveRef.current * 12;
        held[key] = m;
        engine.noteOn(m, velRef.current);
      }
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (held[key] !== undefined) {
        engine.noteOff(held[key]);
        delete held[key];
      }
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, [enableTypingKeys]);

  const u = (partial: Parameters<typeof engine.updateActivePatch>[0]) => engine.updateActivePatch(partial);
  // voicing (poly/mono + unison): read with UX-friendly defaults so raising the voices
  // knob on an old patch gets a musical detune/width; ALWAYS write the full object
  // (deepMerge over an absent `voices` would store a partial otherwise).
  const vc = p.voices ?? {
    mode: "poly" as const,
    unison: 1,
    detune: 14,
    width: 0.6,
    phase: 0,
  };
  const uv = (patch: Partial<NonNullable<SynthPatch["voices"]>>) => u({ voices: { ...vc, ...patch } } as Parameters<typeof engine.updateActivePatch>[0]);
  const humanizeOn = eng.audioPrefs.voiceHumanize;
  // partial merge of the (guaranteed-present) sample source — deepMerge keeps the rest.
  // `sample?` on SynthPatch defeats DeepPartial's object-narrowing, so cast the shape.
  const us = (partial: Partial<import("../../data/patches").SampleSource>) => u({ sample: partial } as Parameters<typeof engine.updateActivePatch>[0]);
  // add / remove the sample source (points at a sampled preset; C4 waveform shows it)
  const sampleOn = !!(p.sample && p.sample.level > 0);
  const firstPreset = engine.samplePresets.find((pr) => pr.zones.length > 0)?.id || "";

  // ── header: one instrument selector + patch bar + oct/vel/midi chips ──
  const controls = (
    <>
      <span className="relative inline-flex items-center">
        <select
          value={id}
          onChange={(e) => engine.setSynthPatch(e.target.value)}
          aria-label="instrument"
          className="cursor-pointer appearance-none rounded-[3px] border border-line2 bg-panel2 py-1.25 pr-6 pl-2.5 font-mono text-[11px] tracking-[0.03em] text-daw-text hover:border-accent focus:border-accent focus:outline-none"
        >
          {eng.synthPatches.map((n) => (
            <option key={n} value={n} className="bg-panel2 text-daw-text">
              {n}
              {eng.isBuiltinPatch(n) ? "" : " ·"}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2.25 text-[8px] text-faint">▼</span>
      </span>
      {builtin && <span className="font-mono text-[9px] tracking-[0.05em] text-faint">factory</span>}

      {saving ? (
        <input
          autoFocus
          placeholder="patch name"
          onBlur={(e) => {
            if (e.target.value.trim()) engine.saveUserPatch(e.target.value);
            setSaving(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setSaving(false);
          }}
          className="w-30 rounded-[3px] border border-accent bg-panel2 px-1.75 py-1 font-mono text-[10.5px] text-daw-text focus:outline-none"
        />
      ) : (
        <span className="flex items-center gap-1.5">
          {!builtin && (
            <button onClick={() => engine.saveUserPatch(id)} title="save changes" className="rounded-[3px] border border-line px-2.25 py-1 font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent">
              save
            </button>
          )}
          <button onClick={() => setSaving(true)} title="save as a new patch" className="rounded-[3px] border border-line px-2.25 py-1 font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent">
            save as
          </button>
          {builtin ? (
            <button onClick={() => engine.revertPatch(id)} title="restore factory sound" className="rounded-[3px] border border-line px-2.25 py-1 font-mono text-[10px] text-faint transition-colors hover:text-dim">
              revert
            </button>
          ) : (
            <button onClick={() => engine.deleteUserPatch(id)} title="delete this patch" className="rounded-[3px] border border-line px-2.25 py-1 font-mono text-[10px] text-faint transition-colors hover:border-[#e0654f] hover:text-[#e98c79]">
              delete
            </button>
          )}
        </span>
      )}

      <span className="ml-auto flex items-center gap-1.5">
        <span className="rounded-[3px] border border-line px-2 py-1 font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap text-faint" title="Z / X shift the typing-keyboard octave">
          oct <span className={"text-accent " + (octave !== 0 ? "" : "opacity-60")}>{octave >= 0 ? "+" + octave : octave}</span>
        </span>
        <span className="rounded-[3px] border border-line px-2 py-1 font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap text-faint" title="C / V lower / raise the typing-keyboard velocity">
          vel <span className="text-accent">{Math.round(vel * 127)}</span>
        </span>
        <button
          onClick={() => requestMidiEnable()}
          className={
            "rounded-[3px] border px-2 py-1 font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap transition-colors " +
            (eng.hasMidiInput
              ? "border-[color-mix(in_srgb,var(--accent)_50%,transparent)] text-accent"
              : midiStatus === "idle"
                ? "border-line text-faint hover:border-accent hover:text-accent"
                : "border-line text-faint hover:border-accent hover:text-dim")
          }
          title={
            midiStatus === "idle"
              ? "click to connect a MIDI controller"
              : "Web MIDI — click to reconnect / re-scan devices"
          }
        >
          midi: {midiStatus === "idle" ? "connect" : midiStatus}
        </button>
      </span>
    </>
  );

  return (
    <LabPanel title="INSTRUMENT" controls={controls}>
      <PresetKeyboard octave={octave} vel={vel} />

      {/* tabbed synth dashboard — one signal-flow stage at a time */}
      <div className="flex items-center gap-0.75 border-b border-line pb-1.5">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={
              "rounded-[3px] px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] transition-colors " +
              (tab === tb.id ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent" : "text-faint hover:text-dim")
            }
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-3 rounded-sm border border-line bg-[#0e0e12] p-3">
        {tab === "sources" && (
          <>
            <Group title="osc a">
              <Seg value={p.osc1.wave} options={WAVES} onChange={(w) => u({ osc1: { wave: w } })} fmt={(w) => WAVE_GLYPH[w]} />
              <Knob size={34} label="semi" value={p.osc1.semi} min={-24} max={24} defaultValue={0} bipolar onChange={(v) => u({ osc1: { semi: Math.round(v) } })} fmt={(v) => (Math.round(v) > 0 ? "+" : "") + Math.round(v)} />
              <Knob size={34} label="fine" value={p.osc1.cents} min={-50} max={50} defaultValue={0} bipolar onChange={(v) => u({ osc1: { cents: Math.round(v) } })} fmt={(v) => Math.round(v) + "c"} />
              <Knob size={34} label="level" value={p.osc1.level} min={0} max={1} defaultValue={1} onChange={(v) => u({ osc1: { level: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
            </Group>
            <Group title="osc b">
              <button onClick={() => u({ osc2On: !p.osc2On })} title="toggle osc b" className={"rounded-[3px] border px-1.5 py-0.75 font-mono text-[9px] transition-colors " + (p.osc2On ? "border-accent text-accent" : "border-line text-faint")}>
                {p.osc2On ? "on" : "off"}
              </button>
              <Seg value={p.osc2.wave} options={WAVES} onChange={(w) => u({ osc2: { wave: w } })} fmt={(w) => WAVE_GLYPH[w]} />
              <Knob size={34} label="semi" value={p.osc2.semi} min={-24} max={24} defaultValue={0} bipolar onChange={(v) => u({ osc2: { semi: Math.round(v) } })} fmt={(v) => (Math.round(v) > 0 ? "+" : "") + Math.round(v)} />
              <Knob size={34} label="fine" value={p.osc2.cents} min={-50} max={50} defaultValue={6} bipolar onChange={(v) => u({ osc2: { cents: Math.round(v) } })} fmt={(v) => Math.round(v) + "c"} />
              <Knob size={34} label="level" value={p.osc2.level} min={0} max={1} defaultValue={1} onChange={(v) => u({ osc2: { level: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
            </Group>
            <Group title="sub">
              <Seg value={p.sub.wave} options={["sine", "square"] as const} onChange={(w) => u({ sub: { wave: w } })} fmt={(w) => WAVE_GLYPH[w]} />
              <Seg value={String(p.sub.oct) as "-1" | "-2"} options={["-1", "-2"] as const} onChange={(o) => u({ sub: { oct: Number(o) as -1 | -2 } })} fmt={(o) => o + " oct"} />
              <Knob size={34} label="level" value={p.sub.level} min={0} max={1} defaultValue={0} onChange={(v) => u({ sub: { level: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
            </Group>
            <Group title="noise">
              <Seg value={p.noise.type} options={["white", "pink"] as const} onChange={(t) => u({ noise: { type: t } })} />
              <Knob size={34} label="level" value={p.noise.level} min={0} max={1} defaultValue={0} onChange={(v) => u({ noise: { level: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
            </Group>
            <Group title="sample">
              <button
                onClick={() => u({ sample: { presetId: p.sample?.presetId || firstPreset, level: sampleOn ? 0 : 1, loop: p.sample?.loop ?? false } })}
                title="toggle the sample source"
                className={"rounded-[3px] border px-1.5 py-0.75 font-mono text-[9px] transition-colors " + (sampleOn ? "border-accent text-accent" : "border-line text-faint")}
              >
                {sampleOn ? "on" : "off"}
              </button>
              <span className="relative inline-flex items-center">
                <select
                  value={p.sample?.presetId || firstPreset}
                  onChange={(e) => u({ sample: { presetId: e.target.value, level: p.sample?.level ?? 1, loop: p.sample?.loop ?? false } })}
                  aria-label="sample preset"
                  className="cursor-pointer appearance-none rounded-xs border border-line2 bg-panel2 py-0.75 pr-4.5 pl-1.5 font-mono text-[9px] text-daw-text hover:border-accent focus:outline-none"
                >
                  {engine.samplePresets.filter((pr) => pr.zones.length > 0).map((pr) => (
                    <option key={pr.id} value={pr.id} className="bg-panel2">
                      {pr.name}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-1.25 text-[7px] text-faint">▼</span>
              </span>
              <span title="one-shot = play the bounce through (ignores note-off, like Ableton 1-Shot). loop = sustain until key up.">
                <Seg value={p.sample?.loop ? "loop" : "one-shot"} options={["one-shot", "loop"] as const} onChange={(m) => u({ sample: { presetId: p.sample?.presetId || firstPreset, level: p.sample?.level ?? 1, loop: m === "loop" } })} />
              </span>
              <Knob size={34} label="level" value={p.sample?.level ?? 0} min={0} max={4} defaultValue={0} onChange={(v) => u({ sample: { presetId: p.sample?.presetId || firstPreset, level: v, loop: p.sample?.loop ?? false } })} fmt={(v) => (v <= 0 ? "-∞" : (20 * Math.log10(v)).toFixed(1) + "dB")} />
              {sampleOn && p.sample?.loop && (
                <>
                  <button
                    onClick={() => us({ snap: p.sample!.snap === false })}
                    title="snap loop points to zero-crossings (click-free seam)"
                    className={"self-end rounded-[3px] border px-1.5 py-0.75 font-mono text-[9px] transition-colors " + (p.sample.snap !== false ? "border-accent text-accent" : "border-line text-faint")}
                  >
                    snap {p.sample.snap !== false ? "on" : "off"}
                  </button>
                  <Knob size={34} label="xfade" value={p.sample.xfade ?? 0} min={0} max={0.2} defaultValue={0} onChange={(v) => us({ xfade: v })} fmt={(v) => (v <= 0 ? "off" : Math.round(v * 1000) + "ms")} />
                </>
              )}
              {sampleOn && p.sample && (
                <>
                  <Knob size={34} label="semi" value={p.sample.semi ?? 0} min={-24} max={24} defaultValue={0} bipolar onChange={(v) => us({ semi: Math.round(v) })} fmt={(v) => (Math.round(v) > 0 ? "+" : "") + Math.round(v)} />
                  <Knob size={34} label="fine" value={p.sample.cents ?? 0} min={-100} max={100} defaultValue={0} bipolar onChange={(v) => us({ cents: Math.round(v) })} fmt={(v) => Math.round(v) + "c"} />
                  <Knob size={34} label="start" value={p.sample.start ?? 0} min={0} max={1} defaultValue={0} onChange={(v) => us({ start: Math.min(v, (p.sample!.end ?? 1) - 0.01) })} fmt={(v) => Math.round(v * 100) + "%"} />
                  <Knob size={34} label="end" value={p.sample.end ?? 1} min={0} max={1} defaultValue={1} onChange={(v) => us({ end: Math.max(v, (p.sample!.start ?? 0) + 0.01) })} fmt={(v) => Math.round(v * 100) + "%"} />
                  <div className="mt-0.5 w-full min-w-55">
                    <SampleWave
                      presetId={p.sample.presetId}
                      loop={p.sample.loop}
                      start={p.sample.start}
                      end={p.sample.end}
                      loopStart={p.sample.loopStart}
                      loopEnd={p.sample.loopEnd}
                      onEdit={(e) => us(e)}
                    />
                  </div>
                </>
              )}
            </Group>
          </>
        )}

        {tab === "filter" && (
          <>
            <Group title="filter">
              <button
                onClick={() => u({ filter: { on: p.filter.on === false } })}
                title="bypass the filter (flat response)"
                className={"rounded-[3px] border px-1.5 py-0.75 font-mono text-[9px] transition-colors " + (p.filter.on !== false ? "border-accent text-accent" : "border-line text-faint")}
              >
                {p.filter.on !== false ? "on" : "off"}
              </button>
              <Seg value={p.filter.type} options={["lowpass", "highpass", "bandpass", "notch"] as const} onChange={(t) => u({ filter: { type: t } })} fmt={(t) => t.slice(0, 2).toUpperCase()} />
              <Knob size={38} label="cutoff" value={p.filter.cut} min={40} max={18000} defaultValue={2200} disabled={p.filter.on === false} onChange={(v) => u({ filter: { cut: Math.round(v) } })} fmt={(v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + "")} />
              <Knob size={38} label="reso" value={p.filter.q} min={0.1} max={20} defaultValue={0.8} disabled={p.filter.on === false} onChange={(v) => u({ filter: { q: v } })} fmt={(v) => v.toFixed(1)} />
              <Knob size={34} label="ktrk" value={p.filter.keyTrack} min={0} max={1} defaultValue={0} disabled={p.filter.on === false} onChange={(v) => u({ filter: { keyTrack: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
              <div className={"mt-0.5 w-full min-w-55 " + (p.filter.on === false ? "opacity-40" : "")}>
                <FilterGraph type={p.filter.on === false ? "allpass" : p.filter.type} cut={p.filter.cut} q={p.filter.q} />
              </div>
            </Group>
            <Group title="filter env">
              <Knob size={34} label="amt" value={p.filtEnv.amt} min={-6000} max={9000} defaultValue={1800} bipolar onChange={(v) => u({ filtEnv: { amt: Math.round(v) } })} fmt={(v) => (v >= 1000 || v <= -1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + "")} />
              <Knob size={30} label="A" value={p.filtEnv.a} min={0.001} max={4} defaultValue={0.01} onChange={(v) => u({ filtEnv: { a: v } })} fmt={fmtSec} />
              <Knob size={30} label="D" value={p.filtEnv.d} min={0.005} max={4} defaultValue={0.5} onChange={(v) => u({ filtEnv: { d: v } })} fmt={fmtSec} />
              <Knob size={30} label="S" value={p.filtEnv.s} min={0} max={1} defaultValue={0.4} onChange={(v) => u({ filtEnv: { s: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
              <Knob size={30} label="R" value={p.filtEnv.r} min={0.005} max={6} defaultValue={0.4} onChange={(v) => u({ filtEnv: { r: v } })} fmt={fmtSec} />
              <div className="mt-0.5 w-full min-w-55">
                <EnvGraph a={p.filtEnv.a} d={p.filtEnv.d} s={p.filtEnv.s} r={p.filtEnv.r} />
              </div>
            </Group>
          </>
        )}

        {tab === "amp" && (
          <Group title="amp env">
            <Knob size={34} label="A" value={p.ampEnv.a} min={0.001} max={4} defaultValue={0.01} onChange={(v) => u({ ampEnv: { a: v } })} fmt={fmtSec} />
            <Knob size={34} label="D" value={p.ampEnv.d} min={0.005} max={4} defaultValue={0.4} onChange={(v) => u({ ampEnv: { d: v } })} fmt={fmtSec} />
            <Knob size={34} label="S" value={p.ampEnv.s} min={0} max={1} defaultValue={0.8} onChange={(v) => u({ ampEnv: { s: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
            <Knob size={34} label="R" value={p.ampEnv.r} min={0.005} max={6} defaultValue={0.3} onChange={(v) => u({ ampEnv: { r: v } })} fmt={fmtSec} />
            <Knob size={38} label="vol" value={p.vol} min={0} max={0.5} defaultValue={0.18} onChange={(v) => u({ vol: v })} fmt={(v) => Math.round(v * 200) + "%"} />
            <div className="mt-0.5 w-full min-w-55">
              <EnvGraph a={p.ampEnv.a} d={p.ampEnv.d} s={p.ampEnv.s} r={p.ampEnv.r} />
            </div>
          </Group>
        )}

        {tab === "lfo" && (
          <Group title="lfo">
            <Seg value={p.lfo.dest} options={["off", "pitch", "cutoff", "amp"] as const} onChange={(d) => u({ lfo: { dest: d, depth: Math.min(p.lfo.depth, lfoDepthMax(d)) } })} />
            <Knob size={38} label="rate" value={p.lfo.rate} min={0.05} max={20} defaultValue={5} onChange={(v) => u({ lfo: { rate: v } })} fmt={(v) => v.toFixed(1) + "Hz"} />
            <Knob size={38} label="depth" value={p.lfo.depth} min={0} max={lfoDepthMax(p.lfo.dest)} defaultValue={0} disabled={p.lfo.dest === "off"} onChange={(v) => u({ lfo: { depth: v } })} fmt={(v) => Math.round(v) + ""} />
          </Group>
        )}

        {tab === "voices" && (
          <Group title="voices">
            <button
              type="button"
              title="Global: randomize osc start phase + sample humanize on every note. Off = identical MIDI hits (default)."
              onClick={() =>
                engine.setAudioPrefs({ voiceHumanize: !humanizeOn })
              }
              className={
                "rounded-[3px] border px-1.5 py-0.75 font-mono text-[9px] transition-colors " +
                (humanizeOn
                  ? "border-accent text-accent"
                  : "border-line text-faint")
              }
            >
              humanize {humanizeOn ? "on" : "off"}
            </button>
            <Seg value={vc.mode} options={["poly", "mono"] as const} onChange={(m) => uv({ mode: m })} />
            <Knob size={38} label="voices" value={vc.unison} min={1} max={8} defaultValue={1} onChange={(v) => uv({ unison: Math.round(v) })} fmt={(v) => String(Math.round(v))} />
            <Knob size={38} label="detune" value={vc.detune} min={0} max={100} defaultValue={14} disabled={vc.unison < 2} onChange={(v) => uv({ detune: v })} fmt={(v) => Math.round(v) + "ct"} />
            <Knob size={38} label="width" value={vc.width} min={0} max={1} defaultValue={0.6} disabled={vc.unison < 2} onChange={(v) => uv({ width: v })} fmt={(v) => Math.round(v * 100) + "%"} />
            <span title="Per-oscillator start phase when humanize is on. 100% = fully random (stops detuned unison combing). 0 = locked. Ignored while humanize is off.">
              <Knob
                size={38}
                label="phase"
                value={vc.phase ?? 0}
                min={0}
                max={1}
                defaultValue={0}
                disabled={!humanizeOn}
                onChange={(v) => uv({ phase: v })}
                fmt={(v) => (v < 0.01 ? "lock" : Math.round(v * 100) + "%")}
              />
            </span>
            <span className="max-w-60 self-center font-mono text-[8.5px] leading-[1.55] text-faint">
              mono = last-note priority · unison stacks osc 1/2. humanize (global, default off) enables per-note phase jitter + sample detune — leave off for repeatable MIDI.
            </span>
          </Group>
        )}
      </div>
    </LabPanel>
  );
}
