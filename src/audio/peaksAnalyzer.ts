/**
 * 소리 데이터에서 다단계 파형 자료를 만든다(P4-3). 계산은 Worker가 하고, 화면 스레드는 샘플을 덩어리로 잘라 보내기만 한다.
 * - 덩어리는 1M 샘플(채널당 4 MB)이고, Worker가 다 쓰지 않은 덩어리가 3개를 넘게 쌓아 두지 않는다(1시간 곡이 메모리를 두 배로 쓰지 않게).
 * - Worker를 쓸 수 없으면(단위 시험·일부 환경) 화면 스레드에서 작은 조각으로 나눠 계산하고 조각마다 숨을 돌린다(긴 작업이 생기지 않게).
 * 시험에서는 `createWorker`를 바꿔 끼운다.
 */
import { PeakBuilder, type PeakSet, type PeakSource } from "../domain/waveform/peakLevels";

/** 시험에서 바꿔 끼우는 Worker의 최소 모양 */
export interface PeaksWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface AnalyzeOptions {
  /** Worker를 만든다. undefined를 돌려주면(만들 수 없음) 화면 스레드에서 조각으로 계산한다. */
  createWorker?: () => PeaksWorkerLike | undefined;
  /** 중간에 그만둔다(음원을 지웠거나 프로젝트를 바꿨을 때) */
  signal?: AbortSignal;
  /** Worker로 보내는 덩어리 크기(샘플). 기본 1M. */
  chunkFrames?: number;
  /** Worker가 아직 다 쓰지 않았어도 보내 둘 덩어리 수. 기본 3. */
  maxInFlight?: number;
}

export class PeaksCancelledError extends Error {
  constructor() {
    super("파형 계산을 그만두었습니다.");
    this.name = "PeaksCancelledError";
  }
}

export const PEAKS_CHUNK_FRAMES = 1 << 20;
const MAIN_THREAD_SLICE_FRAMES = 1 << 18;

function defaultCreateWorker(): PeaksWorkerLike | undefined {
  if (typeof Worker === "undefined") return undefined;
  try {
    return new Worker(new URL("./workers/peaks.worker.ts", import.meta.url), { type: "module" }) as unknown as PeaksWorkerLike;
  } catch {
    return undefined;
  }
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function analyzeOnMainThread(source: PeakSource, signal?: AbortSignal): Promise<PeakSet> {
  const builder = new PeakBuilder(source.sampleRate, source.length);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const data = source.getChannelData(channel);
    for (let offset = 0; offset < data.length; offset += MAIN_THREAD_SLICE_FRAMES) {
      if (signal?.aborted) throw new PeaksCancelledError();
      builder.addChunk(data.subarray(offset, offset + MAIN_THREAD_SLICE_FRAMES), offset);
      await yieldToMain();
    }
  }
  if (signal?.aborted) throw new PeaksCancelledError();
  return builder.finish();
}

interface WorkerReply {
  type?: string;
  set?: PeakSet;
  message?: string;
}

function analyzeInWorker(worker: PeaksWorkerLike, source: PeakSource, options: AnalyzeOptions): Promise<PeakSet> {
  const chunkFrames = Math.max(1, Math.floor(options.chunkFrames ?? PEAKS_CHUNK_FRAMES));
  const maxInFlight = Math.max(1, Math.floor(options.maxInFlight ?? 3));
  const { signal } = options;
  return new Promise<PeakSet>((resolve, reject) => {
    let settled = false;
    let inFlight = 0;
    let wake: (() => void) | undefined;
    const onAbort = () => fail(new PeaksCancelledError());
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
      fail(new PeaksCancelledError());
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event) => {
      const reply = event.data as WorkerReply;
      if (reply.type === "ack") {
        inFlight -= 1;
        wake?.();
      } else if (reply.type === "done" && reply.set) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(reply.set);
      } else if (reply.type === "error") {
        fail(new Error(reply.message || "파형을 계산하지 못했습니다."));
      }
    };
    worker.onerror = (event) => fail(new Error(event.message || "파형을 계산하지 못했습니다."));

    void (async () => {
      worker.postMessage({ type: "start", sampleRate: source.sampleRate, frames: source.length });
      for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
        const data = source.getChannelData(channel);
        for (let offset = 0; offset < data.length; offset += chunkFrames) {
          while (inFlight >= maxInFlight && !settled) await new Promise<void>((next) => { wake = next; });
          if (settled) return;
          const samples = data.slice(offset, offset + chunkFrames);
          inFlight += 1;
          worker.postMessage({ type: "chunk", offset, samples }, [samples.buffer]);
        }
      }
      if (!settled) worker.postMessage({ type: "finish" });
    })().catch(fail);
  });
}

/** 소리 데이터의 파형 자료를 만든다. 그만두면 `PeaksCancelledError`로 거절된다. */
export async function analyzePeaks(source: PeakSource, options: AnalyzeOptions = {}): Promise<PeakSet> {
  if (options.signal?.aborted) throw new PeaksCancelledError();
  if (source.length <= 0) throw new Error("비어 있는 소리라 파형을 만들 수 없습니다.");
  const worker = (options.createWorker ?? defaultCreateWorker)();
  if (!worker) return analyzeOnMainThread(source, options.signal);
  return analyzeInWorker(worker, source, options);
}
