import { SlidersHorizontal } from "lucide-react";
import { ko } from "../../i18n/ko";
import { usePhoneSheetStore } from "../../state/phoneSheetStore";
import { useDawStore } from "../../store/useDawStore";
import { countRender } from "../debug/renderCount";
import { useTextGesture } from "../inspector/useHistoryGesture";
import { useMediaQuery } from "../useMediaQuery";
import { usePhoneMode } from "../usePhoneMode";
import { FileMenu } from "./FileMenu";
import { RecordOptions } from "./RecordOptions";
import { TempoControls } from "./TempoControls";
import { TransportControls } from "./TransportControls";
import { ZoomControls } from "./ZoomControls";

interface TopBarProps {
  isRecording: boolean;
  onFiles: (files: FileList) => void;
  onLoadProject: (file: File) => void;
  onPlayPause: () => void;
  onRecordToggle: () => void;
  onSaveProject: () => void;
  onExportMix: () => void;
  onRelink: () => void;
  onStop: () => void;
}

/**
 * 상단 바. 폭에 따라 부품 배치만 바꾼다(부품 자체는 같다).
 *   1600px 이상  : 한 줄 (프로젝트 이름 · 재생 · 템포 · 확대 · 녹음 옵션 · 파일)
 *   1280~1599px  : 두 줄 (2행: 녹음 옵션 · 확대)
 *   1279px 이하  : 두 줄 (2행: "녹음 설정" 팝오버 · 확대)
 *   768px 미만   : 휴대폰 "재생·녹음" 모드. 한 줄 (재생 · 정지 · 녹음 · 시간 · 트랙과 녹음 설정 시트 단추 · 파일). 확대 단추는 타임라인 쪽에 있다(설계서 §P6-5).
 * 같은 부품은 한 번에 하나만 그린다(단추가 겹쳐 생기지 않도록).
 */
export function TopBar({
  isRecording,
  onFiles,
  onLoadProject,
  onPlayPause,
  onRecordToggle,
  onSaveProject,
  onExportMix,
  onRelink,
  onStop,
}: TopBarProps) {
  countRender("TopBar");
  const phone = usePhoneMode();
  const sheetOpen = usePhoneSheetStore((state) => state.open);
  const toggleSheet = usePhoneSheetStore((state) => state.toggle);
  const wide = useMediaQuery("(min-width: 1600px)");
  const narrow = useMediaQuery("(max-width: 1279px)");
  const projectName = useDawStore((state) => state.name);
  const setProjectName = useDawStore((state) => state.setProjectName);
  const nameGesture = useTextGesture("project:name");

  const layout = phone ? "phone" : wide ? "wide" : narrow ? "narrow" : "medium";

  if (phone) {
    return (
      <header className="transport topbar" data-testid="topbar" data-layout="phone">
        <div className="topbar__row topbar__row--primary">
          <TransportControls
            isRecording={isRecording}
            onPlayPause={onPlayPause}
            onStop={onStop}
            onRecordToggle={onRecordToggle}
          />
          <div className="topbar__spacer" />
          <button
            type="button"
            className={`icon-button phone-sheet-toggle ${sheetOpen ? "active" : ""}`}
            data-testid="phone-sheet-toggle"
            aria-expanded={sheetOpen}
            aria-controls="phone-sheet"
            aria-haspopup="dialog"
            aria-label={ko.phone.sheetButton}
            title={ko.phone.sheetButton}
            onClick={toggleSheet}
          >
            <SlidersHorizontal size={20} />
          </button>
          <FileMenu
            onFiles={onFiles}
            onLoadProject={onLoadProject}
            onSaveProject={onSaveProject}
            onExportMix={onExportMix}
            onRelink={onRelink}
          />
        </div>
      </header>
    );
  }

  return (
    <header className="transport topbar" data-testid="topbar" data-layout={layout}>
      <div className="topbar__row topbar__row--primary">
        <div className="transport-group session-name">
          <input
            aria-label="프로젝트 이름"
            value={projectName}
            {...nameGesture}
            onChange={(event) => setProjectName(event.target.value)}
          />
        </div>
        <TransportControls
          isRecording={isRecording}
          onPlayPause={onPlayPause}
          onStop={onStop}
          onRecordToggle={onRecordToggle}
        />
        <TempoControls />
        {wide && <ZoomControls />}
        {wide && <RecordOptions isRecording={isRecording} variant="inline" />}
        <div className="topbar__spacer" />
        <FileMenu
          onFiles={onFiles}
          onLoadProject={onLoadProject}
          onSaveProject={onSaveProject}
          onExportMix={onExportMix}
          onRelink={onRelink}
        />
      </div>

      {!wide && (
        <div className="topbar__row topbar__row--secondary">
          <RecordOptions isRecording={isRecording} variant={narrow ? "popover" : "inline"} />
          <ZoomControls />
        </div>
      )}
    </header>
  );
}
