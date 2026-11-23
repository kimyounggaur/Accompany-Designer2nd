import { X } from "lucide-react";
import { useEffect } from "react";
import { NOTICE_DURATION_MS, useNoticeStore, type Notice } from "../../state/noticeStore";
import { LayoutNotice } from "./LayoutNotice";

function Toast({ notice }: { notice: Notice }) {
  const dismiss = useNoticeStore((state) => state.dismiss);
  const duration = NOTICE_DURATION_MS[notice.level];

  // 같은 안내가 다시 오면(stamp가 바뀌면) 닫히는 시간을 다시 잰다.
  useEffect(() => {
    if (duration === null) return;
    const timer = window.setTimeout(() => dismiss(notice.id), duration);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.stamp, duration, dismiss]);

  return (
    <div
      className={`toast toast--${notice.level}`}
      role={notice.level === "error" ? "alert" : "status"}
      data-testid="toast"
      data-level={notice.level}
    >
      <span className="toast__message">{notice.message}</span>
      {notice.count > 1 && (
        <span className="toast__count" aria-label={`${notice.count}번 반복`}>
          ×{notice.count}
        </span>
      )}
      {notice.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            notice.action?.run();
            dismiss(notice.id);
          }}
        >
          {notice.action.label}
        </button>
      )}
      <button type="button" className="toast__close" onClick={() => dismiss(notice.id)} aria-label="안내 닫기" title="닫기">
        <X size={14} />
      </button>
    </div>
  );
}

/** 오류(빨강, 닫을 때까지)·경고(노랑, 8초)·완료(초록, 3초) 안내를 아래쪽 가운데에 쌓아 보인다. */
export function ToastRegion() {
  const notices = useNoticeStore((state) => state.notices);
  return (
    <div className="toast-region" data-testid="toast-region" role="region" aria-label="알림">
      <LayoutNotice />
      {notices.map((notice) => (
        <Toast key={notice.id} notice={notice} />
      ))}
    </div>
  );
}
