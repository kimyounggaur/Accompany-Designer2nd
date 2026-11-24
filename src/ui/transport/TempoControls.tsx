import { Magnet } from "lucide-react";
import { TIME_SIGNATURES, findTimeSignature, sameTimeSignature, timeSignatureLabel } from "../../domain/timeline/snap";
import { useRecordingStore } from "../../state/recordingStore";
import { useDawStore } from "../../store/useDawStore";
import { CommittedNumberInput } from "../controls/CommittedNumberInput";

/** 프로젝트 템포 · 박자표 · 스냅 */
export function TempoControls() {
  const bpm = useDawStore((state) => state.bpm);
  const setBpm = useDawStore((state) => state.setBpm);
  const timeSignature = useDawStore((state) => state.timeSignature);
  const setTimeSignature = useDawStore((state) => state.setTimeSignature);
  const snapEnabled = useDawStore((state) => state.snapEnabled);
  const setSnapEnabled = useDawStore((state) => state.setSnapEnabled);
  const recordingBusy = useRecordingStore((state) => state.status !== "idle");
  // 불러온 프로젝트의 박자표가 선택지에 없으면(3/8 같은) 그 값도 고를 수 있는 항목으로 보여 준다.
  const choices = TIME_SIGNATURES.some((signature) => sameTimeSignature(signature, timeSignature))
    ? TIME_SIGNATURES
    : [...TIME_SIGNATURES, timeSignature];

  return (
    <div className="transport-group">
      <label className="number-control">
        <span>템포</span>
        <CommittedNumberInput label="템포" testId="tempo-input" min={20} max={300} value={bpm} onCommit={setBpm} />
      </label>
      <label className="input-select-control time-signature-control">
        <span>박자</span>
        <select
          aria-label="박자표"
          data-testid="time-signature"
          disabled={recordingBusy}
          value={timeSignatureLabel(timeSignature)}
          onChange={(event) => {
            const next = findTimeSignature(event.target.value);
            if (next) setTimeSignature(next);
          }}
        >
          {choices.map((signature) => (
            <option key={timeSignatureLabel(signature)} value={timeSignatureLabel(signature)}>
              {timeSignatureLabel(signature)}
            </option>
          ))}
        </select>
      </label>
      <button
        className={`icon-button ${snapEnabled ? "active" : ""}`}
        onClick={() => setSnapEnabled(!snapEnabled)}
        title="스냅"
        aria-pressed={snapEnabled}
        type="button"
      >
        <Magnet size={17} />
      </button>
    </div>
  );
}
