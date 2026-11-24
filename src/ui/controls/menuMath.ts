/**
 * 우클릭 메뉴의 계산(P5-4). 화면·DOM을 모르는 순수 함수라 Node 단위 시험이 닿는다.
 */
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** 메뉴와 화면 가장자리 사이에 남겨 두는 여백(px) */
export const MENU_EDGE_MARGIN = 8;

/**
 * 한 방향의 자리를 정한다.
 * - 끝 여백까지 지키고도 들어가면 누른 자리 그대로(앞쪽 밖에서 눌렀으면 앞 여백까지만 당긴다).
 * - 넘치면 누른 자리를 메뉴의 끝으로 삼아 반대쪽으로 펼친다(이때도 끝 여백은 지킨다).
 * - 반대쪽으로도 안 되면 끝 여백에 붙이고, 메뉴가 화면보다 커서 그마저 안 되면 앞 여백에 붙인다.
 */
function fit(anchor: number, length: number, room: number, margin: number): number {
  const last = room - margin - length; // 끝 여백을 지키는 가장 먼 시작점
  if (last < margin) return margin;
  if (anchor <= last) return Math.max(margin, anchor);
  const flipped = anchor - length;
  return flipped >= margin ? Math.min(flipped, last) : last;
}

/**
 * 메뉴를 놓을 왼쪽 위 자리. 누른 자리(anchor)에서 시작하되 화면(viewport) 밖으로 나가면 안쪽으로 옮긴다.
 * 메뉴가 화면보다 크면 여백만 남기고 맨 위·왼쪽에 놓는다(넘치는 부분은 메뉴가 스스로 스크롤한다).
 */
export function placeMenu(anchor: Point, size: Size, viewport: Size, margin: number = MENU_EDGE_MARGIN): Point {
  return {
    x: fit(anchor.x, size.width, viewport.width, margin),
    y: fit(anchor.y, size.height, viewport.height, margin),
  };
}

export interface StepItem {
  disabled?: boolean;
}

/** 초점을 둘 수 있는 첫·마지막 항목 번호. 없으면 -1. */
export function edgeMenuIndex(items: readonly StepItem[], edge: "first" | "last"): number {
  if (edge === "first") return items.findIndex((item) => !item.disabled);
  for (let index = items.length - 1; index >= 0; index -= 1) if (!items[index].disabled) return index;
  return -1;
}

/**
 * 화살표 키로 다음에 초점이 갈 항목 번호. 쓸 수 없는 항목은 건너뛰고, 끝에서 반대쪽 끝으로 돌아간다.
 * 지금 초점이 어느 항목에도 없으면(current가 범위 밖) 아래 화살표는 첫 항목, 위 화살표는 마지막 항목으로 간다.
 * 쓸 수 있는 항목이 없으면 -1.
 */
export function stepMenuIndex(items: readonly StepItem[], current: number, direction: 1 | -1): number {
  const count = items.length;
  if (count === 0) return -1;
  if (current < 0 || current >= count) return edgeMenuIndex(items, direction === 1 ? "first" : "last");
  for (let step = 1; step <= count; step += 1) {
    const index = (((current + direction * step) % count) + count) % count;
    if (!items[index].disabled) return index;
  }
  return -1;
}
