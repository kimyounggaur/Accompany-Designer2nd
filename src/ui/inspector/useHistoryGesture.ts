import { useMemo } from "react";
import { history } from "../../state/history";

/**
 * 노브·슬라이더를 끄는 동안의 변경을 실행 취소 한 단계로 묶는 연결(`Knob`·`Slider`의 `onChangeStart`·`onChangeEnd`).
 * 컨트롤은 문서도 이력도 모르므로, 칸(패널)이 이 연결을 펼쳐서 넘긴다. key는 무엇을 끄는지(`track:t1:eq`)를 알려 준다.
 * 누름에서 열려 뗌에서 닫힌다. 뗌 신호를 놓쳐도 문서 전체의 뗌·창 blur(state/gestureGuards)와 2초 제한이 닫는다.
 * 키보드로 값을 올리는 것은 묶음 없이 명령이 만드는 key(state/commands/editKey)가 800ms 안에서 한 단계로 묶는다.
 */
export function useHistoryGesture(key: string) {
  return useMemo(
    () => ({
      onChangeStart: () => {
        history.beginGesture(key);
      },
      onChangeEnd: () => {
        history.endGesture();
      },
    }),
    [key],
  );
}

/** 글자 입력 칸용: 초점이 들어올 때부터 나갈 때까지(또는 2초 쉴 때까지)의 입력을 한 단계로 묶는다. 칸 안을 눌러도 끝나지 않는다. */
export function useTextGesture(key: string) {
  return useMemo(
    () => ({
      onFocus: () => {
        history.beginGesture(key, "focus");
      },
      onBlur: () => {
        history.endGesture({ kind: "focus" });
      },
    }),
    [key],
  );
}
