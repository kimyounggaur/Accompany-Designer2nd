import { DEFAULT_TRACK_VOLUME } from "../../domain/project/defaults";
import type { Track } from "../../domain/types";
import { ko } from "../../i18n/ko";
import { useDawStore } from "../../store/useDawStore";
import { scaledEntry } from "../controls/entries";
import { Knob } from "../controls/Knob";
import { Toggle } from "../controls/Toggle";
import { PanelSection } from "./PanelSection";
import { useHistoryGesture } from "./useHistoryGesture";

/** 노브 이름: 위쪽 트랙 헤더·모니터·마스터에도 "볼륨"이 있어서, 화면 낭독기가 구분하도록 "트랙"을 붙인다(눈에 보이는 글자는 그대로) */
const VOLUME_LABEL = `트랙 ${ko.trackMix.volume}`;
const PAN_LABEL = `트랙 ${ko.trackMix.pan}`;
const VOLUME_ENTRY = scaledEntry(`${VOLUME_LABEL} 값(%)`, 100, 0, 100, 1);
const PAN_ENTRY = scaledEntry(`${PAN_LABEL} 값(왼쪽 −100 ~ 오른쪽 100)`, 100, -100, 100, 1);

function formatVolume(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 가운데는 C, 오른쪽은 R, 왼쪽은 L에 퍼센트 */
function formatPan(value: number): string {
  if (value === 0) return "C";
  return value > 0 ? `R${Math.round(value * 100)}` : `L${Math.round(Math.abs(value) * 100)}`;
}

/** 트랙 믹스 칸: 선택한 트랙의 음소거·솔로와 볼륨·팬 노브 */
export function TrackMixPanel({ track }: { track: Track }) {
  const updateTrack = useDawStore((state) => state.updateTrack);
  const gesture = useHistoryGesture(`track:${track.id}:mix`);

  return (
    <PanelSection id="trax" title="트랙 믹스" className="trax-panel">
      <div className="trax-rack">
        <div className="trax-header">
          <span className="trax-brand">{ko.trackMix.title}</span>
          <div className="trax-toggles">
            <div className="trax-toggle-group">
              <Toggle
                className={`trax-switch ${track.muted ? "on danger" : ""}`}
                label="트랙 음소거"
                pressed={track.muted}
                onChange={(muted) => updateTrack(track.id, { muted })}
              >
                <span className="trax-switch-lever" />
              </Toggle>
              <span className="trax-switch-label">{ko.trackMix.mute}</span>
            </div>
            <div className="trax-toggle-group">
              <Toggle
                className={`trax-switch ${track.solo ? "on solo" : ""}`}
                label="트랙 솔로"
                pressed={track.solo}
                onChange={(solo) => updateTrack(track.id, { solo })}
              >
                <span className="trax-switch-lever" />
              </Toggle>
              <span className="trax-switch-label">{ko.trackMix.solo}</span>
            </div>
          </div>
        </div>

        <div className="trax-knobs">
          <Knob
            face="trax"
            size="large"
            label={VOLUME_LABEL}
            caption={ko.trackMix.volume}
            value={track.volume}
            min={0}
            max={1}
            step={0.01}
            defaultValue={DEFAULT_TRACK_VOLUME}
            format={formatVolume}
            entry={VOLUME_ENTRY}
            onChange={(volume) => updateTrack(track.id, { volume })}
            {...gesture}
          />
          <Knob
            face="trax"
            label={PAN_LABEL}
            caption={ko.trackMix.pan}
            value={track.pan}
            min={-1}
            max={1}
            step={0.01}
            defaultValue={0}
            format={formatPan}
            entry={PAN_ENTRY}
            onChange={(pan) => updateTrack(track.id, { pan })}
            {...gesture}
          />
        </div>
      </div>
    </PanelSection>
  );
}
