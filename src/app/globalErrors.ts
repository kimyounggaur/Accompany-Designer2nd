import { ko } from "../i18n/ko";
import { notifyError } from "../services/notify";

/**
 * 브라우저가 알려 주는 "잡히지 않은 오류"가 사용자에게 보여 줄 만한 것인가.
 * 브라우저 확장 프로그램이나 다른 출처 스크립트의 오류("Script error.")와,
 * 화면 크기 관찰 때 브라우저가 습관적으로 올리는 무해한 경고는 알리지 않는다.
 */
export function isIgnorableWindowError(message: string, error: unknown, filename: string): boolean {
  if (/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/.test(message)) return true;
  if (error == null && !filename) return true;
  return false;
}

/** window 오류와 처리되지 않은 약속 거절을 공용 안내 통로로 보낸다(조용히 사라지던 실패를 사용자가 알 수 있게). */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    if (isIgnorableWindowError(event.message, event.error, event.filename)) return;
    notifyError(event.error ?? event.message, { kind: "generic", title: ko.failed.unexpected });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    notifyError(event.reason, { kind: "generic", title: ko.failed.unexpected });
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
