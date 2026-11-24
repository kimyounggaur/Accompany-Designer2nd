import { useDawStore } from "../../store/useDawStore";

/**
 * 노브·슬라이더를 끄는 동안의 변경을 실행 취소 한 단계로 묶는 연결(`Knob`·`Slider`의 `onChangeStart`·`onChangeEnd`).
 * 컨트롤은 스토어를 모르므로, 칸(패널)이 이 연결을 펼쳐서 넘긴다. 묶음 키를 정하는 것은 P5-1에서 한다.
 */
export function useHistoryGesture() {
  const onChangeStart = useDawStore((state) => state.beginHistoryGroup);
  const onChangeEnd = useDawStore((state) => state.endHistoryGroup);
  return { onChangeStart, onChangeEnd };
}
