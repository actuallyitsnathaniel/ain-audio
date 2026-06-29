// ── BEATMAKER — drum step-sequencer page body ────────────────────────────
// Assembles the transport + step grid, framed like the rest of the DAW. Runs
// through the shared FX rack (drums route to n.sum). Loopable melodic-sample
// lanes are a planned follow-up.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { engine } from "../../engine";
import { SectionHead } from "../SectionHead";
import { TrackSection } from "../TrackSection";
import { FxRack } from "../audio-lab/FxRack";
import { SequencerTransport } from "./SequencerTransport";
import { StepGrid } from "./StepGrid";
import { MidiChannels } from "./MidiChannels";
import { LoopLanes } from "./LoopLanes";

export function Beatmaker() {
  // warm the kit (decode any real one-shots; synth voices need nothing) on mount
  useEffect(() => {
    void engine.loadKit(engine.kit);
    return () => {
      // leaving the page stops the beat so it doesn't keep running headless
      if (engine.beatMode) engine.stopBeat();
    };
  }, []);

  return (
    <main className="relative z-[1] pt-[64px]">
      <TrackSection id="beatmaker" label="beat maker" rail="05">
        <SectionHead num="05" title="beat maker" sub="step sequencer + melodic midi channels · runs through the fx rack" />

        <div className="flex flex-col gap-[16px] rounded-[5px] border border-line bg-panel p-[16px] max-[767px]:p-[12px]">
          <SequencerTransport />
          <div className="overflow-x-auto">
            <div className="min-w-[580px]">
              <StepGrid />
            </div>
          </div>
          <MidiChannels />
          <LoopLanes />
          <FxRack />
        </div>

        <div className="mt-[14px] flex items-center gap-3 font-mono text-[10.5px] tracking-[0.03em] text-faint">
          <Link to="/" className="rounded-[3px] border border-line px-[10px] py-[5px] text-dim transition-colors hover:border-accent hover:text-accent">
            ← back to the lab
          </Link>
          <span>click a step to toggle · shift-click for accent · right-click anything for actions (⇧right-click = browser menu) · synth drums until i bounce a real kit.</span>
        </div>
      </TrackSection>
    </main>
  );
}
