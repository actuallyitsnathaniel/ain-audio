// ── SYNTH EDITOR — live subtractive-patch design surface ──────────────────────
// Edits engine.currentPatch() in real time via engine.updateActivePatch(); changes
// are heard on the next note (latched per-voice, like hardware). Sections: OSC1 ·
// OSC2 · SUB · NOISE · FILTER · AMP ENV · FILTER ENV · LFO. The patch bar selects /
// saves / saves-as / deletes user patches; built-ins reset to factory on reload and
// can be reverted live. Built-ins stay pristine — editing one is a session working
// copy until you save-as.

import { useState } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { Knob } from "../Knob";
import { LabPanel } from "./LabPanel";
import type { SynthPatch, Wave } from "../../data/patches";

const WAVES: Wave[] = ["sine", "triangle", "sawtooth", "square"];
const WAVE_GLYPH: Record<Wave, string> = { sine: "∿", triangle: "△", sawtooth: "◺", square: "⊓" };

// a compact segmented selector
function Seg<T extends string>({ value, options, onChange, fmt }: { value: T; options: readonly T[]; onChange: (v: T) => void; fmt?: (v: T) => string }) {
  return (
    <span className="flex items-center gap-[2px]">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          title={o}
          className={
            "rounded-[3px] border px-[6px] py-[3px] font-mono text-[10px] transition-colors " +
            (o === value ? "border-accent bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent" : "border-line text-faint hover:text-dim")
          }
        >
          {fmt ? fmt(o) : o}
        </button>
      ))}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[7px] rounded-[4px] border border-line bg-[#0e0e12] p-[10px]">
      <span className="font-mono text-[9px] tracking-[0.12em] text-faint uppercase">{title}</span>
      <div className="flex flex-wrap items-end gap-x-[12px] gap-y-[8px]">{children}</div>
    </div>
  );
}

