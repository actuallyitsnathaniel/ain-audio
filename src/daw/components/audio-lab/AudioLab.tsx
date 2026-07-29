import { useRef } from "react";
import type { Levels } from "../../engine";
import { engine } from "../../engine";
import { jlmTrack } from "../../data/tracks";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { PlayButton } from "../PlayButton";
import { TimeReadout } from "../TimeReadout";
import { Waveform } from "../Waveform";
import { Spectrum } from "../Spectrum";
import { LevelMeter } from "../LevelMeter";
import { Instrument } from "./Instrument";
import { RollLab } from "../piano-roll/RollLab";
import { abSnap, lockChip } from "../../lab-utils";
import { ABDial } from "./ABDial";
import { FxRack } from "./FxRack";
import { LabErrorBanner } from "./LabErrorBanner";

export function AudioLab() {
  const eng = useEngine(["state", "track"]);
  const cur = eng.track || jlmTrack;
  const isPair = cur.kind === "pair";
  const levels = useRef<{ mix: Levels; master: Levels }>({
    mix: { rms: -90, peak: -90 },
    master: { rms: -90, peak: -90 },
  });
  useRafLoop(() => {
    levels.current = engine.getLevels();
  });

  return (
    <div className="rounded-sm border border-line bg-panel p-5.5 max-[767px]:p-4">
      <div className="grid grid-cols-1 gap-6.5 max-[767px]:gap-4 min-[981px]:grid-cols-[250px_1fr_190px]">
        {/* left: artwork + meta — on mobile the artwork is dropped and the
            meta collapses to a compact header that sits above the player */}
        <div className="flex min-w-0 flex-col gap-3.5 max-[767px]:order-1 max-[767px]:gap-2">
          <img
            className="aspect-square w-full rounded-[3px] border border-line2 object-cover max-[767px]:hidden"
            src={cur.art}
            alt={cur.title}
          />
          <div>
            <div className="mb-1.25 font-mono text-[10.5px] tracking-[0.12em] text-accent uppercase">now in the lab</div>
            <h3 className="m-0 text-[21px] leading-[1.2] font-bold text-daw-text max-[767px]:text-[18px]">{cur.title}</h3>
            <div className="mt-1 font-mono text-[11px] text-dim">{cur.subtitle}</div>
          </div>
          <p className="m-0 text-[13.5px] leading-[1.6] text-dim">{cur.notes}</p>
          {cur.id !== "jlm" ? (
            <button className={abSnap + " self-start"} onClick={() => engine.loadTrack(jlmTrack, { autoplay: true })}>
              ⟲ reload flagship master
            </button>
          ) : null}
        </div>

        {/* center: transport + waveform + dial + fx + preset lab */}
        <div className="flex min-w-0 flex-col gap-4 max-[767px]:order-2">
          <div className="flex flex-wrap items-center gap-3.5">
            <PlayButton />
            <TimeReadout />
            {isPair ? (
              <span
                className={lockChip}
                title="both versions start on the same audio-clock sample — they cannot drift"
              >
                ⊜ sample-locked A/B
              </span>
            ) : (
              <span className={lockChip}>▸ project preview</span>
            )}
          </div>
          <LabErrorBanner />
          <Waveform />
          {isPair ? <ABDial /> : null}
          <FxRack />
          <Instrument />
          <RollLab />
        </div>

        {/* right: analysis */}
        <div className="flex min-w-0 flex-col max-[767px]:order-3">
          <div className="grid grid-cols-1 gap-4.5 max-[980px]:grid-cols-[1fr_200px] max-[980px]:items-start max-[767px]:grid-cols-1">
            <div>
              <div className="mb-2 font-mono text-[10.5px] tracking-[0.08em] text-faint">output spectrum</div>
              <Spectrum height={132} />
            </div>
            <div>
              <div className="mb-2 font-mono text-[10.5px] tracking-[0.08em] text-faint">loudness · rms dBFS</div>
              <div className="flex justify-center gap-3.5 rounded-[3px] border border-line bg-inset pt-2.5 px-0 pb-1 ">
                {isPair ? (
                  <>
                    <LevelMeter label="MIX" getLevel={() => levels.current.mix} />
                    <LevelMeter label="MASTER" getLevel={() => levels.current.master} />
                  </>
                ) : (
                  <LevelMeter label="OUT" getLevel={() => levels.current.master} />
                )}
              </div>
              {isPair ? (
                <button
                  className={
                    "mt-3 block w-full rounded-[3px] border px-2.5 py-2.25 font-mono text-[10.5px] tracking-[0.07em] transition-all duration-150 " +
                    (eng.levelMatch
                      ? "border-accent bg-accent font-semibold text-[#111]"
                      : "border-line2 text-dim hover:border-dim hover:text-daw-text")
                  }
                  onClick={() => engine.setLevelMatch(!eng.levelMatch)}
                  title="boosts the mix branch by the measured RMS difference so you compare tone, not loudness — meters stay honest"
                >
                  LEVEL MATCH +{(eng.lmDb || 1.7).toFixed(1)} dB
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
