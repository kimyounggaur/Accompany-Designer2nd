/**
 * 문서(projectStore)가 바뀌면 소리 경로(엔진)를 맞춘다. 화면(React)은 거치지 않는다.
 *
 * 예전에는 App.tsx가 트랙 전체를 JSON.stringify한 값이 바뀔 때마다 엔진을 다시 맞췄다(렌더링 때마다 직렬화).
 * 이제는 문서 참조가 바뀌는 순간 한 번, 바뀐 부분만 알아서 비교한다(엔진이 참조로 비교).
 */
import { ko } from "../i18n/ko";
import { notifyError } from "../services/notify";
import { projectStore, type ProjectState } from "../state/projectStore";
import type { ProjectDoc } from "../domain/types";
import type { StoreApi } from "zustand/vanilla";

export interface DocSyncTarget {
  sync(doc: ProjectDoc, previous?: ProjectDoc): void;
}

/** 연결을 끊는 함수를 돌려준다. 엔진이 오류를 내도 문서 편집은 그대로 반영되고, 오류는 안내로 보낸다. */
export function connectEngineSync(engine: DocSyncTarget, store: StoreApi<ProjectState> = projectStore): () => void {
  return store.subscribe((state, previous) => {
    if (state.doc === previous.doc) return;
    try {
      engine.sync(state.doc, previous.doc);
    } catch (error) {
      notifyError(error, { kind: "generic", title: ko.failed.playbackSync });
    }
  });
}
