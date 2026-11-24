/**
 * 재생선 따라가기(P5-3): 재생 중 재생선이 보이는 구간을 벗어나면 가로 스크롤을 옮긴다. 화면과 스토어를 모르는 순수 계산.
 * 예전에는 `Timeline`의 효과 안에 있었고 재생선 위치가 바뀔 때마다(프레임마다) 컴포넌트가 다시 그려졌다.
 */

/** 재생선이 오른쪽 끝에서 이만큼(px) 안쪽에 들어와야 보이는 것으로 본다. */
export const FOLLOW_RIGHT_MARGIN = 30;
/** 따라가며 스크롤할 때 재생선을 화면 왼쪽에서 이 비율 자리에 둔다. */
export const FOLLOW_LEAD_RATIO = 0.2;

/**
 * 재생선 위치(`x`, 스크롤 영역 안의 px)가 보이는 구간 밖이면 새 `scrollLeft`를, 보이면 `undefined`를 돌려준다.
 */
export function followScrollLeft(x: number, scrollLeft: number, clientWidth: number): number | undefined {
  if (x >= scrollLeft && x <= scrollLeft + clientWidth - FOLLOW_RIGHT_MARGIN) return undefined;
  return Math.max(0, x - clientWidth * FOLLOW_LEAD_RATIO);
}
