import {
  Circle,
  FolderOpen,
  Magnet,
  Pause,
  Play,
  Save,
  Square,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useMemo, useRef } from "react";
import { useDawStore } from "../store/useDawStore";
import { findClip, formatTime, getClipPlaybackRate } from "../utils/audioMath";

interface TransportBarProps {
  isRecording: boolean;
  status: string;
  onFiles: (files: FileList) => void;
  onLoadProject: (file: File) => void;
  onPlayPause: () => void;
  onRecordToggle: () => void;
  onSaveProject: () => void;
  onStop: () => void;
}

export function TransportBar({
  isRecording,
  status,
  onFiles,
  onLoadProject,
  onPlayPause,
  onRecordToggle,
  onSaveProject,
  onStop,
}: TransportBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const isPlaying = useDawStore((state) => state.isPlaying);
  const playhead = useDawStore((state) => state.playhead);
  const bpm = useDawStore((state) => state.bpm);
  const setBpm = useDawStore((state) => state.setBpm);
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const setZoom = useDawStore((state) => state.setZoom);
  const snapEnabled = useDawStore((state) => state.snapEnabled);
  const setSnapEnabled = useDawStore((state) => state.setSnapEnabled);
  const projectName = useDawStore((state) => state.name);
  const setProjectName = useDawStore((state) => state.setProjectName);
  const tracks = useDawStore((state) => state.tracks);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const updateClip = useDawStore((state) => state.updateClip);

  const selectedClip = useMemo(
    () => findClip(tracks, selectedClipId)?.clip,
    [tracks, selectedClipId],
  );
  const playbackRate = selectedClip ? getClipPlaybackRate(bpm, selectedClip) : 1;
  const warpOn = selectedClip?.stretchMode === "resample";

  return (
    <header className="transport">
      <div className="transport-group session-name">
        <input
          aria-label="프로젝트 이름"
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
        />
      </div>

      <div className="transport-group">
        <button
          className="icon-button primary"
          onClick={onPlayPause}
          onContextMenu={(event) => {
            event.preventDefault();
            onStop();
          }}
          title="재생/일시정지"
          type="button"
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button className="icon-button" onClick={onStop} title="정지" type="button">
          <Square size={17} />
        </button>
        <button
          className={`icon-button record-button ${isRecording ? "recording" : ""}`}
          onClick={onRecordToggle}
          title={isRecording ? "녹음 정지" : "보컬 녹음"}
          type="button"
        >
          <Circle size={16} fill="currentColor" />
        </button>
        <output className="time-display">{formatTime(playhead)}</output>
      </div>

      <div className="transport-group">
        <label className="number-control">
          <span>템포</span>
          <input
            max={300}
            min={20}
            onChange={(event) => setBpm(Number(event.target.value))}
            type="number"
            value={bpm}
          />
        </label>
        <button
          className={`icon-button ${snapEnabled ? "active" : ""}`}
          onClick={() => setSnapEnabled(!snapEnabled)}
          title="스냅"
          type="button"
        >
          <Magnet size={17} />
        </button>
      </div>

      <div className="transport-group">
        <button
          className="icon-button"
          onClick={() => setZoom(zoomPxPerSecond - 16)}
          title="축소"
          type="button"
        >
          <ZoomOut size={17} />
        </button>
        <button
          className="icon-button"
          onClick={() => setZoom(zoomPxPerSecond + 16)}
          title="확대"
          type="button"
        >
          <ZoomIn size={17} />
        </button>
      </div>

      <div className="transport-group">
        <input
          ref={fileInputRef}
          accept="audio/*,.mp3,.wav,.m4a"
          hidden
          multiple
          onChange={(event) => {
            if (event.target.files) {
              onFiles(event.target.files);
              event.target.value = "";
            }
          }}
          type="file"
        />
        <button
          className="text-button"
          onClick={() => fileInputRef.current?.click()}
          title="오디오 업로드"
          type="button"
        >
          <Upload size={17} />
          <span>업로드</span>
        </button>

        <input
          ref={projectInputRef}
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onLoadProject(file);
              event.target.value = "";
            }
          }}
          type="file"
        />
        <button
          className="icon-button"
          onClick={() => projectInputRef.current?.click()}
          title="프로젝트 불러오기"
          type="button"
        >
          <FolderOpen size={17} />
        </button>
        <button
          className="icon-button"
          onClick={onSaveProject}
          title="프로젝트 저장"
          type="button"
        >
          <Save size={17} />
        </button>
      </div>

      <div className={`warp-header ${!selectedClip ? "warp-inactive" : ""}`}>
        <button
          className={`warp-btn ${warpOn ? "on" : ""}`}
          disabled={!selectedClip}
          onClick={() =>
            selectedClip &&
            updateClip(selectedClip.id, {
              stretchMode: warpOn ? "none" : "resample",
            })
          }
          title={warpOn ? "Warp 끄기" : "Warp 켜기"}
          type="button"
        >
          <span className="warp-led" />
          <span>WARP</span>
        </button>

        <label className="warp-field">
          <span className="warp-label">원본 BPM</span>
          <input
            className="warp-input"
            disabled={!selectedClip}
            max={300}
            min={20}
            onChange={(event) =>
              selectedClip &&
              updateClip(selectedClip.id, {
                sourceBpm: Number(event.target.value) || bpm,
              })
            }
            step={0.1}
            type="number"
            value={selectedClip?.sourceBpm ?? bpm}
          />
        </label>

        <div className="warp-rate" title="현재 재생 배속">
          <span className="warp-label">배속</span>
          <span
            className={`warp-rate-val ${
              warpOn && Math.abs(playbackRate - 1) > 0.01 ? "warp-rate-active" : ""
            }`}
          >
            {warpOn ? `${playbackRate.toFixed(2)}×` : "1.00×"}
          </span>
        </div>
      </div>

      <p className="status-line">{status}</p>
    </header>
  );
}
