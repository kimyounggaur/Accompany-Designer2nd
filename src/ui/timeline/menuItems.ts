import { ko } from "../../i18n/ko";
import type { ContextMenuItem } from "../controls/ContextMenu";

/**
 * 클립 메뉴·트랙 메뉴의 항목 목록(설계 P5-4). 어떤 항목이 쓸 수 있고 어떤 일을 부르는지만 정하는 순수 함수라,
 * 화면 없이 Node 단위 시험이 닿는다(일은 부르는 쪽이 넘기는 함수가 한다).
 */

export interface ClipMenuContext {
  /** 지금 선택된 클립 중 그룹에 묶인 것이 있는가("그룹 해제"를 쓸 수 있는가) */
  hasGroupedClip: boolean;
  /** 메뉴를 열 때 재생선이 이 클립 안에 있었는가("재생선에서 자르기"를 쓸 수 있는가) */
  playheadInside: boolean;
}

export interface ClipMenuActions {
  sliceAtPlayhead: () => void;
  duplicate: () => void;
  copy: () => void;
  toggleMute: () => void;
  rename: () => void;
  ungroup: () => void;
  remove: () => void;
}

/** 항목 오른쪽에 적는 단축키 글자(단축키가 있는 항목만) */
export interface ClipMenuHints {
  copy?: string;
  remove?: string;
}

export function buildClipMenuItems(context: ClipMenuContext, actions: ClipMenuActions, hints: ClipMenuHints = {}): ContextMenuItem[] {
  const text = ko.menu.clip;
  return [
    { id: "slice", label: text.sliceAtPlayhead, onSelect: actions.sliceAtPlayhead, disabled: !context.playheadInside },
    { id: "duplicate", label: text.duplicate, onSelect: actions.duplicate },
    { id: "copy", label: text.copy, onSelect: actions.copy, hint: hints.copy },
    { id: "mute", label: text.toggleMute, onSelect: actions.toggleMute },
    { id: "rename", label: text.rename, onSelect: actions.rename },
    { id: "ungroup", label: text.ungroup, onSelect: actions.ungroup, disabled: !context.hasGroupedClip },
    { id: "delete", label: text.delete, onSelect: actions.remove, danger: true, hint: hints.remove, separatorBefore: true },
  ];
}

export interface TrackMenuContext {
  /** 이 트랙이 위에서 몇 번째인가(0부터) */
  index: number;
  /** 트랙 수 */
  count: number;
  /** 녹음 준비·카운트인·녹음 중인가(그동안은 트랙 순서와 삭제를 바꿀 수 없다) */
  isRecording: boolean;
}

export interface TrackMenuActions {
  rename: () => void;
  moveUp: () => void;
  moveDown: () => void;
  remove: () => void;
}

/** 트랙 머리의 단추와 같은 규칙: 맨 위는 위로, 맨 아래는 아래로 못 가고, 트랙이 하나뿐이면 지울 수 없으며, 녹음 중에는 순서·삭제를 바꿀 수 없다. */
export function buildTrackMenuItems(context: TrackMenuContext, actions: TrackMenuActions): ContextMenuItem[] {
  const text = ko.menu.track;
  return [
    { id: "rename", label: text.rename, onSelect: actions.rename },
    { id: "up", label: text.moveUp, onSelect: actions.moveUp, disabled: context.isRecording || context.index <= 0 },
    { id: "down", label: text.moveDown, onSelect: actions.moveDown, disabled: context.isRecording || context.index >= context.count - 1 },
    { id: "delete", label: text.delete, onSelect: actions.remove, danger: true, separatorBefore: true, disabled: context.isRecording || context.count <= 1 },
  ];
}
