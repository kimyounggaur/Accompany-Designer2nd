/**
 * 사용자 동작 → 스토어 호출 → 안내.
 *
 * 스토어 함수는 안내 문구를 만들지 않고 결과(ok/fail)만 돌려준다.
 * 이 파일이 결과를 보고 어떤 안내를 어느 곳(토스트·상태 줄)에 보낼지 정한다.
 * 안내 문장 자체는 i18n/ko.ts에 있다. 화면 부품은 스토어의 해당 함수를 직접 부르지 말고 여기 있는 함수를 부른다.
 *
 * 안내 규칙(설계 P2-2)
 *  - 오류: 토스트(빨강, 닫을 때까지) + 상태 줄
 *  - 경고: 토스트(노랑, 8초)
 *  - 완료: 토스트(초록, 3초)
 *  - 정보: 상태 줄만
 *  - 도구·스냅·녹음 옵션·화면 모드처럼 화면이 이미 보여 주는 상태 변화: 안내하지 않음
 */
import { clipsToCutAt } from "../domain/timeline/clipMath";
import { ko } from "../i18n/ko";
import { useDawStore } from "../store/useDawStore";
import { useRecordingStore } from "../state/recordingStore";
import { history } from "../state/history";
import { copyClips, readClipboard } from "../services/clipboard";
import { confirmAction } from "../services/confirm";
import { notify } from "../services/notify";
import { findClip } from "../utils/audioMath";
import { readPlayhead } from "./playhead";

const store = () => useDawStore.getState();
const text = ko.notice;

// ───── 되돌리기 ─────

export function undo() {
  const result = store().undo();
  if (result.ok) notify("info", text.undone);
  else notify("info", result.reason === "recording" ? text.undoLockedWhileRecording : text.nothingToUndo);
}

export function redo() {
  const result = store().redo();
  if (result.ok) notify("info", text.redone);
  else notify("info", result.reason === "recording" ? text.undoLockedWhileRecording : text.nothingToRedo);
}

// ───── 녹음 대기 ─────

export function toggleRecordingArm(trackId: string) {
  const result = useRecordingStore.getState().toggleArm(trackId);
  if (!result.ok) {
    notify("warning", text.armLockedWhileRecording);
    return;
  }
  notify("info", result.armed ? text.armed : text.disarmed);
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
  if (!clipId) notify("info", text.drawNeedsSource);
  return clipId;
}

// ───── 삭제 안전장치(설계 P5-4) ─────

/** 클립을 지운 뒤 "되돌리기" 안내가 떠 있는 시간(ms) */
export const DELETE_UNDO_MS = 5000;

/**
 * 클립 삭제 안내: 5초 동안 [되돌리기]가 붙은 토스트.
 * 되돌리기는 방금 지운 그 단계가 이력의 맨 위일 때만 한다. 그 사이에 다른 편집을 했다면 실행 취소가 엉뚱한 편집을 되돌리게 되므로
 * 하지 않고 안내만 한다(실행 취소 단축키로 순서대로 되돌릴 수 있다).
 */
function announceDeletion(message: string) {
  const step = history.topId();
  notify("success", message, {
    durationMs: DELETE_UNDO_MS,
    action: { label: text.undoDelete, run: () => undoDeletion(step) },
  });
}

/** 지운 직후의 이력 단계(step)가 아직 맨 위일 때만 되돌린다. 되돌렸으면 true. */
export function undoDeletion(step: number | undefined): boolean {
  if (step === undefined || history.topId() !== step) {
    notify("warning", text.undoDeleteStale);
    return false;
  }
  undo();
  return true;
}

export function deleteClip(clipId: string) {
  if (!findClip(store().tracks, clipId)) return; // 이미 없는 클립: 지운 일이 없으니 안내도 없다
  store().deleteClip(clipId);
  announceDeletion(text.clipDeleted);
}

export function deleteSelectedClips() {
  const result = store().deleteSelectedClips();
  if (!result.ok) {
    notify("info", text.noClipSelected);
    return;
  }
  announceDeletion(result.count === 1 ? text.clipDeleted : text.clipsDeleted(result.count));
}

// ───── 클립 메뉴(설계 P5-4) ─────

