import { Circle, Pause, Play, Square } from "lucide-react";
import { useRecordingStore } from "../../state/recordingStore";
import { useDawStore } from "../../store/useDawStore";
import { countRender } from "../debug/renderCount";
import { TimeDisplay } from "./TimeDisplay";

interface TransportControlsProps {
  isRecording: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onRecordToggle: () => void;
}

/** 재생/일시정지 · 정지 · 녹음 · 시간 표시 */
export function TransportControls({ isRecording, onPlayPause, onStop, onRecordToggle }: TransportControlsProps) {
  const isPlaying = useDawStore((state) => state.isPlaying);
  const preparing = useRecordingStore((state) => state.status === "preparing");
  countRender("TransportControls");

  return (
    <div className="transport-group">
      <button
        className="icon-button primary"
        onClick={onPlayPause}
        onContextMenu={(event) => {
          event.preventDefault();
          onStop();
        }}
        title="재생/일시정지"
        data-testid="transport-play"
        type="button"
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button className="icon-button" onClick={onStop} title="정지" data-testid="transport-stop" type="button">
        <Square size={17} />
      </button>
      <button
        className={`icon-button record-button ${isRecording && !preparing ? "recording" : ""} ${preparing ? "preparing" : ""}`}
        onClick={onRecordToggle}
        title={isRecording ? "녹음 정지" : "보컬 녹음"}
        data-testid="transport-record"
        type="button"
      >
        <Circle size={16} fill="currentColor" />
      </button>
      <TimeDisplay />
    </div>
  );
}
