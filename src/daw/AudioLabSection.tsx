import { SectionHead } from "./components/SectionHead";
import { TrackSection } from "./components/TrackSection";
import { AudioLab } from "./components/audio-lab/AudioLab";

export function AudioLabSection() {
  return (
    <TrackSection id="audiolab" label="audio lab" rail="02">
      <SectionHead num="02" title="audio lab" sub="phase-locked mix ↔ master A/B" />
      <AudioLab />
    </TrackSection>
  );
}
