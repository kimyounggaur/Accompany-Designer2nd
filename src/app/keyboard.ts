/**
 * 키보드 단축키 연결(설계서 §P5-2). 예전에는 App.tsx의 `onKeyDown` 한 덩어리(약 150줄의 if 줄)였다.
 *
 * 역할을 나눈다.
 *  - `services/shortcuts.ts`: 어떤 키가 어떤 동작인가(표), 한글 조합·입력 칸 판정, 키 표기. 화면과 스토어를 모르는 순수 코드.
 *  - 이 파일: 표의 동작 이름마다 "무엇을 부르는가"를 잇고, 창 전체에서 키를 듣는 곳을 한 군데로 모은다.
 *    `Record<ShortcutId, …>`라서 표에 동작을 더하고 여기에 연결을 빠뜨리면 컴파일이 실패한다.
 *
 * 동작 자체(재생·복사·확대 …)는 `actions.ts`·`transport.ts`·`recording.ts`에 있어서 메뉴·단추와 키가 같은 함수를 부른다.
 */
import type { PlaylistTool } from "../domain/types";
import { handleKeyEvent, isTypingTarget, type KeyHandlers } from "../services/shortcuts";
import { useDialogStore } from "../state/dialogStore";
import { isContextMenuOpen } from "../state/menuStore";
import { isExportOpen } from "../state/exportStore";
import { isRelinkOpen } from "../state/relinkStore";
import { useDawStore } from "../store/useDawStore";
import {
  copySelectedClips,
  deleteSelectedClips,
  duplicateSelectedClips,
  pasteClips,
  quantizeSelectedClips,
  quickZoom,
  redo,
  selectAllClips,
  sliceSelectedClipsAtPlayhead,
  undo,
  zoomIn,
  zoomOut,
  zoomToFit,
  zoomToSelectedClips,
} from "./actions";
import { saveProjectFile } from "./projectFile";
import { toggleRecording } from "./recording";
import { stopPlayback, togglePlayback } from "./transport";

/** 도구를 고르는 키. 도구는 화면이 이미 보여 주므로 안내 문구는 없다. */
const selectTool = (tool: PlaylistTool) => () => {
  useDawStore.getState().setPlaylistTool(tool);
};

/** 표(`SHORTCUTS`)의 동작마다 부를 함수. */
export const keyHandlers: KeyHandlers = {
  playPause: () => {
    void togglePlayback();
  },
  stop: stopPlayback,
  record: () => {
    void toggleRecording();
  },
  undo,
  redo,
  save: () => {
    // 입력 칸 안에서 누른 Ctrl+S도 듣는다. 쓰던 값이 저장에서 빠지지 않게 먼저 칸을 떠나 값을 정한다(숫자 칸은 초점이 나갈 때 정한다).
    const active = document.activeElement;
    if (active instanceof HTMLElement && isTypingTarget(active)) active.blur();
    void saveProjectFile();
  },
  copy: copySelectedClips,
  paste: pasteClips,
  duplicate: duplicateSelectedClips,
  sliceAtPlayhead: sliceSelectedClipsAtPlayhead,
  selectAll: selectAllClips,
  deleteClips: () => {
    // 고른 클립이 없으면 할 일이 없다(안내도, 키의 기본 동작 막기도 하지 않는다).
    if (!useDawStore.getState().selectedClipIds.length) return false;
    deleteSelectedClips();
    return true;
  },
  "tool:move": selectTool("move"),
  "tool:draw": selectTool("draw"),
  "tool:paint": selectTool("paint"),
  "tool:delete": selectTool("delete"),
  "tool:mute": selectTool("mute"),
  "tool:slip": selectTool("slip"),
  "tool:slice": selectTool("slice"),
  "tool:select": selectTool("select"),
  "tool:zoom": selectTool("zoom"),
  "tool:play-selected": selectTool("play-selected"),
  quantize: quantizeSelectedClips,
  zoomIn,
  zoomOut,
  zoomPreset1: () => quickZoom("preset1"),
  zoomPreset2: () => quickZoom("preset2"),
  zoomPreset3: () => quickZoom("preset3"),
  zoomOutQuick: () => quickZoom("out"),
  zoomSelection: zoomToSelectedClips,
  zoomFit: zoomToFit,
};

/** 확인창·내보내기·재연결 대화상자나 우클릭 메뉴가 열려 있는 동안에는 뒤의 화면을 건드리는 단축키(삭제·재생 등)를 모두 막는다. */
export function isShortcutBlocked(): boolean {
  return Boolean(useDialogStore.getState().confirm) || isExportOpen() || isRelinkOpen() || isContextMenuOpen();
}

/**
 * 창 전체에서 키를 듣기 시작한다. 돌려주는 함수를 부르면 멈춘다.
 * 창 전체의 키 처리는 여기 한 곳뿐이다(각 부품은 자기 요소의 키만 듣는다).
 */
export function installKeyboard(target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    handleKeyEvent(event, keyHandlers, isShortcutBlocked);
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
