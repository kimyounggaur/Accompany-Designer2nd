/**
 * 자동 저장 예약기: "언제 저장할지"만 정한다. 무엇을 어떻게 저장하는지는 모른다(autosave.ts가 넣어 준다).
 *
 *  - 바뀐 뒤 `delayMs`(1.2초) 동안 더 바뀌지 않으면 저장한다. 더 바뀌면 시간을 다시 잰다.
 *  - `flush()`: 기다리는 저장이 있으면 지금 바로 시작한다(탭을 숨길 때·닫을 때).
 *  - 저장은 한 번에 하나씩, 들어온 순서대로 한다. 앞의 저장이 실패해도 다음 저장은 계속된다.
 *  - 저장하기 전에는(`markReady` 전, 곧 복구가 끝나기 전) 아무것도 저장하지 않는다.
 *  - `isPaused()`가 true인 동안(녹음 중)에는 저장하지 않는다. 기다리던 저장은 건너뛰고, 녹음이 끝나 `changed()`가 다시 불리면 그때 저장한다.
 *  - `hasUnsaved()`: 저장하지 못한 변경이 있으면 true — 창을 닫을 때 경고하는 근거.
 *
 * 시계와 저장 동작은 밖에서 받으므로 브라우저 없이 시험할 수 있다.
 */
import type { AutosaveStatus } from "../../state/autosaveStore";

export const AUTOSAVE_DELAY_MS = 1200;

export interface SchedulerDeps {
  /** 지금 프로젝트를 저장한다. 실패하면 거절(reject)한다. */
  save: () => Promise<void>;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
  onStatus: (status: AutosaveStatus) => void;
  onError: (error: unknown) => void;
  /** true인 동안은 저장을 시작하지 않는다(녹음 중). */
  isPaused?: () => boolean;
  delayMs?: number;
}

export class AutosaveScheduler {
  private ready = false;
  private disposed = false;
  private unsaved = false;
  private timer: unknown;
  private hasTimer = false;
  private pending: Promise<void> = Promise.resolve();

  private readonly deps: SchedulerDeps;

  // 매개변수 속성(private readonly deps)은 Node의 타입 제거 모드에서 쓸 수 없어 풀어 쓴다.
  constructor(deps: SchedulerDeps) {
    this.deps = deps;
  }

  /** 복구가 끝났으니 이제부터 저장해도 된다. */
  markReady(): void {
    this.ready = true;
  }

  /** 문서가 바뀌었다(또는 녹음이 끝났다). */
  changed(): void {
    if (!this.ready || this.disposed) return;
    if (this.hasTimer) this.deps.clearTimer(this.timer);
    this.unsaved = true;
    this.hasTimer = true;
    this.timer = this.deps.setTimer(() => {
      this.hasTimer = false;
      if (this.deps.isPaused?.()) return; // 아직 저장 안 된 변경으로 남겨 두고, 녹음이 끝나면 changed()가 다시 예약한다.
      void this.start();
    }, this.deps.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  /** 기다리는 저장이 있으면 지금 시작하고, 진행 중인 저장까지 끝나면 풀린다. */
  flush(): Promise<void> {
    if (this.hasTimer) {
      this.deps.clearTimer(this.timer);
      this.hasTimer = false;
      if (this.deps.isPaused?.()) return this.pending;
      return this.start();
    }
    return this.pending;
  }

  hasUnsaved(): boolean {
    return this.unsaved;
  }

  dispose(): void {
    this.disposed = true;
    if (this.hasTimer) this.deps.clearTimer(this.timer);
    this.hasTimer = false;
  }

  private start(): Promise<void> {
    this.deps.onStatus({ state: "saving" });
    this.pending = this.pending
      .catch(() => undefined)
      .then(() => this.deps.save())
      .then(() => {
        // 저장하는 사이에 또 바뀌었다면(기다리는 타이머가 있다면) 아직 저장 안 된 변경이 있는 것이다.
        if (!this.hasTimer) this.unsaved = false;
        if (!this.disposed) this.deps.onStatus({ state: "saved", savedAt: this.deps.now() });
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        this.deps.onStatus({ state: "failed" });
        this.deps.onError(error);
      });
    return this.pending;
  }
}
