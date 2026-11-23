/** 예약기를 일정 간격으로 깨우는 타이머. 시험에서는 손으로 돌리는 가짜를 끼운다. */
export interface TickTimer {
  start(intervalMs: number, onTick: () => void): void;
  stop(): void;
  dispose(): void;
}

/** Worker 타이머(배경 탭에서 덜 늦어짐). Worker를 쓸 수 없는 환경이면 setInterval로 대신한다. */
export function createTickTimer(): TickTimer {
  if (typeof Worker !== "undefined") {
    try {
      return createWorkerTimer();
    } catch {
      /* 아래의 setInterval로 */
    }
  }
  return createIntervalTimer();
}

function createWorkerTimer(): TickTimer {
  let worker: Worker | undefined;
  return {
    start(intervalMs, onTick) {
      // 만들어 둔 Worker를 계속 쓴다(재생·이동마다 새로 만들지 않는다).
      worker ??= new Worker(new URL("../workers/tick.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = () => onTick();
      worker.postMessage({ type: "start", interval: intervalMs });
    },
    stop() {
      if (!worker) return;
      worker.onmessage = null;
      worker.postMessage({ type: "stop" });
    },
    dispose() {
      worker?.terminate();
      worker = undefined;
    },
  };
}

function createIntervalTimer(): TickTimer {
  let id: ReturnType<typeof setInterval> | undefined;
  const clear = () => {
    if (id !== undefined) clearInterval(id);
    id = undefined;
  };
  return {
    start(intervalMs, onTick) {
      clear();
      id = setInterval(onTick, intervalMs);
    },
    stop: clear,
    dispose: clear,
  };
}
