import {
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
import { useRef } from "react";
import { useDawStore } from "../store/useDawStore";
import { formatTime } from "../utils/audioMath";

interface TransportBarProps {
  status: string;
  onFiles: (files: FileList) => void;
  onLoadProject: (file: File) => void;
  onPlayPause: () => void;
  onSaveProject: () => void;
  onStop: () => void;
}

export function TransportBar({
  status,
  onFiles,
  onLoadProject,
  onPlayPause,
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
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button className="icon-button" onClick={onStop} title="정지">
          <Square size={17} />
        </button>
        <output className="time-display">{formatTime(playhead)}</output>
      </div>

      <div className="transport-group">
        <label className="number-control">
          <span>템포</span>
          <input
            type="number"
            min={20}
            max={300}
            value={bpm}
            onChange={(event) => setBpm(Number(event.target.value))}
          />
        </label>
        <button
          className={`icon-button ${snapEnabled ? "active" : ""}`}
          onClick={() => setSnapEnabled(!snapEnabled)}
          title="스냅"
        >
          <Magnet size={17} />
        </button>
      </div>

      <div className="transport-group">
        <button
          className="icon-button"
          onClick={() => setZoom(zoomPxPerSecond - 16)}
          title="축소"
        >
          <ZoomOut size={17} />
        </button>
        <button
          className="icon-button"
          onClick={() => setZoom(zoomPxPerSecond + 16)}
          title="확대"
        >
          <ZoomIn size={17} />
        </button>
      </div>

      <div className="transport-group">
        <input
          ref={fileInputRef}
          accept="audio/*,.mp3,.wav,.m4a"
          multiple
          type="file"
          hidden
          onChange={(event) => {
            if (event.target.files) {
              onFiles(event.target.files);
              event.target.value = "";
            }
          }}
        />
        <button
          className="text-button"
          onClick={() => fileInputRef.current?.click()}
          title="오디오 업로드"
        >
          <Upload size={17} />
          <span>업로드</span>
        </button>

        <input
          ref={projectInputRef}
          accept="application/json,.json"
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onLoadProject(file);
              event.target.value = "";
            }
          }}
        />
        <button
          className="icon-button"
          onClick={() => projectInputRef.current?.click()}
          title="프로젝트 불러오기"
        >
          <FolderOpen size={17} />
        </button>
        <button className="icon-button" onClick={onSaveProject} title="프로젝트 저장">
          <Save size={17} />
        </button>
      </div>

      <p className="status-line">{status}</p>
    </header>
  );
}
