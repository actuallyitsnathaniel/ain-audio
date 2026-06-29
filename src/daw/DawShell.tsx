import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { engine } from "./engine";
import { jlmTrack } from "./data/tracks";
import { TransportBar } from "./TransportBar";
import { BgCanvas } from "./BgCanvas";
import { MidiGate } from "./components/MidiGate";
import { scrollToId } from "./lab-utils";

// Shared chrome for every DAW route: the fixed transport bar, the audio-reactive
// background, and the engine's default track (JLM). Wraps the route's content.
export function DawShell({ children }: { children: ReactNode }) {
  const location = useLocation();

  // The Lab defaults to the flagship JLM mix/master on first load.
  useEffect(() => {
    engine.setDefaultTrack(jlmTrack);
  }, []);

  // Scroll to a #hash target, offsetting for the fixed transport bar.
  useEffect(() => {
    if (location.hash) {
      const id = location.hash.slice(1);
      // wait a frame so the target section has mounted
      requestAnimationFrame(() => scrollToId(id));
    }
  }, [location.pathname, location.hash]);

  return (
    <>
      <BgCanvas />
      <TransportBar />
      {children}
      <MidiGate />
    </>
  );
}
