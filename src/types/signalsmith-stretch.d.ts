// Minimal types for signalsmith-stretch (the package ships none).
// API per its README: SignalsmithStretch(ctx) → Promise<AudioNode + extras>.
declare module "signalsmith-stretch" {
  export interface StretchScheduleChange {
    output?: number; // ctx time for this change (latency-compensated)
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
  export interface StretchNode extends AudioNode {
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