/**
 * 재생선(편집 커서)이 있는 자리에서 클립을 자른다(Ctrl+E, 클립 메뉴). 고른 클립이 있으면 그중 재생선이 안쪽에 있는 클립을,
 * 고른 클립이 없으면 재생선이 지나는 모든 트랙의 클립을 자른다. 자른 클립이 없으면 이유만 안내하고 문서는 바꾸지 않는다.
 * 여러 클립을 잘라도 실행 취소 한 단계이고, 오른쪽 조각들이 선택된다.
 */
export function sliceSelectedClipsAtPlayhead() {
  const state = store();
  const position = readPlayhead();
  const ids = clipsToCutAt(state.tracks, state.bpm, state.selectedClipIds, position);
  if (!ids.length) {
    notify("info", state.selectedClipIds.length ? text.playheadOutsideSelection : text.playheadOnNoClip);
    return;
  }
  const result = store().sliceClipsAt(ids, position);
  if (result.ok) notify("info", result.count === 1 ? text.clipSliced : text.clipsSliced(result.count));
}

/**
 * 고른 클립들을 바로 뒤에 복제한다(Ctrl+D, 클립 메뉴). 고른 클립 전체를 한 덩어리로 보고 덩어리가 끝난 자리에 같은 간격으로 놓는다.
 * 복제본이 선택된다. 고른 클립이 없으면 안내만 한다.
 */
export function duplicateSelectedClips() {
  const result = store().duplicateSelectedClips();
  if (!result.ok) {
    notify("info", text.duplicateNeedsSelection);
    return;
  }
  notify("info", result.count === 1 ? text.clipDuplicated : text.clipsDuplicated(result.count));
}

/**
 * 고른 클립들의 음소거를 한꺼번에 바꾼다: 하나라도 소리가 나면 모두 음소거하고, 모두 음소거 상태였으면 모두 푼다.
 * 여러 클립이어도 실행 취소 한 단계로 되돌아간다.
 */
export function toggleSelectedClipsMuted() {
  const state = store();
  const chosen = new Set(state.selectedClipIds);
  const clips = state.tracks.flatMap((track) => track.clips).filter((clip) => chosen.has(clip.id));
  if (!clips.length) return;
  const muteAll = clips.some((clip) => !clip.muted);
  history.beginGesture("clips:mute");
  try {
    for (const clip of clips) if (Boolean(clip.muted) !== muteAll) state.toggleClipMuted(clip.id);
  } finally {
    history.endGesture();
  }
}

/** 클립 이름을 바꾼다. 앞뒤 공백은 지우고, 비어 있으면 바꾸지 않고 안내한다. 바꿨으면 true. */
export function renameClip(clipId: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) {
    notify("info", text.clipNameEmpty);
    return false;
  }
  store().updateClip(clipId, { name: trimmed });
  return true;
}

export function sliceClipAt(clipId: string, splitTime: number) {
  const result = store().sliceClipAt(clipId, splitTime);
  if (result.ok) {
    notify("info", text.clipSliced);
    return;
  }
  notify("info", result.reason === "not-found" ? text.sliceNeedsClip : text.sliceNeedsInside);
}

export function quantizeSelectedClips() {
  const result = store().quantizeSelectedClips();
  notify("info", result.ok ? text.clipsQuantized(result.count) : text.nothingToQuantize);
}

export function groupSelectedClips() {
  const result = store().groupSelectedClips();
  notify("info", result.ok ? text.clipsGrouped(result.count) : text.groupNeedsTwo);
}

export function ungroupSelectedClips() {
  const result = store().ungroupSelectedClips();
  notify("info", result.ok ? text.ungrouped : text.nothingToUngroup);
}

export function zoomToSelectedClips() {
  const result = store().zoomToSelectedClips();
  if (!result.ok) notify("info", text.zoomNeedsClip);
}

/** "전체 보기"(Shift+0): 프로젝트 전체가 화면 폭에 들어오게 줄이고 처음으로 돌아간다. */
export function zoomToFit() {
  if (!store().zoomToFit().ok) return; // 화면 폭을 모르면(아직 그려지기 전) 할 일이 없다
  const scroll = document.querySelector<HTMLElement>(".timeline-scroll");
  if (scroll) scroll.scrollLeft = 0;
}

/** 확대·축소 단추와 PageUp·PageDown이 한 번에 바꾸는 폭(px/초) */
const ZOOM_STEP = 16;
/** 빠른 확대 1·2·3(Shift+1·2·3)과 빠른 축소(Shift+4)의 배율(px/초) */
const QUICK_ZOOM = { preset1: 72, preset2: 132, preset3: 220, out: 72 } as const;

