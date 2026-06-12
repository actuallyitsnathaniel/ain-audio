import { useRef } from "react";
import { engine } from "../engine";
import { useRafLoop } from "../hooks/useRafLoop";
import { fmtTime, labDuration } from "../lab-time";

export function TimeReadout() {
  const ref = useRef<HTMLSpanElement>(null);
  useRafLoop(() => {
    if (!ref.current) return;
    ref.current.textContent = fmtTime(engine.getPosition()) + " / " + fmtTime(labDuration());
  });
  return (
    <span className="font-mono text-[13px] text-daw-text" ref={ref}>
      0:00 / 0:30
    </span>
  );
}
