/**
 * 프로젝트 문서만 담는 저장소(실행 취소·자동 저장·엔진 동기화의 대상).
 * 선택·재생 위치·확대·도구 같은 화면 상태는 여기에 없다(지금은 store/useDawStore.ts에 남아 있음).
 *
 * 문서는 직접 고치지 않는다. 바꿀 때는 state/commands의 함수를 부른다(내부에서 immer로 새 문서를 만든다).
 * 바뀐 부분만 새 객체가 되고 나머지는 그대로이므로, "무엇이 바뀌었나"는 === 로 알 수 있다.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ProjectDoc } from "../types";
import { createEmptyDoc } from "./docDefaults";

export interface ProjectState {
  doc: ProjectDoc;
}

export const projectStore = createStore<ProjectState>()(() => ({ doc: createEmptyDoc() }));

/** 화면 부품에서 문서의 일부를 구독한다. selector는 바뀐 부분만 새 참조를 돌려주는 값(예: 트랙 목록)을 고르면 된다. */
export const useProject = <T,>(selector: (state: ProjectState) => T): T => useStore(projectStore, selector);

/** 지금 문서 */
export const getDoc = (): ProjectDoc => projectStore.getState().doc;
