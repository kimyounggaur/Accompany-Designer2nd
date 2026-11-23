import type { AutosaveHandle } from "../services/persistence/autosave";

/**
 * 자동 저장 손잡이를 app 안의 다른 곳(음원 다시 연결 등)이 쓸 수 있게 한 군데에 둔다. `app/bootstrap.ts`가 시작할 때 등록하고 끝낼 때 거둔다.
 */
let current: AutosaveHandle | undefined;

export function registerAutosave(handle: AutosaveHandle | undefined): void {
  current = handle;
}

/** 문서는 그대로지만 저장할 내용(음원 데이터)이 늘었을 때 자동 저장을 예약한다. 자동 저장이 아직 없으면 아무것도 하지 않는다. */
export function requestAutosave(): void {
  current?.changed();
}
