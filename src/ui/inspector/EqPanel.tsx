import { DEFAULT_EQ_SETTINGS } from "../../domain/project/defaults";
import { effectPatch } from "../../domain/project/effectPatch";
import { EQ_GAIN_RANGE } from "../../domain/project/ranges";
import type { EqSettings, Track } from "../../domain/types";
import { ko } from "../../i18n/ko";
import { useDawStore } from "../../store/useDawStore";
import { plainEntry } from "../controls/entries";
import { Knob } from "../controls/Knob";
import { Toggle } from "../controls/Toggle";
import { PanelSection } from "./PanelSection";
import { useHistoryGesture } from "./useHistoryGesture";

/** 노브 한 칸은 0.5dB */
const GAIN_STEP = 0.5;

/** 이퀄라이저의 다섯 대역: 설정의 이름·화면 이름·칸 색 */
const BANDS = ([
  { key: "bassGain", label: ko.eq.bass, color: "#3fb46b" },
  { key: "middleLowGain", label: ko.eq.middleLow, color: "#9dbd3a" },
  { key: "middleHighGain", label: ko.eq.middleHigh, color: "#d0a338" },
  { key: "highGain", label: ko.eq.high, color: "#df7148" },
  { key: "presenceGain", label: ko.eq.presence, color: "#d75c6f" },
] as const satisfies ReadonlyArray<{ key: keyof EqSettings; label: string; color: string }>).map((band) => ({
  ...band,
  entry: plainEntry(`${band.label} 이퀄라이저 값(dB)`, EQ_GAIN_RANGE[0], EQ_GAIN_RANGE[1], GAIN_STEP),
}));

function formatGain(value: number): string {
  return `${value > 0 ? `+${value}` : value}dB`;
}

/** 이퀄라이저 칸: 다섯 대역의 노브(−12 ~ +12 dB)와 켜고 끄는 단추 */
export function EqPanel({ track }: { track: Track }) {
  const updateTrack = useDawStore((state) => state.updateTrack);
  const gesture = useHistoryGesture(`track:${track.id}:eq`);
  const { eq } = track;

  return (
    <PanelSection
      id="eq"
      title="이퀄라이저"
      className="eq-panel"
      actions={
        <Toggle
          className={`plugin-power-button ${eq.enabled ? "on" : ""}`}
          label={ko.state.power("이퀄라이저", eq.enabled)}
          pressed={eq.enabled}
          onChange={(enabled) => updateTrack(track.id, effectPatch(track, "eq", { enabled }))}
        >
          {eq.enabled ? ko.state.on : ko.state.off}
        </Toggle>
      }
    >
      <div className="eq-bands">
        {BANDS.map((band) => (
          <Knob
            key={band.key}
            face="eq"
            label={`${band.label} 이퀄라이저`}
            caption={band.label}
            color={band.color}
            value={eq[band.key]}
            min={EQ_GAIN_RANGE[0]}
            max={EQ_GAIN_RANGE[1]}
            step={GAIN_STEP}
            defaultValue={DEFAULT_EQ_SETTINGS[band.key]}
            format={formatGain}
            entry={band.entry}
            onChange={(gain) => updateTrack(track.id, effectPatch(track, "eq", { [band.key]: gain }))}
            {...gesture}
          />
        ))}
      </div>
    </PanelSection>
  );
}
