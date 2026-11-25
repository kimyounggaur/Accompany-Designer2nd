/**
 * 휴대폰 화면으로 보는 폭(설계서 §P6-5): 768px 미만이면 "재생·녹음" 모드(한 줄 상단 바 · 보기 전용 타임라인 · 아래에서 올라오는 시트).
 * 메모리 기준(§P6-4 `domain/memory/budget`)이 휴대폰급으로 보는 화면 폭과 같은 값이라 한 곳에서 정한다.
 */
export const PHONE_BREAKPOINT = 768;

/** CSS 미디어 쿼리: 휴대폰 화면 */
export const PHONE_QUERY = `(max-width: ${PHONE_BREAKPOINT - 1}px)`;

/** 이 폭(px)은 휴대폰 화면인가 */
export function isPhoneWidth(width: number): boolean {
  return width < PHONE_BREAKPOINT;
}
