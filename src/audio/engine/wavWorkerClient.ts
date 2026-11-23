import type { ExportBitDepth } from "../../domain/export/exportOptions";
import { encodePcmWav } from "../../utils/wavEncoder";
import { MixCancelledError } from "./mixErrors";

/** 채널 데이터를 WAV 파일(Blob)로 바꾸는 일. 시험에서는 가짜로 바꿔 끼운다. */
export type WavEncoder = (
  channels: Float32Array<ArrayBuffer>[],
  sampleRate: number,
  bitDepth: ExportBitDepth,
  signal?: AbortSignal,
) => Promise<Blob>;

interface EncodeReply {
  id: number;
  buffer?: ArrayBuffer;
  error?: string;
}

/**
 * Worker에서 WAV를 만든다. 채널 배열은 복사하지 않고 소유권을 넘기므로 부른 뒤에는 쓸 수 없다.
 * Worker를 쓸 수 없는 환경(단위 시험)이면 부른 자리에서 만든다.
 */
export const encodeWavInWorker: WavEncoder = (channels, sampleRate, bitDepth, signal) => {
  if (signal?.aborted) return Promise.reject(new MixCancelledError());
  if (typeof Worker === "undefined") return Promise.resolve(new Blob([encodePcmWav(channels, sampleRate, bitDepth)], { type: "audio/wav" }));
  return new Promise<Blob>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/wav.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(new Blob([encodePcmWav(channels, sampleRate, bitDepth)], { type: "audio/wav" }));
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const onAbort = () => {
      finish();
      reject(new MixCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<EncodeReply>) => {
      finish();
      const { buffer, error } = event.data;
      if (buffer) resolve(new Blob([buffer], { type: "audio/wav" }));
      else reject(new Error(error ?? "WAV 파일을 만들지 못했습니다."));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "WAV 파일을 만들지 못했습니다."));
    };
    worker.postMessage({ id: 1, channels, sampleRate, bitDepth }, channels.map((channel) => channel.buffer));
  });
};