export function zoomIn() {
  store().setZoom(store().zoomPxPerSecond + ZOOM_STEP);
}

export function zoomOut() {
  store().setZoom(store().zoomPxPerSecond - ZOOM_STEP);
}

export function quickZoom(which: keyof typeof QUICK_ZOOM) {
  store().setZoom(QUICK_ZOOM[which]);
}

export function resetSelectedClipSource() {
  const result = store().resetSelectedClipSource();
  notify("info", result.ok ? text.sourceReset : text.resetNeedsClip);
}

// ───── 복사·붙여넣기 ─────

/** 선택한 클립을 복사한다. 선택이 없으면 안내만 하고, 먼저 복사해 둔 것은 그대로 둔다. */
export function copySelectedClips() {
  const state = store();
  const count = copyClips(state.tracks, state.selectedClipIds);
  notify("info", count ? text.clipsCopied(count) : text.copyNeedsSelection);
}

/**
 * 복사해 둔 클립을 재생 위치에 붙인다. 복사한 것 중 가장 앞의 클립이 재생 위치에 오고 나머지는 서로의 시간·트랙 간격을 지킨다.
 * 트랙은 지금 고른 트랙(클립이 아니라 트랙만 골랐을 때) → 복사한 클립이 있던 트랙 순서로 정하고, 아래로 이어지는 트랙이 모자라면 새 트랙을 만든다.
 * 붙인 클립들은 실행 취소 한 단계로 되돌아가고, 하나도 붙이지 못했으면 붙였다고 알리지 않는다.
 */
export function pasteClips() {
  const content = readClipboard();
  if (!content) {
    notify("info", text.pasteNeedsCopy);
    return;
  }
  // 재생 중에 붙이면 눈앞에서 흐르는 위치에 붙는다(예전과 같다).
  const result = store().pasteClips(content, readPlayhead());
  if (!result.ok) {
    notify("info", result.reason === "no-source" ? text.pasteNeedsSource : text.pasteNeedsCopy);
    return;
  }
  notify("info", result.newTracks > 0 ? text.clipsPastedToNewTracks(result.count, result.newTracks) : text.clipsPasted(result.count));
}

// ───── 선택 ─────

/** 끌어서 고른 클립들을 선택한다. 두 개 이상일 때만 개수를 알린다. */
export function setSelectedClips(clipIds: string[]) {
  store().setSelectedClips(clipIds);
  const count = store().selectedClipIds.length;
  if (count >= 2) notify("info", text.clipsSelected(count));
}

export function selectAllClips() {
  store().selectAllClips();
  const count = store().selectedClipIds.length;
  notify("info", count ? text.clipsSelected(count) : text.nothingToSelect);
}

/** 메뉴·단추로 선택을 풀 때. (빈 곳을 눌러 풀 때는 스토어의 clearSelection을 그대로 쓴다.) */
export function clearSelection() {
  store().clearSelection();
  notify("info", text.selectionCleared);
}

// ───── 마커 ─────

export function clearTimeMarkers() {
  store().clearTimeMarkers();
  notify("info", text.markersCleared);
}

// ───── 트랙 ─────

/**
 * 트랙을 지운다. 클립이 들어 있는 트랙만 확인창을 거치고(설계 P5-4), 빈 트랙은 바로 지운다(실행 취소로 되돌릴 수 있다).
 * 지웠으면 true.
 */
export async function deleteTrack(trackId: string): Promise<boolean> {
  const track = store().tracks.find((item) => item.id === trackId);
  if (!track) return false;

  if (track.clips.length > 0) {
    const confirmed = await confirmAction({
      title: ko.confirm.deleteTrack.title,
      message: ko.confirm.deleteTrack.message(track.name, track.clips.length),
      confirmLabel: ko.confirm.deleteTrack.confirmLabel,
      tone: "danger",
    });
    if (!confirmed) return false;
  }

  const result = store().deleteTrack(trackId);
  if (result.ok) {
    notify("info", text.trackDeleted(result.name));
    return true;
  }
  if (result.reason === "recording") notify("warning", text.trackDeleteLockedWhileRecording);
  else if (result.reason === "last-track") notify("info", text.needsOneTrack);
  return false;
}
