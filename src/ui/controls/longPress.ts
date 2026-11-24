import type { Point } from "./menuMath";

/**
 * 길게 누르기 판정(P5-4): 터치에서 500 ms 동안 거의 움직이지 않고 누르고 있으면 우클릭과 같은 메뉴를 연다(삭제가 아니라 메뉴).
 * 마우스는 대상이 아니다(마우스는 우클릭이 있다). 화면을 모르는 순수 코드라 가짜 타이머로 시험한다.
 */
export const LONG_PRESS_MS = 500;
/** 이만큼(px)보다 더 움직이면 끌기·스크롤로 보고 길게 누르기를 취소한다 */
export const LONG_PRESS_TOLERANCE_PX = 10;

export interface LongPressTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: LongPressTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LongPress {
  /** 닿았다. 터치(`pointerType === "touch"`)가 아니면 아무것도 하지 않는다. */
  down(point: Point, pointerType: string): void;
  /** 손가락이 움직였다. 처음 닿은 자리에서 멀어지면 취소한다. */
  move(point: Point): void;
  /** 손가락이 떨어졌다(시간이 차기 전이면 취소). */
  up(): void;
  cancel(): void;
  /** 시간이 차기를 기다리는 중인가 */
  pending(): boolean;
}

export function createLongPress(
  onLongPress: (point: Point) => void,
  options: { delayMs?: number; tolerancePx?: number; timers?: LongPressTimers } = {},
): LongPress {
  const delayMs = options.delayMs ?? LONG_PRESS_MS;
  const tolerancePx = options.tolerancePx ?? LONG_PRESS_TOLERANCE_PX;
  const timers = options.timers ?? browserTimers;
  let handle: unknown;
  let waiting = false;
  let origin: Point = { x: 0, y: 0 };

  function cancel() {
    if (!waiting) return;
    timers.clear(handle);
    waiting = false;
  }

  return {
    down(point, pointerType) {
      cancel();
      if (pointerType !== "touch") return;
      origin = point;
      waiting = true;
      handle = timers.set(() => {
        waiting = false;
        onLongPress(origin);
      }, delayMs);
    },
    move(point) {
      if (!waiting) return;
      if (Math.hypot(point.x - origin.x, point.y - origin.y) > tolerancePx) cancel();
    },
    up: cancel,
    cancel,
    pending: () => waiting,
  };
}
