/// <reference types="vite/client" />

// ── Minimal Web MIDI API typings (used by the Preset Lab) ─────────────────
// The standard DOM lib doesn't ship these; declare just what we use.
interface MIDIMessageEvent extends Event {
  readonly data: Uint8Array | null;
}

interface MIDIInput {
  onmidimessage: ((this: MIDIInput, ev: MIDIMessageEvent) => void) | null;
}

interface MIDIInputMap {
  forEach(cb: (input: MIDIInput) => void): void;
}

interface MIDIAccess {
  readonly inputs: MIDIInputMap;
  onstatechange: ((this: MIDIAccess, ev: Event) => void) | null;
}

interface Navigator {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MIDIAccess>;
}
