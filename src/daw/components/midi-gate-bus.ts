// Shared state + entry point for the app-wide MIDI permission gate. Kept separate
// from MidiGate.tsx so that file only exports a component (react-refresh rule).
import { engine } from "../engine";

let asked = false; // answered the explainer once this session → don't ask again
let show: (() => void) | null = null; // set by the mounted <MidiGate/> host

export const setMidiGateHost = (fn: (() => void) | null) => {
  show = fn;
};
export const markMidiAsked = () => {
  asked = true;
};

// Ask to enable MIDI. If already granted/decided, enable straight away; otherwise
// pop the explainer modal first. Safe to call from anywhere.
export function requestMidiEnable() {
  if (engine.midiStatus !== "idle" || asked) {
    void engine.enableMidi();
    return;
  }
  if (show) show();
  else void engine.enableMidi(); // no host mounted (shouldn't happen) → fail open
}
