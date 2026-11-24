import { Magnet } from "lucide-react";
import { useDawStore } from "../../store/useDawStore";
import { CommittedNumberInput } from "../controls/CommittedNumberInput";

/** 프로젝트 템포 · 스냅 */
export function TempoControls() {
  const bpm = useDawStore((state) => state.bpm);
  const setBpm = useDawStore((state) => state.setBpm);
  const snapEnabled = useDawStore((state) => state.snapEnabled);
  const setSnapEnabled = useDawStore((state) => state.setSnapEnabled);

  return (
    <div className="transport-group">
      <label className="number-control">
        <span>템포</span>
        <CommittedNumberInput label="템포" testId="tempo-input" min={20} max={300} value={bpm} onCommit={setBpm} />
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