export function SynthEditor() {
  const eng = useEngine(["patch", "synth"]);
  const id = eng.synthPatch;
  const p: SynthPatch = eng.currentPatch();
  const builtin = eng.isBuiltinPatch(id);
  const [saving, setSaving] = useState(false);

  const u = (partial: Parameters<typeof engine.updateActivePatch>[0]) => engine.updateActivePatch(partial);

  const patchBar = (
    <>
        <span className="relative inline-flex items-center">
          <select
            value={id}
            onChange={(e) => engine.setSynthPatch(e.target.value)}
            aria-label="synth patch"
            className="cursor-pointer appearance-none rounded-[3px] border border-line2 bg-panel2 py-[5px] pr-[24px] pl-[10px] font-mono text-[11px] tracking-[0.03em] text-daw-text hover:border-accent focus:border-accent focus:outline-none"
          >
            {eng.synthPatches.map((n) => (
              <option key={n} value={n} className="bg-panel2 text-daw-text">
                {n}
                {eng.isBuiltinPatch(n) ? "" : " ·"}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-[9px] text-[8px] text-faint">▼</span>
        </span>
        {builtin && <span className="font-mono text-[9px] tracking-[0.05em] text-faint">factory</span>}

        <span className="ml-auto flex items-center gap-[6px]">
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
              className="w-[120px] rounded-[3px] border border-accent bg-panel2 px-[7px] py-[4px] font-mono text-[10.5px] text-daw-text focus:outline-none"
            />
          ) : (
            <>
              {!builtin && (
                <button onClick={() => engine.saveUserPatch(id)} title="save changes to this patch" className="rounded-[3px] border border-line px-[9px] py-[4px] font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent">
                  save
                </button>
              )}
              <button onClick={() => setSaving(true)} title="save as a new patch" className="rounded-[3px] border border-line px-[9px] py-[4px] font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent">
                save as
              </button>
              {builtin ? (
                <button onClick={() => engine.revertPatch(id)} title="restore factory sound" className="rounded-[3px] border border-line px-[9px] py-[4px] font-mono text-[10px] text-faint transition-colors hover:text-dim">
                  revert
                </button>
              ) : (
                <button onClick={() => engine.deleteUserPatch(id)} title="delete this patch" className="rounded-[3px] border border-line px-[9px] py-[4px] font-mono text-[10px] text-faint transition-colors hover:border-[#e0654f] hover:text-[#e98c79]">
                  delete
                </button>
              )}
            </>
          )}
        </span>
    </>
  );

  return (
    <LabPanel title="SYNTH" controls={patchBar} defaultOpen={false}>
      <div className="grid grid-cols-2 gap-[8px] max-[767px]:grid-cols-1">
        <Section title="osc 1">
          <Seg value={p.osc1.wave} options={WAVES} onChange={(w) => u({ osc1: { wave: w } })} fmt={(w) => WAVE_GLYPH[w]} />
          <Knob size={34} label="semi" value={p.osc1.semi} min={-24} max={24} defaultValue={0} bipolar onChange={(v) => u({ osc1: { semi: Math.round(v) } })} fmt={(v) => (Math.round(v) > 0 ? "+" : "") + Math.round(v)} />
          <Knob size={34} label="fine" value={p.osc1.cents} min={-50} max={50} defaultValue={0} bipolar onChange={(v) => u({ osc1: { cents: Math.round(v) } })} fmt={(v) => Math.round(v) + "c"} />
          <Knob size={34} label="level" value={p.osc1.level} min={0} max={1} defaultValue={1} onChange={(v) => u({ osc1: { level: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
        </Section>

        <Section title="osc 2">
          <button onClick={() => u({ osc2On: !p.osc2On })} title="toggle osc 2" className={"rounded-[3px] border px-[6px] py-[3px] font-mono text-[9px] transition-colors " + (p.osc2On ? "border-accent text-accent" : "border-line text-faint")}>
            {p.osc2On ? "on" : "off"}
          </button>
          <Seg value={p.osc2.wave} options={WAVES} onChange={(w) => u({ osc2: { wave: w } })} fmt={(w) => WAVE_GLYPH[w]} />
          <Knob size={34} label="semi" value={p.osc2.semi} min={-24} max={24} defaultValue={0} bipolar onChange={(v) => u({ osc2: { semi: Math.round(v) } })} fmt={(v) => (Math.round(v) > 0 ? "+" : "") + Math.round(v)} />
          <Knob size={34} label="fine" value={p.osc2.cents} min={-50} max={50} defaultValue={6} bipolar onChange={(v) => u({ osc2: { cents: Math.round(v) } })} fmt={(v) => Math.round(v) + "c"} />
          <Knob size={34} label="level" value={p.osc2.level} min={0} max={1} defaultValue={1} onChange={(v) => u({ osc2: { level: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
        </Section>

        <Section title="sub">
          <Seg value={p.sub.wave} options={["sine", "square"] as const} onChange={(w) => u({ sub: { wave: w } })} fmt={(w) => WAVE_GLYPH[w]} />
          <Seg value={String(p.sub.oct) as "-1" | "-2"} options={["-1", "-2"] as const} onChange={(o) => u({ sub: { oct: Number(o) as -1 | -2 } })} fmt={(o) => o + " oct"} />
          <Knob size={34} label="level" value={p.sub.level} min={0} max={1} defaultValue={0} onChange={(v) => u({ sub: { level: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
        </Section>

        <Section title="noise">
          <Seg value={p.noise.type} options={["white", "pink"] as const} onChange={(t) => u({ noise: { type: t } })} />
          <Knob size={34} label="level" value={p.noise.level} min={0} max={1} defaultValue={0} onChange={(v) => u({ noise: { level: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
        </Section>

        <Section title="filter">
          <Seg value={p.filter.type} options={["lowpass", "highpass", "bandpass", "notch"] as const} onChange={(t) => u({ filter: { type: t } })} fmt={(t) => t.slice(0, 2).toUpperCase()} />
          <Knob size={34} label="cutoff" value={p.filter.cut} min={40} max={18000} defaultValue={2200} onChange={(v) => u({ filter: { cut: Math.round(v) } })} fmt={(v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + "")} />
          <Knob size={34} label="reso" value={p.filter.q} min={0.1} max={20} defaultValue={0.8} onChange={(v) => u({ filter: { q: v } })} fmt={(v) => v.toFixed(1)} />
          <Knob size={34} label="ktrk" value={p.filter.keyTrack} min={0} max={1} defaultValue={0} onChange={(v) => u({ filter: { keyTrack: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
        </Section>

        <Section title="filter env">
          <Knob size={34} label="amt" value={p.filtEnv.amt} min={-6000} max={9000} defaultValue={1800} bipolar onChange={(v) => u({ filtEnv: { amt: Math.round(v) } })} fmt={(v) => (v >= 1000 || v <= -1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + "")} />
          <Knob size={30} label="A" value={p.filtEnv.a} min={0.001} max={4} defaultValue={0.01} onChange={(v) => u({ filtEnv: { a: v } })} fmt={fmtSec} />
          <Knob size={30} label="D" value={p.filtEnv.d} min={0.005} max={4} defaultValue={0.5} onChange={(v) => u({ filtEnv: { d: v } })} fmt={fmtSec} />
          <Knob size={30} label="S" value={p.filtEnv.s} min={0} max={1} defaultValue={0.4} onChange={(v) => u({ filtEnv: { s: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
          <Knob size={30} label="R" value={p.filtEnv.r} min={0.005} max={6} defaultValue={0.4} onChange={(v) => u({ filtEnv: { r: v } })} fmt={fmtSec} />
        </Section>

        <Section title="amp env">
          <Knob size={30} label="A" value={p.ampEnv.a} min={0.001} max={4} defaultValue={0.01} onChange={(v) => u({ ampEnv: { a: v } })} fmt={fmtSec} />
          <Knob size={30} label="D" value={p.ampEnv.d} min={0.005} max={4} defaultValue={0.4} onChange={(v) => u({ ampEnv: { d: v } })} fmt={fmtSec} />
          <Knob size={30} label="S" value={p.ampEnv.s} min={0} max={1} defaultValue={0.8} onChange={(v) => u({ ampEnv: { s: v } })} fmt={(v) => Math.round(v * 100) + "%"} />
          <Knob size={30} label="R" value={p.ampEnv.r} min={0.005} max={6} defaultValue={0.3} onChange={(v) => u({ ampEnv: { r: v } })} fmt={fmtSec} />
          <Knob size={34} label="vol" value={p.vol} min={0} max={0.5} defaultValue={0.18} onChange={(v) => u({ vol: v })} fmt={(v) => Math.round(v * 200) + "%"} />
        </Section>

        <Section title="lfo">
          {/* changing dest re-scales depth units → clamp so a Hz depth doesn't carry into amp range */}
          <Seg value={p.lfo.dest} options={["off", "pitch", "cutoff", "amp"] as const} onChange={(d) => u({ lfo: { dest: d, depth: Math.min(p.lfo.depth, lfoDepthMax(d)) } })} />
          <Knob size={34} label="rate" value={p.lfo.rate} min={0.05} max={20} defaultValue={5} onChange={(v) => u({ lfo: { rate: v } })} fmt={(v) => v.toFixed(1) + "Hz"} />
          <Knob size={34} label="depth" value={p.lfo.depth} min={0} max={lfoDepthMax(p.lfo.dest)} defaultValue={0} disabled={p.lfo.dest === "off"} onChange={(v) => u({ lfo: { depth: v } })} fmt={(v) => Math.round(v) + ""} />
        </Section>
      </div>
    </LabPanel>
  );
}

const fmtSec = (v: number) => (v >= 1 ? v.toFixed(1) + "s" : Math.round(v * 1000) + "ms");
// depth units differ by destination: cents (pitch), Hz (cutoff), gain×100 (amp)
const lfoDepthMax = (dest: SynthPatch["lfo"]["dest"]) => (dest === "cutoff" ? 6000 : dest === "amp" ? 1 : 1200);
