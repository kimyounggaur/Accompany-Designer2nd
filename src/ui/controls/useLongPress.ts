import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { createLongPress } from "./longPress";
import type { Point } from "./menuMath";

/**
 * 길게 누르기를 요소의 포인터 이벤트에 연결한다. 돌려주는 네 함수를 그 요소의 같은 이름의 이벤트에서 부르면 된다
 * (이미 그 이벤트를 듣고 있는 요소는 자기 처리 앞에서 이 함수를 불러 준다).
 */
export function useLongPress(onLongPress: (point: Point) => void) {
  const callback = useRef(onLongPress);
  callback.current = onLongPress;
  const machine = useMemo(() => createLongPress((point) => callback.current(point)), []);
  useEffect(() => () => machine.cancel(), [machine]);

  return useMemo(
    () => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) =>
        machine.down({ x: event.clientX, y: event.clientY }, event.pointerType),
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => machine.move({ x: event.clientX, y: event.clientY }),
      onPointerUp: () => machine.up(),
      onPointerCancel: () => machine.cancel(),
    }),
    [machine],
  );
}
