import { isNewTrackDrop, type DropPlacement } from "../../domain/timeline/drop";
import { ko } from "../../i18n/ko";

interface DropIndicatorProps {
  placement: DropPlacement;
  trackCount: number;
  trackHeight: number;
  zoomPxPerSecond: number;
}

/**
 * 파일을 끌고 있을 때 놓일 자리를 보여 준다(P5-5): 놓을 트랙 칸에 세로 줄(클립이 시작할 시간)을 긋는다.
 * 트랙 아래 빈 곳이면 마지막 트랙 아래쪽에 "새 트랙에 놓기"를 띄운다. 눈금 영역 안에만 그려져서 스크롤 길이를 바꾸지 않는다.
 */
export function DropIndicator({ placement, trackCount, trackHeight, zoomPxPerSecond }: DropIndicatorProps) {
  const newTrack = isNewTrackDrop(placement, trackCount);
  const row = Math.min(placement.row, Math.max(0, trackCount - 1));
  const height = newTrack ? 28 : trackHeight;
  const top = newTrack ? (row + 1) * trackHeight - height : row * trackHeight;
  return (
    <div
      className={`drop-indicator ${newTrack ? "new-track" : ""}`}
      data-testid="drop-indicator"
      style={{ left: placement.time * zoomPxPerSecond, top, height }}
      aria-hidden="true"
    >
      {newTrack && <span>{ko.timeline.dropNewTrack}</span>}
    </div>
  );
}
