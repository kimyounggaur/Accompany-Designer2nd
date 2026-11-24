import { useLayoutEffect, useRef } from "react";
import { readPlayhead } from "../../app/playhead";
import { onFrame } from "../../services/frameLoop";
import { useDawStore } from "../../store/useDawStore";

/**
 * 재생선(설계서 §P5-3, 보고서 C10).
 *
 * 위치는 React가 아니라 `style.transform`을 직접 고쳐 정한다:
 *  - 멈춰 있을 때: 편집 커서(`cursor`) 자리. 커서가 바뀌거나 확대가 바뀔 때만 이 부품이 다시 그려진다.
 *  - 재생·녹음 중: 프레임 루프가 매 프레임 지금 위치(`readPlayhead()`)로 옮긴다. 스토어는 바뀌지 않으므로 `Timeline`도 다시 그려지지 않는다.
 * 예전에는 재생 위치를 매 프레임 스토어에 써서 `Timeline` 전체가 초당 60번 다시 그려졌다.
 */
export function PlayheadOverlay({ height }: { height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useDawStore((state) => state.zoomPxPerSecond);
  const cursor = useDawStore((state) => state.cursor);
  const moving = useDawStore((state) => state.isPlaying);

  // 화면에 그려지기 전에 자리를 잡는다(처음 0px에서 깜빡이지 않도록).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let placed = Number.NaN;
    const place = () => {
      const x = readPlayhead() * zoom;
      if (x === placed) return;
      placed = x;
      element.style.transform = `translateX(${x}px)`;
    };
    place();
    if (!moving) return;
    return onFrame(place);
  }, [zoom, cursor, moving]);

  return <div ref={ref} className="playhead" data-testid="playhead" style={{ height }} />;
}
