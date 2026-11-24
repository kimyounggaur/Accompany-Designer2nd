import { useEffect, useState } from "react";
import { audioEngine } from "../../audio/currentEngine";
import { plainEntry } from "../controls/entries";
import { Slider, type SliderEntry } from "../controls/Slider";
import {
  MASTER_VOLUME_DEFAULT_DB,
  MASTER_VOLUME_MAX_DB,
  MASTER_VOLUME_MIN_DB,
  MASTER_VOLUME_STEP_DB,
} from "../../domain/master/volume";
import { ko } from "../../i18n/ko";
import { useProject } from "../../state/projectStore";
import { useRecordingStore } from "../../state/recordingStore";
import { useDawStore } from "../../store/useDawStore";
import { PanelSection } from "./PanelSection";
import { useHistoryGesture } from "./useHistoryGesture";

/** 마스터 볼륨 숫자 칸: 슬라이더와 같은 단위(dB) */
const VOLUME_ENTRY: SliderEntry = {
  ...plainEntry(ko.master.volumeInput, MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB, MASTER_VOLUME_STEP_DB),
  className: "master-number",
  testId: "master-volume-input",
};

/** 리미터 표시 막대가 가득 차는 동작량(dB) */
const REDUCTION_FULL_DB = 12;
/** 동작량을 읽어 오는 간격(ms). 리미터가 약 43ms마다 알려 오므로 그보다 자주 읽을 필요가 없다 */
const REDUCTION_POLL_MS = 100;

/** 리미터가 소리를 누르고 있는 양(dB, 0 이하). 재생·녹음 중에만 읽는다. */
function useLimiterReduction(active: boolean): number {
  const [reduction, setReduction] = useState(0);
  useEffect(() => {
    if (!active) {
      setReduction(0);
      return undefined;
    }
    const read = () => setReduction(Math.round(Math.min(0, audioEngine.getLimiterReduction()) * 10) / 10);
    read();
    const timer = window.setInterval(read, REDUCTION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  return reduction;
}

/**
 * 마스터 칸: 마스터 볼륨(−60 ~ +6 dB, 문서에 저장되고 실행 취소 대상)과 리미터가 누르는 양.
 * 볼륨은 슬라이더와 숫자 칸으로 정한다(설계서 §P4-4). 마스터 미터(레벨 미터 칸) 바로 위에 둔다.
 */
export function MasterPanel() {
  const volumeDb = useProject((state) => state.doc.master?.volumeDb ?? MASTER_VOLUME_DEFAULT_DB);
  const setMasterVolumeDb = useDawStore((state) => state.setMasterVolumeDb);
  const gesture = useHistoryGesture("master");
  const capturing = useRecordingStore((state) => state.status === "recording");
  const active = useDawStore((state) => state.isPlaying) || capturing;
  const reduction = useLimiterReduction(active);
  const text = ko.master;
  const working = reduction <= -0.1;

  return (
    <PanelSection id="master" title={text.heading} className="master-panel">
      <div className="master-row">
        <label className="master-label" htmlFor="master-volume">{text.volumeLabel}</label>
        <output className="master-value" htmlFor="master-volume" data-testid="master-volume-value">
          {text.volumeValue(volumeDb)}
        </output>
      </div>
      <div className="master-row">
        <Slider
          id="master-volume"
          className="master-slider"
          label={text.volumeLabel}
          min={MASTER_VOLUME_MIN_DB}
          max={MASTER_VOLUME_MAX_DB}
          step={MASTER_VOLUME_STEP_DB}
          value={volumeDb}
          defaultValue={MASTER_VOLUME_DEFAULT_DB}
          format={text.volumeValue}
          testId="master-volume"
          entry={VOLUME_ENTRY}
          onChange={setMasterVolumeDb}
          {...gesture}
        />
        <button
          type="button"
          className="text-button master-reset"
          title={text.resetTitle}
          disabled={volumeDb === MASTER_VOLUME_DEFAULT_DB}
          onClick={() => setMasterVolumeDb(MASTER_VOLUME_DEFAULT_DB)}
        >
          {text.resetLabel}
        </button>
      </div>
      <div className="master-row master-limiter" title={text.limiterHint}>
        <span className="master-label">{text.limiterLabel}</span>
        <span
          className={`master-reduction-bar ${working ? "working" : ""}`}
          role="meter"
          aria-label={text.limiterMeterLabel}
          aria-valuemin={-REDUCTION_FULL_DB}
          aria-valuemax={0}
          aria-valuenow={Math.max(-REDUCTION_FULL_DB, reduction)}
          aria-valuetext={text.limiterValue(reduction)}
          data-testid="limiter-reduction"
          data-reduction={reduction}
        >
          <span style={{ width: `${Math.min(100, (-reduction / REDUCTION_FULL_DB) * 100)}%` }} />
        </span>
        <output className={`master-value ${working ? "working" : ""}`} data-testid="limiter-reduction-value">
          {text.limiterValue(reduction)}
        </output>
      </div>
    </PanelSection>
  );
}
