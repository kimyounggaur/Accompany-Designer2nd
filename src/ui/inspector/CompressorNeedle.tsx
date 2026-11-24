import { useLayoutEffect, useRef } from "react";
import { audioEngine } from "../../audio/currentEngine";
import { displayReduction, needleAngle } from "../../domain/compressor/needle";
import { onFrame } from "../../services/frameLoop";
import { useRecordingStore } from "../../state/recordingStore";
import { useDawStore } from "../../store/useDawStore";

/**
 * 컴프레서 바늘(설계서 P5-6, 보고서 C7).
 *
 * 바늘은 기준 음량 노브가 아니라 컴프레서가 지금 실제로 줄이고 있는 음량을 따른다:
 *  - 재생·녹음 중이고 컴프레서가 켜져 있으면: 공용 프레임 루프가 매 프레임 엔진에서 압축량(`reduction`, dB)을 읽어 바늘을 돌린다.
 *    React 상태를 거치지 않고 `style.transform`을 직접 고치므로 이 칸이 다시 그려지지 않는다(재생선과 같은 방식).
 *  - 그 밖에는: 쉬는 자리(오른쪽 끝, 0)로 돌아온다.
 * 읽은 값은 `data-reduction`(dB, 소수 첫째 자리)에도 적어 둔다. 시험이 바늘의 각도 대신 이 값을 본다.
 */
export function CompressorNeedle({ trackId, enabled }: { trackId: string; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const playing = useDawStore((state) => state.isPlaying);
  const capturing = useRecordingStore((state) => state.status === "recording");
  const live = enabled && (playing || capturing);

  // 화면에 그려지기 전에 쉬는 자리를 잡는다. 켜지는 순간 바늘이 엉뚱한 자리에서 출발하지 않도록.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let placed = Number.NaN;
    const place = (reductionDb: number) => {
      const reduction = displayReduction(reductionDb);
      if (reduction === placed) return;
      placed = reduction;
      element.style.transform = `rotate(${needleAngle(reduction)}deg)`;
      element.dataset.reduction = String(reduction);
    };
    place(0);
    if (!live) return;
    return onFrame(() => place(audioEngine.getCompressorReduction(trackId)));
  }, [trackId, live]);

  return <div ref={ref} className="comp-vu-needle" data-testid="comp-needle" aria-hidden="true" />;
}
