import { useEffect, useState } from "react";
import { engine } from "../engine";

type EngineEvent = "state" | "wet" | "fx" | "track" | "ready" | "synth" | "preset" | "transport" | "clip";

// Subscribe to engine events and force a re-render when they fire. Returns the
// engine singleton so components can read its current state. Defaults to the
// events the Lab cares about; pass a custom list (e.g. ["synth"]) to narrow.
export function useEngine(events: EngineEvent[] = ["state", "wet", "fx", "track"]) {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    events.forEach((ev) => engine.on(ev, fn));
    return () => events.forEach((ev) => engine.off(ev, fn));
    // events is a stable literal at each call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return engine;
}
