/**
 * 파일을 타임라인에 끌어다 놓을 때 놓일 자리(P5-5). 화면을 모르는 순수 계산이라 좌표만 넘기면 시험할 수 있다.
 *
 * - 트랙 칸: 놓은 곳의 세로 위치를 트랙 높이로 나눈 몫. 눈금자 위쪽(음수)은 첫 트랙으로 본다.
 *   트랙 아래 빈 곳은 칸 번호가 트랙 수와 같다 — 새 트랙을 만들어 놓는다는 뜻이다(칸 번호를 트랙 수에서 멈춰 둔다: 멀리 놓아도 트랙은 하나만 늘어난다).
 * - 시간: 놓은 곳의 가로 위치를 초로 바꾸고 스냅(마디·박·…)에 맞춘다. 스냅을 끄거나 Alt를 누르면 맞추지 않는다.
 * - 파일이 여럿이면 놓은 칸부터 차례로 아래 트랙에 놓고(같은 시간), 모자란 트랙은 새로 만든다(`dropRowAt`).
 *   놓은 곳의 트랙에 이미 클립이 있어도 놓는다 — 사용자가 직접 고른 자리라서 겹침을 따지지 않는다(파일 메뉴 올리기의 "빈 트랙 찾기" 규칙과 다르다).
 */
import { snapTime } from "../../utils/audioMath";

/** 놓을 자리를 계산하는 데 필요한 화면·문서 값 */
export interface DropView {
  zoomPxPerSecond: number;
  /** 트랙 한 칸의 높이(px) */
  trackHeight: number;
  /** 지금 트랙 수 */
  trackCount: number;
  bpm: number;
  /** 스냅을 쓰는가(스냅 켜짐이고 Alt를 누르지 않았을 때) */
  snap: boolean;
  /** 박을 몇 칸으로 나눈 스냅인가(`gridDivision`) */
  gridDivision: number;
}

/** 놓일 자리 */
export interface DropPlacement {
  /** 첫 파일을 놓을 트랙 칸(0부터). 트랙 수와 같으면 새 트랙을 만들어 놓는다. */
  row: number;
  /** 클립이 시작할 곡 위치(초) */
  time: number;
}

/** 타임라인의 (x, y) 픽셀(눈금 영역 왼쪽 위가 0, 가로 스크롤 반영)에 놓았을 때의 자리 */
export function dropPlacementAt(x: number, y: number, view: DropView): DropPlacement {
  const rawRow = view.trackHeight > 0 && Number.isFinite(y) ? Math.floor(y / view.trackHeight) : 0;
  const row = Math.min(Math.max(0, rawRow), Math.max(0, view.trackCount));
  const seconds = Number.isFinite(x) ? Math.max(0, x) / view.zoomPxPerSecond : 0;
  return { row, time: snapTime(seconds, view.bpm, view.snap, view.gridDivision) };
}

/** 새 트랙을 만들어 놓는 자리인가(트랙 아래 빈 곳) */
export function isNewTrackDrop(placement: DropPlacement, trackCount: number): boolean {
  return placement.row >= trackCount;
}

/** `placedCount`개를 이미 놓은 뒤 다음 파일이 갈 트랙 칸. 트랙 수 이상이면 그 칸까지 새 트랙을 만든다. */
export function dropRowAt(placement: DropPlacement, placedCount: number): number {
  return placement.row + Math.max(0, Math.floor(placedCount));
}
