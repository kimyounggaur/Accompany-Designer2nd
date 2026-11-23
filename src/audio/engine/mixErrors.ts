/** 사용자가 내보내기를 취소해서 하던 일을 버렸다. 실패가 아니므로 화면은 오류 대신 "취소했습니다"로 알린다. */
export class MixCancelledError extends Error {
  constructor() {
    super("내보내기를 취소했습니다.");
    this.name = "MixCancelledError";
  }
}

export function isMixCancelled(error: unknown): boolean {
  return error instanceof MixCancelledError || (error instanceof Error && error.name === "MixCancelledError");
}
