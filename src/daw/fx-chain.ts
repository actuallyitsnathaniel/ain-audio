// ── FxChain — an ordered, reorderable list of FX devices between input → output ──
// The reusable unit behind both per-track FX and the master bus. Owns a list of live
// device instances; wires input → [dev0 → dev1 → …] → output. Add/remove/reorder rebuild
// the internal connections click-safely (duck the chain's own out gain over a short ramp).
// A device stays IN the chain when "off" (neutralized via its apply), so on/off never
// reconnects — only add/remove/reorder do.

import { FX_DEVICES, type FxDeviceType, type FxDeviceNodes } from "./fx-devices";
import type { FxVizSlot } from "./spectral-viz";

// serializable device state (persists in the track/master model)
export interface FxDeviceState {
  id: string;
  type: FxDeviceType;
  params: unknown;
}

let _fxid = 0;
export const newFxId = () => "fx" + (_fxid++).toString(36) + Date.now().toString(36);

interface LiveDevice {
  state: FxDeviceState;
  nodes: FxDeviceNodes;
}

export class FxChain {
  private live: LiveDevice[] = [];
  private ducker: GainNode; // a gain right before `output` we ramp for click-safe rewires
  constructor(
    private ctx: AudioContext,
    private input: AudioNode,
    private output: AudioNode,
  ) {
    this.ducker = ctx.createGain();
    this.ducker.connect(output);
    this.wire(true); // input → ducker → output (empty chain = passthrough)
  }

  // rebuild internal connections in device order. Click-safe: duck → disconnect all →
  // reconnect input → dev0.in, devN.out → ducker → output → unduck.
  private wire(instant = false) {
    const t = this.ctx.currentTime;
    if (instant) this.ducker.gain.value = 0;
    else this.ducker.gain.setTargetAtTime(0, t, 0.008);
    try { this.input.disconnect(); } catch { /* nothing wired */ }
    for (const d of this.live) {
      try { d.nodes.out.disconnect(); } catch { /* not wired */ }
    }
    let prev: AudioNode = this.input;
    for (const d of this.live) {
      prev.connect(d.nodes.in);
      prev = d.nodes.out;
    }
    prev.connect(this.ducker);
    if (instant) this.ducker.gain.value = 1;
    else this.ducker.gain.setTargetAtTime(1, t + 0.02, 0.008);
  }

  // set the whole chain from serialized state (rebuilds live devices; used on load)
  setDevices(states: FxDeviceState[]) {
    this.live = states.map((s) => ({ state: s, nodes: FX_DEVICES[s.type].build(this.ctx) }));
    this.wire(true);
    this.applyAll(120);
  }

  addDevice(type: FxDeviceType): FxDeviceState {
    // an EXPLICITLY added device powers ON (defaults are bypassed for pre-seeded racks
    // — adding an effect and hearing nothing was a support ticket)
    const state: FxDeviceState = { id: newFxId(), type, params: { ...(FX_DEVICES[type].defaults() as object), on: true } };
    this.live.push({ state, nodes: FX_DEVICES[type].build(this.ctx) });
    this.wire();
    this.applyOne(this.live.length - 1, 120);
    return state;
  }

  removeDevice(id: string) {
    const i = this.live.findIndex((d) => d.state.id === id);
    if (i < 0) return;
    this.live.splice(i, 1);
    this.wire();
  }

  // move a device to a new index (drag reorder)
  moveDevice(id: string, toIndex: number) {
    const i = this.live.findIndex((d) => d.state.id === id);
    if (i < 0) return;
    const [d] = this.live.splice(i, 1);
    this.live.splice(Math.max(0, Math.min(toIndex, this.live.length)), 0, d);
    this.wire();
  }

  // update one device's params (from the UI) + re-apply it
  setParams(id: string, params: unknown, bpm: number) {
    const d = this.live.find((x) => x.state.id === id);
    if (!d) return;
    d.state.params = params;
    d.nodes.apply(params, this.ctx, bpm);
  }

  private applyOne(i: number, bpm: number) {
    const d = this.live[i];
    if (d) d.nodes.apply(d.state.params, this.ctx, bpm);
  }
  applyAll(bpm: number) {
    for (const d of this.live) d.nodes.apply(d.state.params, this.ctx, bpm);
  }

  // serializable snapshot of the chain
  states(): FxDeviceState[] {
    return this.live.map((d) => ({ ...d.state, params: structuredClone(d.state.params) }));
  }

  /** Latest spectral viz slot for a device (null if missing / non-spectral). */
  readViz(id: string): FxVizSlot | null {
    return this.live.find((d) => d.state.id === id)?.nodes.viz ?? null;
  }

  /** Continuous work for devices that need it (EQ dynamics / analyser). */
  tick() {
    for (const d of this.live) d.nodes.tick?.(this.ctx);
  }

  /** Push MIDI note targets into listening devices (centinel midi-follow). */
  setMidiTargets(notes: number[]) {
    for (const d of this.live) d.nodes.setMidiTargets?.(notes);
  }

  // tear down (track removed): disconnect everything from the graph
  dispose() {
    try { this.input.disconnect(); } catch { /* fine */ }
    for (const d of this.live) { try { d.nodes.out.disconnect(); } catch { /* fine */ } }
    try { this.ducker.disconnect(); } catch { /* fine */ }
    this.live = [];
  }
}
