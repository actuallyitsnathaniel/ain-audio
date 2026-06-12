import { engine } from "./engine";

export function fmtTime(s: number): string {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}

export function labDuration(): number {
  return engine.duration || (engine.track && engine.track.durationHint) || 30;
}
