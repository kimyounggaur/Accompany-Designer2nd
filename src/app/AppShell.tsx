import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useDawStore } from "../store/useDawStore";
import { RelinkDialog } from "../ui/dialogs/RelinkDialog";
import { AutosaveStatus } from "../ui/feedback/AutosaveStatus";
import { BuildStamp } from "../ui/feedback/BuildStamp";
import { ConfirmDialog } from "../ui/feedback/ConfirmDialog";
import { ExportDialog } from "../ui/feedback/ExportDialog";
import { StatusLine } from "../ui/feedback/StatusLine";
import { ToastRegion } from "../ui/feedback/ToastRegion";
import { useStoredFlag } from "../ui/useStoredFlag";

interface AppShellProps {
  topBar: ReactNode;
  timeline: ReactNode;
  inspector: ReactNode;
}

/**
 * 화면 틀: 위 상단 바 / 가운데 작업 영역(타임라인 + 오른쪽 패널) / 아래 상태 줄.
 * 내용은 창 폭을 넘지 못하고, 넘치는 부분은 각 영역 안에서만 스크롤한다(layout.css).
 */
export function AppShell({ topBar, timeline, inspector }: AppShellProps) {
  const playlistDetached = useDawStore((state) => state.playlistDetached);
  const [collapsed, setCollapsed] = useStoredFlag("ad.ui.inspectorCollapsed", false);
  const hidden = collapsed || playlistDetached;

  return (
    <main className="app-shell shell">
      {topBar}
      <div
        className={`workspace ${playlistDetached ? "detached" : ""}`}
        data-inspector={hidden ? "collapsed" : "open"}
      >
        {timeline}
        {inspector}
      </div>
      <footer className="statusbar" data-testid="statusbar">
        <StatusLine />
        <AutosaveStatus />
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
        <BuildStamp />
      </footer>
      <ToastRegion />
      <ConfirmDialog />
      <ExportDialog />
      <RelinkDialog />
    </main>
  );
}
