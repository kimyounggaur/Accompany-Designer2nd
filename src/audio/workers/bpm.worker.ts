/**
 * 박자(BPM) 감지 계산(P4-4). 곡이 길어도 화면 스레드를 막지 않도록 Worker에서 돌린다.
 * 샘플은 한꺼번에 받지 않고 덩어리로 받는다(앞 180초는 채널당 최대 약 35MB라 한 번에 복사하면 느린 기기에서 화면이 멈춘다).
 *
 * 받는 메시지: `{ type: "start", sampleRate, length }` → `{ type: "chunk", offset, samples }`(여러 번, 소유권을 받음) → `{ type: "finish" }`
 * 보내는 메시지: 덩어리를 다 쓸 때마다 `{ type: "ack" }`(보내는 쪽이 한 번에 너무 많이 쌓아 두지 않게), 계산 중 진행률 `{ type: "progress", value }`(0~1),
 *   끝나면 `{ type: "done", bpm }`(못 구하면 null), 실패하면 `{ type: "error", message }`
 * 중간에 그만두는 것은 화면 쪽이 Worker를 끝내서(terminate) 한다. 계산 중에는 메시지를 받을 수 없기 때문이다.
 */
import { estimateBpmFromSamples } from "../bpmDetector";

type Request =
  | { type: "start"; sampleRate: number; length: number }
  | { type: "chunk"; offset: number; samples: Float32Array }
  | { type: "finish" };

// 이 파일은 Worker 안에서 돌아가는데 lib.dom에는 Worker 전역이 없어서, 쓰는 부분만 좁혀 선언한다.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown): void;
};

let sampleRate = 0;
let channel: Float32Array | undefined;

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === "start") {
      sampleRate = message.sampleRate;
      channel = new Float32Array(Math.max(0, Math.floor(message.length)));
    } else if (message.type === "chunk") {
      if (!channel || message.offset < 0 || message.offset + message.samples.length > channel.length) throw new Error("소리 덩어리의 위치가 맞지 않습니다.");
      channel.set(message.samples, message.offset);
      scope.postMessage({ type: "ack" });
    } else if (message.type === "finish") {
      if (!channel) throw new Error("분석할 소리를 받지 못했습니다.");
      const bpm = estimateBpmFromSamples(channel, sampleRate, (value) => scope.postMessage({ type: "progress", value }));
      channel = undefined;
      scope.postMessage({ type: "done", bpm: bpm ?? null });
    }
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
