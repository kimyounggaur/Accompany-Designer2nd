import { useNoticeStore } from "../../state/noticeStore";

/** 아래 상태 줄의 안내 문구. 가장 최근 안내를 보이고, 긴 문구는 말줄임으로 자르며 전체는 title로 보여 준다. */
export function StatusLine() {
  const message = useNoticeStore((state) => state.statusMessage);
  return (
    <p className="status-line" data-testid="status-line" title={message}>
      <span className="status-text">{message}</span>
    </p>
  );
}
