import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { ko } from "../i18n/ko";
import { usePhoneSheetStore } from "../state/phoneSheetStore";
import { useDawStore } from "../store/useDawStore";
import { RelinkDialog } from "../ui/dialogs/RelinkDialog";
import { AutosaveStatus } from "../ui/feedback/AutosaveStatus";
import { BuildStamp } from "../ui/feedback/BuildStamp";
import { ConfirmDialog } from "../ui/feedback/ConfirmDialog";
import { ExportDialog } from "../ui/feedback/ExportDialog";
import { LiveAnnouncer } from "../ui/feedback/LiveAnnouncer";
import { StatusLine } from "../ui/feedback/StatusLine";
import { ToastRegion } from "../ui/feedback/ToastRegion";
import { PhoneSheet } from "../ui/phone/PhoneSheet";
import { usePhoneMode } from "../ui/usePhoneMode";
import { useStoredFlag } from "../ui/useStoredFlag";

interface AppShellProps {
  topBar: ReactNode;
  timeline: ReactNode;
  inspector: ReactNode;
}

/**
 * 화면 틀: 위 상단 바 / 가운데 작업 영역(타임라인 + 오른쪽 패널) / 아래 상태 줄.
 * 내용은 창 폭을 넘지 못하고, 넘치는 부분은 각 영역 안에서만 스크롤한다(layout.css).
 * 화면 폭이 768px 미만이면 휴대폰 "재생·녹음" 모드(설계서 §P6-5): 오른쪽 패널 대신 아래에서 올라오는 시트를 둔다.
 */
export function AppShell({ topBar, timeline, inspector }: AppShellProps) {
  const playlistDetached = useDawStore((state) => state.playlistDetached);
  const [collapsed, setCollapsed] = useStoredFlag("ad.ui.inspectorCollapsed", false);
  const hidden = collapsed || playlistDetached;
  const phone = usePhoneMode();

  // 넓은 화면으로 바뀌면 아래 시트는 사라진다. 다시 좁아졌을 때 열린 채로 나타나지 않게 닫아 둔다.
  useEffect(() => {
    if (!phone) usePhoneSheetStore.getState().setOpen(false);
  }, [phone]);

  return (
    <main className="app-shell shell" data-phone={phone}>
      <h1 className="visually-hidden">{ko.announce.appTitle}</h1>
      {topBar}
      <div
        className={`workspace ${playlistDetached ? "detached" : ""}`}
        data-inspector={hidden ? "collapsed" : "open"}
      >
        {timeline}
        {!phone && inspector}
      </div>
      <footer className="statusbar" data-testid="statusbar">
        <StatusLine />
        <AutosaveStatus />
        {!phone && (
          <button
            type="button"
            className="statusbar__toggle"
            onClick={() => setCollapsed(!collapsed)}
            disabled={playlistDetached}
            aria-pressed={!hidden}
            aria-label="오른쪽 패널 보이기"
            title={hidden ? "오른쪽 패널 펴기" : "오른쪽 패널 접기"}
            data-testid="inspector-toggle"
          >
            {hidden ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            <span>패널</span>
          </button>
        )}
        <BuildStamp />
      </footer>
      {phone && <PhoneSheet />}
      <ToastRegion />
      <LiveAnnouncer />
      <ConfirmDialog />
      <ExportDialog />
      <RelinkDialog />
    </main>
  );
}
