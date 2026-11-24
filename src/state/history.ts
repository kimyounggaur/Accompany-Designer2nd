/**
 * 실행 취소 이력(P5-1).
 *
 * 단계마다 "다시 할 패치(redo)"와 "되돌릴 패치(undo)"만 쌓는다(immer의 produceWithPatches·applyPatches).
 * 문서를 통째로 붙들지 않고 바뀐 자리만 기록하므로, 단계가 많아도 메모리가 거의 늘지 않는다.
 *
 * 규칙
 *  - 바뀐 것이 없으면(패치가 0개) 기록하지 않는다.
 *  - record:false 편집은 문서만 바꾸고 이력에는 남기지 않는다(녹음 중 임시 트랙, 음원 정보 갱신 등).
 *  - 끌기·입력처럼 이어지는 조작은 beginGesture ~ endGesture 사이를 한 단계로 묶는다.
 *      · "pointer" 묶음: 누름 ~ 뗌. 문서 전체의 pointerup·pointercancel, 창 blur, 탭 숨김에서 끝난다(gestureGuards).
 *      · "focus" 묶음: 입력 칸에 초점이 들어옴 ~ 나감. 칸 안을 눌러도 끝나지 않는다.
 *      · 어느 쪽이든 마지막 편집 뒤 2초 동안 편집이 없으면 끝난다(뗌 신호를 놓쳤을 때의 안전장치).
 *      · 새 묶음은 이전 묶음의 단계에 이어 붙지 않는다(같은 key여도 별개의 조작이다).
 *  - 묶음 밖에서도 같은 key로 800ms 안에 이어지는 편집은 한 단계로 묶는다(키보드로 값을 여러 번 올리기).
 *  - 한 단계에 이어 붙은 패치는, 같은 자리를 나중에 다시 바꾼 앞선 값을 버려 크기를 줄인다(patches.ts).
 *  - 이력은 200단계까지. 새 편집이 기록되면 다시 실행(redo) 목록은 비운다.
 *  - 선택·도구·확대·스크롤·재생 위치는 문서가 아니므로 이력에 들어오지 않는다.
 */
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import type { StoreApi } from "zustand/vanilla";
import type { ProjectDoc } from "../domain/types";
import { compactReplacePatches, patchBytes } from "./patches";
import { projectStore, type ProjectState } from "./projectStore";

enablePatches();

export interface EditOptions {
  /** 같은 key로 800ms 안에 이어진 편집은 한 단계로 묶는다(조작 묶음 안에서는 묶음의 key가 쓰인다) */
  key?: string;
  /** false이면 이력에 남기지 않는다(녹음 중 임시 트랙, 음원 정보 갱신 등). 기본 true */
  record?: boolean;
}

/** pointer: 누름~뗌(끌기), focus: 초점 들어옴~나감(글자 입력) */
export type GestureKind = "pointer" | "focus";

export interface OpenGesture {
  id: number;
  key: string;
  kind: GestureKind;
}

/** 지정한 조건에 맞는 묶음만 끝낸다(조건이 없으면 열려 있는 묶음을 끝낸다) */
export interface GestureFilter {
  id?: number;
  kind?: GestureKind;
}

export interface HistoryStats {
  steps: { undo: number; redo: number };
  /** 모든 단계의 패치 개수 */
  patches: number;
  /** 모든 단계의 패치를 JSON으로 썼을 때의 글자 수(메모리 크기를 가늠하는 값). 부를 때만 계산한다 */
  bytes: number;
}

export interface HistoryApi {
  /** 문서를 바꾼다. 바뀐 것이 없으면 기록하지 않고 false를 돌려준다. */
  edit(label: string, recipe: (draft: Draft<ProjectDoc>) => void, options?: EditOptions): boolean;
  /** 조작 묶음을 연다(이미 열린 묶음이 있으면 먼저 닫는다). 묶음 번호를 돌려준다. */
  beginGesture(key: string, kind?: GestureKind): number;
  endGesture(filter?: GestureFilter): void;
  /** 지금 열려 있는 묶음(없으면 undefined) */
  openGesture(): OpenGesture | undefined;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** 되돌리면 사라질 작업의 이름(없으면 undefined). 안내 문구용 */
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
  /** 이력 단계 수 */
  depth(): { undo: number; redo: number };
  /** 단계 수·패치 수·크기(점검용) */
  stats(): HistoryStats;
  clear(): void;
}

