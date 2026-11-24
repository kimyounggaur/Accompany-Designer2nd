/**
 * 화면 갱신 루프 하나(설계서 §P5-3, 보고서 C10).
 *
 * 재생선·시간 표시·레벨 미터·주파수 분석기·재생선 따라가기는 각자 `requestAnimationFrame`을 돌리지 않고 이 루프에 구독한다.
 *  - 루프는 "켜져 있고(`setLoopActive`) 구독자가 있을 때"만 돈다. 아무것도 안 할 때 화면 갱신 요청은 0회다.
 *  - 한 프레임에 `requestAnimationFrame` 요청은 구독자 수와 상관없이 1번이다(예전에는 App·미터·분석기가 각자 돌려 초당 약 180회).
 *  - 구독자 하나가 오류를 내도 다른 구독자와 루프는 계속 돈다(오류는 구독자마다 처음 한 번만 콘솔에 남긴다).
 *
 * 화면과 스토어를 모르는 순수 코드다. 시험에서는 `createFrameLoop(가짜 예약기)`로 프레임을 손으로 돌린다.
 */

export type FrameFn = (now: number) => void;

/** `requestAnimationFrame` 쌍. 시험에서는 가짜로 바꾼다. */
export interface FrameScheduler {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

export interface FrameLoop {
  /** 프레임마다 `fn(now)`를 부르게 한다. 돌려주는 함수를 부르면 그만둔다. */
  onFrame(fn: FrameFn): () => void;
  /** 루프를 켜고 끈다(재생·녹음 중에만 켠다). 끄면 예약해 둔 프레임도 거둔다. */
  setActive(on: boolean): void;
  /** 다음 프레임이 예약되어 있는가(= 지금 돌고 있는가). */
  running(): boolean;
  /** 구독자 수. */
  size(): number;
}

interface Entry {
  fn: FrameFn;
  /** 오류를 이미 알렸는가 */
  failed: boolean;
}

export function createFrameLoop(scheduler: FrameScheduler): FrameLoop {
  const entries = new Set<Entry>();
  // 프레임마다 배열을 새로 만들지 않도록, 구독자가 바뀔 때만 다시 만든다. 프레임 도중 구독·해지가 있어도 이번 프레임의 목록은 그대로다.
  let list: readonly Entry[] | undefined;
  let handle = 0;
  let active = false;

  function snapshot(): readonly Entry[] {
    list ??= [...entries];
    return list;
  }

  function ensure() {
    if (active && entries.size > 0 && handle === 0) handle = scheduler.request(tick);
  }

  function release() {
    if (handle !== 0) {
      scheduler.cancel(handle);
      handle = 0;
    }
  }

  function tick(now: number) {
    handle = 0;
    if (!active) return;
    for (const entry of snapshot()) {
      if (!entries.has(entry)) continue; // 이번 프레임 안에서 이미 해지됨
      try {
        entry.fn(now);
      } catch (error) {
        if (!entry.failed) {
          entry.failed = true;
          console.error("화면 갱신 중 오류(이 구독자는 계속 부릅니다):", error);
        }
      }
    }
    ensure();
  }

  return {
    onFrame(fn) {
      const entry: Entry = { fn, failed: false };
      entries.add(entry);
      list = undefined;
      ensure();
      return () => {
        if (!entries.delete(entry)) return;
        list = undefined;
        if (entries.size === 0) release();
      };
    },
    setActive(on) {
      active = on;
      if (on) ensure();
      else release();
    },
    running: () => handle !== 0,
    size: () => entries.size,
  };
}

/** 브라우저의 `requestAnimationFrame`. 부를 때마다 전역에서 읽는다(시험·계측이 바꿔 둔 것도 따른다). */
const browserScheduler: FrameScheduler = {
  request: (callback) => globalThis.requestAnimationFrame(callback),
  cancel: (handle) => globalThis.cancelAnimationFrame(handle),
};

/** 앱 전체가 쓰는 루프 하나. */
export const frameLoop = createFrameLoop(browserScheduler);

export const onFrame = frameLoop.onFrame;
export const setLoopActive = frameLoop.setActive;
