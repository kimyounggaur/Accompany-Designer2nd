import { NEEDLE_SCALE_DB } from "../../domain/compressor/needle";
import { DEFAULT_COMPRESSOR_SETTINGS } from "../../domain/project/defaults";
import { effectPatch } from "../../domain/project/effectPatch";
import type { CompressorSettings, Track } from "../../domain/types";
import { ko } from "../../i18n/ko";
import { useDawStore } from "../../store/useDawStore";
import { plainEntry, scaledEntry } from "../controls/entries";
import { CompressorNeedle } from "./CompressorNeedle";
import { Knob, type KnobEntry } from "../controls/Knob";
import { PanelSection } from "./PanelSection";
import { Toggle } from "../controls/Toggle";
import { useHistoryGesture } from "./useHistoryGesture";

const formatMs = (seconds: number) => `${Math.round(seconds * 1000)}ms`;

/** 컴프레서의 네 노브: 설정의 이름·범위·간격·표시. 노브 앞에 `${이름} 컴프레서`가 화면 낭독기 이름이 된다 */
const KNOBS: ReadonlyArray<{
  key: "threshold" | "ratio" | "attack" | "release";
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  entry: KnobEntry;
}> = [
  {
    key: "threshold", label: ko.compressor.threshold, min: -60, max: 0, step: 0.5,
    format: (value) => `${value}dB`,
    entry: plainEntry(`${ko.compressor.threshold} 값(dB)`, -60, 0, 0.5),
  },
  {
    key: "ratio", label: ko.compressor.ratio, min: 1, max: 20, step: 0.1,
    format: (value) => `${value}:1`,
    entry: plainEntry(`${ko.compressor.ratio} 값(:1)`, 1, 20, 0.1),
  },
  {
    key: "attack", label: ko.compressor.attack, min: 0.001, max: 1, step: 0.001,
    format: formatMs,
    entry: scaledEntry(`${ko.compressor.attack} 값(ms)`, 1000, 1, 1000, 1),
  },
  {
    key: "release", label: ko.compressor.release, min: 0.01, max: 1, step: 0.01,
    format: formatMs,
    entry: scaledEntry(`${ko.compressor.release} 값(ms)`, 1000, 10, 1000, 1),
  },
];

/** 컴프레서 칸: 줄어든 음량 표시와 네 노브(기준 음량·압축 비율·반응 시간·회복 시간) */
export function CompressorPanel({ track }: { track: Track }) {
  const updateTrack = useDawStore((state) => state.updateTrack);
  const gesture = useHistoryGesture(`track:${track.id}:compressor`);
  const { compressor } = track;

  return (
    <PanelSection id="comp" title="컴프레서" className="comp-panel">
      <div className="comp-rack">
        {/* 상단 VU 미터 */}
        <div className="comp-vu-row">
          <span className="comp-title">{ko.compressor.title}</span>
          <div className="comp-vu-meter">
            <div className="comp-vu-scale">
              {NEEDLE_SCALE_DB.map((db) => (
                <span key={db}>{db}</span>
              ))}
            </div>
            <div className="comp-vu-needle-wrap">
              <CompressorNeedle trackId={track.id} enabled={compressor.enabled} />
            </div>
            <div className="comp-vu-label">{ko.compressor.gainReduction}</div>
          </div>
          <Toggle
            className={`comp-power-btn ${compressor.enabled ? "on" : ""}`}
            label="컴프레서 켜기"
            pressed={compressor.enabled}
            onChange={(enabled) => updateTrack(track.id, effectPatch(track, "compressor", { enabled }))}
          >
            <span className="comp-power-ring">
              <span className="comp-power-dot" />
            </span>
            <span className="comp-power-label">{compressor.enabled ? ko.state.on : ko.state.off}</span>
          </Toggle>
        </div>

        {/* 하단 노브 열 */}
        <div className="comp-knobs-row">
          {KNOBS.map((knob) => (
            <Knob
              key={knob.key}
              face="comp"
              label={`${knob.label} 컴프레서`}
              caption={knob.label}
              value={compressor[knob.key]}
              min={knob.min}
              max={knob.max}
              step={knob.step}
              defaultValue={DEFAULT_COMPRESSOR_SETTINGS[knob.key as keyof CompressorSettings] as number}
              format={knob.format}
              entry={knob.entry}
              onChange={(value) => updateTrack(track.id, effectPatch(track, "compressor", { [knob.key]: value }))}
              {...gesture}
            />
          ))}
        </div>
      </div>
    </PanelSection>
  );
}
