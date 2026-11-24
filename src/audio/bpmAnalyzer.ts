/**
 * 소리 데이터에서 박자(BPM)를 감지한다(P4-4). 계산은 Worker(workers/bpm.worker.ts)가 하고, 화면 스레드는 앞 180초의 첫 채널을
 * 작은 덩어리(1 MB)로 잘라 보내기만 한다 — 한 번에 35 MB를 복사하면 느린 기기에서 화면이 0.1초 넘게 멈추기 때문이다(실측은 docs/PHASES.md).
 * - 진행률(0~1)을 알리고, `signal`로 중간에 그만둘 수 있다(그만두면 Worker를 끝낸다).
 * - Worker가 아직 다 쓰지 않은 덩어리가 3개를 넘게 쌓아 두지 않는다(P4-3 파형 분석기와 같은 규칙).
 * - Worker를 쓸 수 없으면(단위 시험·일부 환경) 화면 스레드에서 한 번에 계산한다. 이때는 도중에 그만둘 수 없다.
 * 시험에서는 `createWorker`를 바꿔 끼운다.
 */
import { bpmAnalysisLength, estimateBpmFromSamples, type BpmSource } from "./bpmDetector";

/** 시험에서 바꿔 끼우는 Worker의 최소 모양 */
export interface BpmWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export class BpmCancelledError extends Error {
  constructor() {
    super("BPM 분석을 그만두었습니다.");
    this.name = "BpmCancelledError";
  }
}

export interface AnalyzeBpmOptions {
  /** Worker를 만든다. undefined를 돌려주면(만들 수 없음) 화면 스레드에서 계산한다. */
  createWorker?: () => BpmWorkerLike | undefined;
  /** 중간에 그만둔다 */
  signal?: AbortSignal;
  /** 진행률(0~1) */
  onProgress?: (fraction: number) => void;
  /** Worker로 보내는 덩어리 크기(샘플). 기본 256K(1 MB). */
  chunkSamples?: number;
  /** Worker가 아직 다 쓰지 않았어도 보내 둘 덩어리 수. 기본 3. */
  maxInFlight?: number;
}

/** 덩어리 하나의 샘플 수(채널 샘플 4바이트 → 1 MB). 복사 한 번이 느린 기기에서도 수 ms 안에 끝나는 크기다. */
export const BPM_CHUNK_SAMPLES = 1 << 18;

interface WorkerReply {
  type?: string;
  value?: number;
  bpm?: number | null;
  message?: string;
}

function defaultCreateWorker(): BpmWorkerLike | undefined {
  if (typeof Worker === "undefined") return undefined;
  try {
    return new Worker(new URL("./workers/bpm.worker.ts", import.meta.url), { type: "module" }) as unknown as BpmWorkerLike;
  } catch {
    return undefined;
  }
}

function runInWorker(worker: BpmWorkerLike, source: BpmSource, length: number, options: AnalyzeBpmOptions): Promise<number | undefined> {
  const { signal, onProgress } = options;
  const chunkSamples = Math.max(1, Math.floor(options.chunkSamples ?? BPM_CHUNK_SAMPLES));
  const maxInFlight = Math.max(1, Math.floor(options.maxInFlight ?? 3));
  return new Promise<number | undefined>((resolve, reject) => {
    let settled = false;
    let inFlight = 0;
    let wake: (() => void) | undefined;
    const onAbort = () => fail(new BpmCancelledError());
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      wake?.();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    if (signal?.aborted) {
      fail(new BpmCancelledError());
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event) => {
      if (settled) return;
      const reply = event.data as WorkerReply;
      if (reply.type === "ack") {
        inFlight -= 1;
        wake?.();
      } else if (reply.type === "progress" && typeof reply.value === "number") {
        onProgress?.(reply.value);
      } else if (reply.type === "done") {
        settled = true;
        cleanup();
        resolve(typeof reply.bpm === "number" ? reply.bpm : undefined);
      } else if (reply.type === "error") {
        fail(new Error(reply.message || "BPM을 분석하지 못했습니다."));
      }
    };
    worker.onerror = (event) => fail(new Error(event.message || "BPM을 분석하지 못했습니다."));

    void (async () => {
      worker.postMessage({ type: "start", sampleRate: source.sampleRate, length });
      const data = source.getChannelData(0);
      for (let offset = 0; offset < length; offset += chunkSamples) {
        while (inFlight >= maxInFlight && !settled) await new Promise<void>((next) => { wake = next; });
        if (settled) return;
        const samples = data.slice(offset, Math.min(length, offset + chunkSamples));
        inFlight += 1;
        worker.postMessage({ type: "chunk", offset, samples }, [samples.buffer]);
      }
      if (!settled) worker.postMessage({ type: "finish" });
    })().catch(fail);
  });
}

/** 박자를 감지한다. 못 구하면 undefined, 그만두면 `BpmCancelledError`로 거절된다. */
export async function analyzeBpm(source: BpmSource & { readonly length: number }, options: AnalyzeBpmOptions = {}): Promise<number | undefined> {
  if (options.signal?.aborted) throw new BpmCancelledError();
  const length = bpmAnalysisLength(source.length, source.sampleRate);
  if (length <= 0) return undefined;
  const worker = (options.createWorker ?? defaultCreateWorker)();
  if (!worker) {
    // 화면 스레드에서 계산: 막기 전에 한 번 숨을 돌려 "분석 중" 표시가 그려지게 한다.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (options.signal?.aborted) throw new BpmCancelledError();
    const bpm = estimateBpmFromSamples(source.getChannelData(0).subarray(0, length), source.sampleRate, options.onProgress);
    if (options.signal?.aborted) throw new BpmCancelledError();
    return bpm;
  }
  return runInWorker(worker, source, length, options);
}
