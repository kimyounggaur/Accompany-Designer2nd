import { useState } from "react";
import { readStoredFlag, writeStoredFlag } from "../useStoredFlag";

export const LAYOUT_NOTICE_KEY = "ad.ui.layoutNoticeSeen";

/**
 * 화면 배치가 바뀐 것을 처음 열 때 한 번 알리는 카드(설계 P2-1 위험 대응).
 * 작업 결과를 알리는 안내가 아니므로 notify 통로를 쓰지 않는다(상태 줄의 안내를 덮지 않기 위해).
 * [닫기]는 이번에만 숨기고, [다시 보지 않기]는 기억해 두었다가 다음부터 띄우지 않는다.
 */
export function LayoutNotice() {
  const [visible, setVisible] = useState(() => !readStoredFlag(LAYOUT_NOTICE_KEY, false));
  if (!visible) return null;

  return (
    <div className="toast toast--info" role="status" data-testid="layout-notice">
      <span className="toast__message">
        <strong>화면 배치가 바뀌었습니다.</strong> 올리기·저장·내보내기는 위쪽 [파일] 메뉴에, 안내 문구는 아래 상태 줄에 모였고, WARP는 오른쪽 ‘클립’ 칸으로 옮겼습니다.
      </span>
      <button type="button" className="toast__action" onClick={() => setVisible(false)}>
        닫기
      </button>
      <button
        type="button"
        className="toast__action"
        data-testid="layout-notice-dismiss"
        onClick={() => {
          writeStoredFlag(LAYOUT_NOTICE_KEY, true);
          setVisible(false);
        }}
      >
        다시 보지 않기
      </button>
    </div>
  );
}
