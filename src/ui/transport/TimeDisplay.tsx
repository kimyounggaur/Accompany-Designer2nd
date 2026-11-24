import { useLayoutEffect, useRef } from "react";
import { readPlayhead } from "../../app/playhead";
import { onFrame } from "../../services/frameLoop";
import { useDawStore } from "../../store/useDawStore";
import { formatTime } from "../../utils/audioMath";

/** 재생 중 시간 표시를 고치는 간격(ms). 초당 30번이면 눈으로 구별되지 않는다. */
export const TIME_UPDATE_INTERVAL_MS = 33;

/**
 * 시간 표시(설계서 §P5-3). 글자는 React가 아니라 `textContent`를 직접 고쳐 바꾼다.
 *  - 멈춰 있을 때: 편집 커서 자리. 커서가 바뀔 때만 다시 그려진다.
 *  - 재생·녹음 중: 프레임 루프가 초당 30번 지금 위치로 바꾼다. 상단 바는 다시 그려지지 않는다.
 * `<output>`은 바뀔 때마다 읽어 주는 영역이라 초당 30번 바뀌는 글자를 보조 기술이 읽지 않도록 `aria-live="off"`로 둔다.
 */
export function TimeDisplay() {
  const ref = useRef<HTMLOutputElement>(null);
  const cursor = useDawStore((state) => state.cursor);
  const moving = useDawStore((state) => state.isPlaying);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let shown = "";
    let last = Number.NEGATIVE_INFINITY;
    const show = () => {
      const text = formatTime(readPlayhead());
      if (text === shown) return;
      shown = text;
      element.textContent = text;
    };
    show();
    if (!moving) return;
    return onFrame((now) => {
      if (now - last < TIME_UPDATE_INTERVAL_MS) return;
      last = now;
      show();
    });
  }, [cursor, moving]);

  return <output ref={ref} className="time-display" data-testid="time-display" aria-live="off" />;
}
