/**
 * 실행 취소 이력(단순 버전, P3-1).
 *
 * 문서는 immer로 바뀐 부분만 새 객체가 되므로, 이력은 "바꾸기 전 문서의 참조"를 쌓기만 하면 된다.
 * (예전에는 단계마다 JSON.stringify/parse로 통째로 복사했다.) immer 패치로 바꾸는 것은 P5-1.
 *
 * 규칙
 *  - 바뀐 것이 없으면 기록하지 않는다(immer가 같은 문서를 돌려줌).
 *  - 끌기·입력처럼 이어지는 조작은 beginGesture ~ endGesture 사이를 한 단계로 묶는다.
 *  - 같은 key로 800ms 안에 이어지는 편집도 한 단계로 묶는다.
 *  - 이력은 100단계까지. 새 편집이 기록되면 다시 실행(redo) 목록은 비운다.
 */
import { produce, type Draft } from "immer";
import type { StoreApi } from "zustand/vanilla";
import type { ProjectDoc } from "../domain/types";
import { projectStore, type ProjectState } from "./projectStore";

export interface EditOptions {
  /** 같은 key로 800ms 안에 이어진 편집은 한 단계로 묶는다 */
  key?: string;
  /** false이면 이력에 남기지 않는다(끌기 도중 값, 녹음 중 파형 갱신 등). 기본 true */
  record?: boolean;
}

export interface HistoryApi {
  /** 문서를 바꾼다. 바뀐 것이 없으면 기록하지 않고 false를 돌려준다. */
  edit(label: string, recipe: (draft: Draft<ProjectDoc>) => void, options?: EditOptions): boolean;
  /** 지금 문서를 한 단계로 남긴다. 이어지는 편집이 record:false일 때(끌기 시작) 먼저 부른다. */
  capture(label?: string): void;
  beginGesture(key: string): void;
  endGesture(): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** 되돌리면 사라질 작업의 이름(없으면 undefined). 안내 문구용 */
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
  /** 이력 단계 수 */
  depth(): { undo: number; redo: number };
  clear(): void;
}

interface Entry {
  doc: ProjectDoc;
  label: string;
}

export interface HistoryConfig {
  limit?: number;
  coalesceMs?: number;
  now?: () => number;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 800;

export function createHistory(store: StoreApi<ProjectState>, config: HistoryConfig = {}): HistoryApi {
  const limit = config.limit ?? HISTORY_LIMIT;
  const coalesceMs = config.coalesceMs ?? COALESCE_MS;
  const now = config.now ?? (() => performance.now());

  const past: Entry[] = [];
  const future: Entry[] = [];
  let gesture: { active: boolean; recorded: boolean } = { active: false, recorded: false };
  let lastKey: string | undefined;
  let lastAt = 0;

  const trim = (list: Entry[]) => {
    if (list.length > limit) list.splice(0, list.length - limit);
  };
  const resetCoalescing = () => {
    lastKey = undefined;
  };

  function recordBefore(prev: ProjectDoc, label: string, key: string | undefined) {
    if (gesture.active) {
      // 조작 묶음 안에서는 첫 번째 편집만 한 단계로 남긴다.
      if (gesture.recorded) return;
      gesture.recorded = true;
    } else if (key !== undefined && key === lastKey && now() - lastAt <= coalesceMs) {
      lastAt = now();
      return;
    }
    past.push({ doc: prev, label });
    trim(past);
    future.length = 0;
    lastKey = key;
    lastAt = now();
  }

  return {
    edit(label, recipe, options = {}) {
      const prev = store.getState().doc;
      const next = produce(prev, recipe);
      if (next === prev) return false;
      if (options.record !== false) recordBefore(prev, label, options.key);
      store.setState({ doc: next });
      return true;
    },
    capture(label = "편집") {
      past.push({ doc: store.getState().doc, label });
      trim(past);
      future.length = 0;
      resetCoalescing();
    },
    beginGesture() {
      gesture = { active: true, recorded: false };
      resetCoalescing();
    },
    endGesture() {
      gesture = { active: false, recorded: false };
      resetCoalescing();
    },
    undo() {
      const entry = past.pop();
      if (!entry) return false;
      future.unshift({ doc: store.getState().doc, label: entry.label });
      trim(future);
      resetCoalescing();
      store.setState({ doc: entry.doc });
      return true;
    },
    redo() {
      const entry = future.shift();
      if (!entry) return false;
      past.push({ doc: store.getState().doc, label: entry.label });
      trim(past);
      resetCoalescing();
      store.setState({ doc: entry.doc });
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undoLabel: () => past[past.length - 1]?.label,
    redoLabel: () => future[0]?.label,
    depth: () => ({ undo: past.length, redo: future.length }),
    clear() {
      past.length = 0;
      future.length = 0;
      gesture = { active: false, recorded: false };
      resetCoalescing();
    },
  };
}

/** 앱 전체가 쓰는 이력(문서 저장소에 묶임) */
export const history: HistoryApi = createHistory(projectStore);