interface Entry {
  label: string;
  key: string | undefined;
  /** 이 단계를 만든 조작 묶음의 번호(묶음 밖 편집이면 undefined) */
  gesture: number | undefined;
  /** 마지막으로 이어 붙은 시각(ms) */
  at: number;
  /** 다시 실행할 때 순서대로 적용하는 패치 */
  redo: Patch[];
  /** 되돌릴 때 쓰는 패치 조각들. 편집한 순서대로 쌓여 있고, 적용은 거꾸로 한다 */
  undo: Patch[][];
  /** redo 패치가 이만큼 쌓이면 줄여 본다 */
  compactAt: number;
}

export interface HistoryConfig {
  limit?: number;
  coalesceMs?: number;
  gestureTimeoutMs?: number;
  now?: () => number;
}

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 800;
export const GESTURE_TIMEOUT_MS = 2000;
const FIRST_COMPACT_AT = 16;

export function createHistory(store: StoreApi<ProjectState>, config: HistoryConfig = {}): HistoryApi {
  const limit = config.limit ?? HISTORY_LIMIT;
  const coalesceMs = config.coalesceMs ?? COALESCE_MS;
  const gestureTimeoutMs = config.gestureTimeoutMs ?? GESTURE_TIMEOUT_MS;
  const now = config.now ?? (() => performance.now());

  const past: Entry[] = [];
  const future: Entry[] = [];
  /** 다음 편집이 이어 붙을 수 있는 마지막 단계(되돌리기·다시 하기·묶음 끝에서 닫힌다) */
  let open: Entry | undefined;
  let gesture: (OpenGesture & { timer: ReturnType<typeof setTimeout> | undefined }) | undefined;
  let gestureSeq = 0;

  function armGestureTimer() {
    if (!gesture) return;
    if (gesture.timer !== undefined) clearTimeout(gesture.timer);
    const id = gesture.id;
    const timer = setTimeout(() => endGesture({ id }), gestureTimeoutMs);
    // 시험(Node)에서 이 타이머 때문에 프로세스가 늦게 끝나지 않게 한다. 브라우저의 타이머는 숫자라 해당 없음.
    (timer as unknown as { unref?: () => void }).unref?.();
    gesture.timer = timer;
  }

  function closeGesture() {
    if (!gesture) return;
    if (gesture.timer !== undefined) clearTimeout(gesture.timer);
    if (open && open.gesture === gesture.id) {
      compactEntry(open); // 끝난 묶음은 마지막으로 한 번 더 줄인다
      open = undefined;
    }
    gesture = undefined;
  }

  function endGesture(filter: GestureFilter = {}) {
    if (!gesture) return;
    if (filter.id !== undefined && filter.id !== gesture.id) return;
    if (filter.kind !== undefined && filter.kind !== gesture.kind) return;
    closeGesture();
  }

  function beginGesture(key: string, kind: GestureKind = "pointer"): number {
    closeGesture();
    gestureSeq += 1;
    gesture = { id: gestureSeq, key, kind, timer: undefined };
    armGestureTimer();
    return gestureSeq;
  }

  function canMerge(entry: Entry, key: string | undefined, at: number): boolean {
    // 묶음 안에서는 그 묶음이 만든 단계에만 이어 붙는다(같은 key의 지난 끌기와 섞이지 않는다).
    if (gesture) return entry.gesture === gesture.id;
    return entry.gesture === undefined && key !== undefined && entry.key === key && at - entry.at < coalesceMs;
  }

  function compactEntry(entry: Entry) {
    const redo = compactReplacePatches(entry.redo);
    if (redo) entry.redo = redo;
    // 되돌릴 때 적용하는 순서(가장 나중 편집의 조각부터)로 펴서 줄인다.
    const ordered: Patch[] = [];
    for (let index = entry.undo.length - 1; index >= 0; index -= 1) {
      for (const patch of entry.undo[index]) ordered.push(patch);
    }
    const undo = compactReplacePatches(ordered);
    if (undo) entry.undo = [undo];
    entry.compactAt = Math.max(FIRST_COMPACT_AT, entry.redo.length * 2);
  }

  function pushPast(entry: Entry) {
    past.push(entry);
    if (past.length > limit) past.splice(0, past.length - limit);
  }

  /** 패치를 문서에 적용하지 못하면(문서 모양이 기록과 어긋남) 이력을 비운다. 잘못된 문서를 만드는 것보다 낫다. */
  function dropAll(error: unknown) {
    past.length = 0;
    future.length = 0;
    open = undefined;
    console.error("실행 취소 이력을 문서에 적용하지 못해 이력을 비웠습니다.", error);
  }

  function edit(label: string, recipe: (draft: Draft<ProjectDoc>) => void, options: EditOptions = {}): boolean {
    const [next, redo, undo] = produceWithPatches(store.getState().doc, recipe);
    if (redo.length === 0) return false;
    store.setState({ doc: next });
    if (options.record === false) return true;

    const at = now();
    const key = gesture ? gesture.key : options.key;
    if (open && canMerge(open, key, at)) {
      for (const patch of redo) open.redo.push(patch);
      open.undo.push(undo);
      open.at = at;
      if (open.redo.length >= open.compactAt) compactEntry(open);
    } else {
      const entry: Entry = { label, key, gesture: gesture?.id, at, redo, undo: [undo], compactAt: FIRST_COMPACT_AT };
      pushPast(entry);
      open = entry;
    }
    future.length = 0;
    // 편집이 이어지는 동안은 묶음을 닫지 않는다(2초 안전장치는 "마지막 편집 뒤"를 잰다).
    armGestureTimer();
    return true;
  }

  function undo(): boolean {
    closeGesture();
    open = undefined;
    const entry = past.pop();
    if (!entry) return false;
    try {
      let doc = store.getState().doc;
      for (let index = entry.undo.length - 1; index >= 0; index -= 1) doc = applyPatches(doc, entry.undo[index]);
      store.setState({ doc });
    } catch (error) {
      dropAll(error);
      return false;
    }
    future.push(entry);
    return true;
  }

  function redo(): boolean {
    closeGesture();
    open = undefined;
    const entry = future.pop();
    if (!entry) return false;
    try {
      store.setState({ doc: applyPatches(store.getState().doc, entry.redo) });
    } catch (error) {
      dropAll(error);
      return false;
    }
    pushPast(entry);
    return true;
  }

  return {
    edit,
    beginGesture,
    endGesture,
    openGesture: () => (gesture ? { id: gesture.id, key: gesture.key, kind: gesture.kind } : undefined),
    undo,
    redo,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undoLabel: () => past[past.length - 1]?.label,
    redoLabel: () => future[future.length - 1]?.label,
    depth: () => ({ undo: past.length, redo: future.length }),
    stats() {
      let patches = 0;
      let bytes = 0;
      for (const entry of [...past, ...future]) {
        patches += entry.redo.length;
        bytes += patchBytes(entry.redo);
        for (const chunk of entry.undo) {
          patches += chunk.length;
          bytes += patchBytes(chunk);
        }
      }
      return { steps: { undo: past.length, redo: future.length }, patches, bytes };
    },
    clear() {
      closeGesture();
      past.length = 0;
      future.length = 0;
      open = undefined;
    },
  };
}

/** 앱 전체가 쓰는 이력(문서 저장소에 묶임) */
export const history: HistoryApi = createHistory(projectStore);
