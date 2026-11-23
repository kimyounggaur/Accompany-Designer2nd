import { useNoticeStore, type NoticeAction, type NoticeLevel } from "../state/noticeStore";

/** 사용자에게 보이는 모든 안내는 이 함수로만 보낸다. */
export function notify(level: NoticeLevel, message: string, options?: { action?: NoticeAction }): void {
  useNoticeStore.getState().push(level, message, options);
}

/** 실패 안내. 상황(context)과 원인을 붙여 오류 토스트로 보낸다. (원인 문구의 한국어 변환은 P2-3) */
export function notifyError(context: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  notify("error", detail ? `${context}: ${detail}` : context);
}
