// Minimal types for signalsmith-stretch (the package ships none).
// API per its README: SignalsmithStretch(ctx) → Promise<AudioNode + extras>.
declare module "signalsmith-stretch" {
  export interface StretchScheduleChange {
    output?: number; // ctx time the change takes effect (the segment's time anchor)
    // PROVEN semantics (v1.3.2, via executable repro of the shipped worklet):
    // every schedule() call pops ALL queued changes at/after "now" — the queue holds
    // at most ONE future change. Schedule a future stop only AFTER the start has
    // taken effect. `outputTime` is a TRAP: it fast-forwards the internal map and
    // discards earlier segments (instant silence). DO NOT USE.
    outputTime?: never;
    active?: boolean;
    input?: number; // seconds into the loaded buffers
    rate?: number; // playback rate (0.5 = half speed)
    semitones?: number; // pitch shift
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  }
  export interface StretchNode extends AudioWorkletNode {
    inputTime: number;
    schedule(change: StretchScheduleChange): void;
    start(when?: number): void;
    stop(when?: number): void;
    addBuffers(buffers: Float32Array[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number } | void>;
    latency(): number;
    configure(opts: { blockMs?: number | null; intervalMs?: number; splitComputation?: boolean; preset?: "default" | "cheaper" }): void;
    setUpdateInterval(seconds: number, callback?: () => void): void;
  }
  export default function SignalsmithStretch(ctx: BaseAudioContext, channelOptions?: Record<string, unknown>): Promise<StretchNode>;
}
