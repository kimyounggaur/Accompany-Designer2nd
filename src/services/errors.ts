/**
 * 브라우저·라이브러리의 영어 오류를 사용자에게 보여 줄 한국어 문구로 바꾼다.
 *
 *  - 알려진 오류(오디오 해독 실패, 마이크 권한·장치·사용 중, 저장 공간 부족)는 해결 방법이 담긴 문장으로 바꾼다.
 *  - 이 앱이 직접 던진 오류(이미 한국어)는 "○○ 실패: 사유" 꼴로 그대로 보인다.
 *  - 그 밖의 오류는 "예상하지 못한 문제가 생겼습니다."로 바꾸고, 원문은 detail에만 담는다.
 *    detail은 토스트의 접힌 "자세히 보기"에서만 보인다(개발·문의용). 상태 줄에는 나가지 않는다.
 *
 * 순수 함수라서 화면 없이 테스트할 수 있다. 실제로 안내를 띄우는 일은 services/notify.ts의 notifyError가 한다.
 */
import { ko } from "../i18n/ko";

export type ErrorKind =
  /** 업로드한 파일을 오디오로 읽는 중 */
  | "decode"
  /** 마이크를 열거나 녹음을 시작하는 중 */
  | "microphone"
  /** 브라우저 안에 자동 저장하는 중 */
  | "autosave"
  /** 프로젝트 파일(.json)을 읽는 중 */
  | "projectFile"
  /** 그 밖 */
  | "generic";

export interface ErrorContext {
  kind: ErrorKind;
  /** 원인을 알 수 없을 때 앞에 붙는 "○○ 실패" (예: "프로젝트 저장 실패") */
  title: string;
  /** kind가 "decode"일 때 읽지 못한 파일 이름 */
  fileName?: string;
}

export interface UserMessage {
  /** 토스트와 상태 줄에 보일 한국어 문장 */
  message: string;
  /** 원문 오류. 있을 때만 토스트에 접힌 "자세히 보기"가 붙는다. */
  detail?: string;
}

const HANGUL = /[가-힣]/;

const MIC_DENIED = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);
const MIC_NOT_FOUND = new Set(["NotFoundError", "OverconstrainedError", "ConstraintNotSatisfiedError", "DevicesNotFoundError"]);
const MIC_BUSY = new Set(["NotReadableError", "TrackStartError", "AbortError"]);

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error && typeof (error as { name: unknown }).name === "string") {
    return (error as { name: string }).name;
  }
  return "";
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return error === undefined || error === null ? "" : String(error);
}

function isQuotaExceeded(error: unknown, name: string, text: string): boolean {
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return code === 22 || code === 1014 || /quota/i.test(text);
}

/** 원문을 "이름: 내용" 한 줄로. 의미 없는 이름("Error")은 뗀다. */
function describe(name: string, text: string): string | undefined {
  const label = name && name !== "Error" ? name : "";
  if (label && text) return `${label}: ${text}`;
  return label || text || undefined;
}

export function toUserMessage(error: unknown, context: ErrorContext): UserMessage {
  const name = errorName(error);
  const text = errorText(error);
  const detail = describe(name, text);
  const appAuthored = HANGUL.test(text);

  if (context.kind === "decode" && !appAuthored) {
    return { message: ko.error.decode(context.fileName ?? ""), detail };
  }

  if (context.kind === "microphone") {
    if (MIC_DENIED.has(name)) return { message: ko.error.micDenied, detail };
    if (MIC_NOT_FOUND.has(name)) return { message: ko.error.micNotFound, detail };
    if (MIC_BUSY.has(name)) return { message: ko.error.micBusy, detail };
  }

  if (context.kind === "projectFile" && !appAuthored) {
    if (name === "SyntaxError") return { message: ko.error.projectInvalid, detail };
    if (name === "EncodingError") return { message: ko.error.projectAudio, detail };
  }

  if (isQuotaExceeded(error, name, text)) {
    return { message: context.kind === "autosave" ? ko.error.quotaAutosave : ko.error.quota, detail };
  }

  // 이 앱이 직접 던진 한국어 사유는 그대로 보인다(원문 detail 없음).
  if (appAuthored) return { message: `${context.title}: ${text}` };

  // 알 수 없는 오류: 영어 원문은 숨기고 detail에만 둔다.
  return { message: `${context.title}: ${ko.error.unexpected}`, detail };
}
