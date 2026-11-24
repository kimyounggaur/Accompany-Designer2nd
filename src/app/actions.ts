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
import type { Clip } from "../domain/types";
import { ko } from "../i18n/ko";
import { useDawStore } from "../store/useDawStore";
import { useRecordingStore } from "../state/recordingStore";
import { confirmAction } from "../services/confirm";
import { notify } from "../services/notify";
import { createId } from "../utils/audioMath";
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

export function deleteClip(clipId: string) {
  store().deleteClip(clipId);
  notify("info", text.clipDeleted);
}

export function deleteSelectedClips() {
  const result = store().deleteSelectedClips();
  notify("info", result.ok ? text.clipsDeleted(result.count) : text.noClipSelected);
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

/** 앱 안 클립보드: 복사한 클립의 사본. (P5-5에서 services/clipboard.ts로 옮겨 트랙 사이 위치를 지키게 한다.) */
let clipboard: Clip[] = [];

/** 선택한 클립을 복사한다. 선택이 없으면 안내만 하고, 먼저 복사해 둔 것은 그대로 둔다. */
export function copySelectedClips() {
  const state = store();
  const copied = state.tracks
    .flatMap((track) => track.clips.filter((clip) => state.selectedClipIds.includes(clip.id)))
    .map((clip) => ({ ...clip }));
  if (!copied.length) {
    notify("info", text.copyNeedsSelection);
    return;
  }
  clipboard = copied;
  notify("info", text.clipsCopied(copied.length));
}

/**
 * 복사해 둔 클립을 재생 위치에 붙인다. 복사한 것 중 가장 앞의 클립이 재생 위치에 오고 나머지는 서로의 간격을 지킨다.
 * 원래 트랙이 지금 없으면 그 클립은 붙이지 못한다. 하나도 붙이지 못했으면 붙였다고 알리지 않는다.
 */
export function pasteClips() {
  const state = store();
  const first = Math.min(...clipboard.map((clip) => clip.startTime));
  // 재생 중에 붙이면 눈앞에서 흐르는 위치에 붙는다(예전과 같다).
  const at = readPlayhead();
  let pasted = 0;
  for (const clip of clipboard) {
    if (!state.tracks.some((track) => track.id === clip.trackId)) continue;
    state.addClip(clip.trackId, { ...clip, id: createId("clip"), startTime: at + clip.startTime - first });
    pasted += 1;
  }
  notify("info", pasted ? text.clipsPasted(pasted) : text.pasteNeedsCopy);
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

/** 확인창을 거쳐 트랙을 지운다. 지웠으면 true. */
export async function deleteTrackWithConfirm(trackId: string): Promise<boolean> {
  const track = store().tracks.find((item) => item.id === trackId);
  if (!track) return false;

  const confirmed = await confirmAction({
    title: ko.confirm.deleteTrack.title,
    message: ko.confirm.deleteTrack.message(track.name, track.clips.length),
    confirmLabel: ko.confirm.deleteTrack.confirmLabel,
    tone: "danger",
  });
  if (!confirmed) return false;

  const result = store().deleteTrack(trackId);
  if (result.ok) {
    notify("info", text.trackDeleted(result.name));
    return true;
  }
  if (result.reason === "recording") notify("warning", text.trackDeleteLockedWhileRecording);
  else if (result.reason === "last-track") notify("info", text.needsOneTrack);
  return false;
}
