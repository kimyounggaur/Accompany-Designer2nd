import { useNoticeStore, type NoticeLevel, type PushOptions } from "../state/noticeStore";
import { toUserMessage, type ErrorContext } from "./errors";

/** 사용자에게 보이는 모든 안내는 이 함수로만 보낸다. */
export function notify(level: NoticeLevel, message: string, options?: PushOptions): void {
  useNoticeStore.getState().push(level, message, options);
}

/**
 * 실패 안내. 브라우저의 영어 오류는 한국어 문장으로 바꿔 보내고(services/errors.ts),
 * 원문은 토스트의 접힌 "자세히 보기"에만 남긴다.
 */
export function notifyError(error: unknown, context: ErrorContext, options?: Pick<PushOptions, "action">): void {
  const { message, detail } = toUserMessage(error, context);
  notify("error", message, { detail, action: options?.action });
}
