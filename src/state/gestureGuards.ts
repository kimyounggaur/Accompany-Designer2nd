/**
 * 조작 묶음(끌기)이 끝나지 않고 남는 일을 막는 안전장치(S8).
 *
 * 노브·슬라이더·클립은 저마다 "뗌"에서 묶음을 닫지만, 뗌 신호가 그 부품에 닿지 않는 경우가 있다
 * (창 밖에서 놓음, 알림 창이 떠서 창이 포커스를 잃음, 탭이 숨겨짐, 부품이 끌던 도중에 사라짐 …).
 * 그래서 문서 전체에서도 한 번 더 닫는다. 그래도 놓치면 history의 2초 제한이 마지막으로 닫는다.
 *
 *  - 문서의 pointerup·pointercancel(포착 단계): 끌기("pointer" 묶음)만 닫는다. 글자 입력("focus" 묶음)은 칸을 눌러도 닫지 않는다.
 *    같은 뗌을 받는 다른 부품(슬라이더의 끝 처리 등)이 먼저 마지막 편집을 하도록, 한 박자 뒤에 닫는다.
 *  - 창 blur, 탭 숨김(visibilitychange): 모든 묶음을 닫는다.
 */
import type { GestureFilter, OpenGesture } from "./history";

type Listener = () => void;

interface ListenerTarget {
  addEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void;
  removeEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void;
}

/** 포착 단계. 거둘 때 같은 모양으로 넘겨야 한다(Node의 EventTarget은 removeEventListener의 불리언 인자를 포착으로 읽지 않는다). */
const CAPTURE = { capture: true } as const;

export interface GestureGuardDocument extends ListenerTarget {
  readonly hidden?: boolean;
}

export interface GestureGuardSubject {
  openGesture(): OpenGesture | undefined;
  endGesture(filter?: GestureFilter): void;
}

/** 안전장치를 건다. 돌려주는 함수를 부르면 거둔다. */
export function installGestureGuards(
  subject: GestureGuardSubject,
  doc: GestureGuardDocument = document,
  win: ListenerTarget = window,
): () => void {
  const endPointerGesture = () => {
    const open = subject.openGesture();
    if (!open || open.kind !== "pointer") return;
    // 번호까지 맞아야 닫는다: 한 박자 사이에 새 끌기가 시작됐다면 그것은 건드리지 않는다.
    setTimeout(() => subject.endGesture({ id: open.id }), 0);
  };
  const endAnyGesture = () => subject.endGesture();
  const onVisibility = () => {
    if (doc.hidden) endAnyGesture();
  };

  doc.addEventListener("pointerup", endPointerGesture, CAPTURE);
  doc.addEventListener("pointercancel", endPointerGesture, CAPTURE);
  win.addEventListener("blur", endAnyGesture);
  doc.addEventListener("visibilitychange", onVisibility);

  return () => {
    doc.removeEventListener("pointerup", endPointerGesture, CAPTURE);
    doc.removeEventListener("pointercancel", endPointerGesture, CAPTURE);
    win.removeEventListener("blur", endAnyGesture);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
