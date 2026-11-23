/**
 * 사용자 동작 → 스토어 호출 → 안내.
 *
 * 스토어 함수는 안내 문구를 만들지 않고 결과(ok/fail)만 돌려준다.
 * 이 파일이 결과를 보고 어떤 안내를 어느 곳(토스트·상태 줄)에 보낼지 정한다.
 * 화면 부품은 스토어의 해당 함수를 직접 부르지 말고 여기 있는 함수를 부른다.
 *
 * 안내 규칙(설계 P2-2)
 *  - 오류: 토스트(빨강, 닫을 때까지) + 상태 줄
 *  - 경고: 토스트(노랑, 8초)
 *  - 완료: 토스트(초록, 3초)
 *  - 정보: 상태 줄만
 *  - 도구·스냅·녹음 옵션·화면 모드처럼 화면이 이미 보여 주는 상태 변화: 안내하지 않음
 */
import { useDawStore } from "../store/useDawStore";
import { confirmAction } from "../services/confirm";
import { notify } from "../services/notify";

const store = () => useDawStore.getState();

// ───── 되돌리기 ─────

export function undo() {
  const result = store().undo();
  notify("info", result.ok ? "실행 취소" : "실행 취소할 작업이 없습니다.");
}

export function redo() {
  const result = store().redo();
  notify("info", result.ok ? "다시 실행" : "다시 실행할 작업이 없습니다.");
}

// ───── 녹음 대기 ─────

export function toggleRecordingArm(trackId: string) {
  const result = store().toggleRecordingArm(trackId);
  if (!result.ok) {
    notify("warning", "녹음 중에는 녹음 대기 트랙을 바꿀 수 없습니다.");
    return;
  }
  notify("info", result.armed ? "이 트랙에 녹음하도록 설정했습니다." : "녹음 대기 트랙을 해제했습니다.");
}

// ───── 클립 ─────

/** 그리기·페인트 도구로 클립을 만든다. 만들 수 없으면 undefined. */
export function addClipFromSource(
  sourceClipId: string | undefined,
  trackId: string,
  startTime: number,
  options?: { history?: boolean },
): string | undefined {
  const clipId = store().addClipFromSource(sourceClipId, trackId, startTime, options);
  if (!clipId) notify("info", "오디오를 업로드하거나 클립을 선택한 뒤 그리세요.");
  return clipId;
}

export function deleteClip(clipId: string) {
  store().deleteClip(clipId);
  notify("info", "클립 삭제됨");
}

export function deleteSelectedClips() {
  const result = store().deleteSelectedClips();
  notify("info", result.ok ? `클립 ${result.count}개 삭제됨` : "선택된 클립이 없습니다.");
}

export function sliceClipAt(clipId: string, splitTime: number) {
  const result = store().sliceClipAt(clipId, splitTime);
  if (result.ok) {
    notify("info", "클립 자르기 완료");
    return;
  }
  notify("info", result.reason === "not-found" ? "자를 클립을 선택하세요." : "클립 내부를 클릭해 자르세요.");
}

export function quantizeSelectedClips() {
  const result = store().quantizeSelectedClips();
  notify("info", result.ok ? `클립 ${result.count}개 퀀타이즈됨` : "퀀타이즈할 클립이 없습니다.");
}

export function groupSelectedClips() {
  const result = store().groupSelectedClips();
  notify("info", result.ok ? `클립 ${result.count}개 그룹화됨` : "그룹화할 클립을 두 개 이상 선택하세요.");
}

export function ungroupSelectedClips() {
  const result = store().ungroupSelectedClips();
  notify("info", result.ok ? "선택 클립 그룹 해제됨" : "해제할 선택 그룹이 없습니다.");
}

export function zoomToSelectedClips() {
  const result = store().zoomToSelectedClips();
  if (!result.ok) notify("info", "확대할 클립을 선택하세요.");
}

export function resetSelectedClipSource() {
  const result = store().resetSelectedClipSource();
  notify("info", result.ok ? "선택 클립 소스 초기화됨" : "소스를 초기화할 클립을 선택하세요.");
}

// ───── 선택 ─────

/** 끌어서 고른 클립들을 선택한다. 두 개 이상일 때만 개수를 알린다. */
export function setSelectedClips(clipIds: string[]) {
  store().setSelectedClips(clipIds);
  const count = store().selectedClipIds.length;
  if (count >= 2) notify("info", `클립 ${count}개 선택됨`);
}

export function selectAllClips() {
  store().selectAllClips();
  const count = store().selectedClipIds.length;
  notify("info", count ? `클립 ${count}개 선택됨` : "선택할 클립이 없습니다.");
}

/** 메뉴·단추로 선택을 풀 때. (빈 곳을 눌러 풀 때는 스토어의 clearSelection을 그대로 쓴다.) */
export function clearSelection() {
  store().clearSelection();
  notify("info", "선택 해제됨");
}

// ───── 마커 ─────

export function clearTimeMarkers() {
  store().clearTimeMarkers();
  notify("info", "타임 마커 삭제됨");
}

// ───── 트랙 ─────

/** 확인창을 거쳐 트랙을 지운다. 지웠으면 true. */
export async function deleteTrackWithConfirm(trackId: string): Promise<boolean> {
  const track = store().tracks.find((item) => item.id === trackId);
  if (!track) return false;

  const confirmed = await confirmAction({
    title: "트랙 삭제",
    message: `'${track.name}' 트랙과 클립 ${track.clips.length}개를 삭제할까요? 실행 취소로 복원할 수 있습니다.`,
    confirmLabel: "삭제",
    tone: "danger",
  });
  if (!confirmed) return false;

  const result = store().deleteTrack(trackId);
  if (result.ok) {
    notify("info", `${result.name} 트랙이 삭제되었습니다. 실행 취소로 되돌릴 수 있습니다.`);
    return true;
  }
  if (result.reason === "recording") notify("warning", "녹음 중에는 트랙을 삭제할 수 없습니다.");
  else if (result.reason === "last-track") notify("info", "트랙은 하나 이상 필요합니다.");
  return false;
}
