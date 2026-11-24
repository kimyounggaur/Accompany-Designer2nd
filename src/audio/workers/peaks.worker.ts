/**
 * 파형 자료 계산(P4-3). 긴 음원도 화면 스레드를 막지 않도록 Worker에서 계산한다.
 * 샘플은 한꺼번에 받지 않고 덩어리로 받는다(1시간 곡은 채널당 수억 샘플이라 한 번에 복사하면 오래 멈추고 메모리가 두 배가 된다).
 *
 * 받는 메시지: `{ type: "start", sampleRate, frames }` → `{ type: "chunk", offset, samples }`(여러 번, 소유권을 받음) → `{ type: "finish" }`
 * 보내는 메시지: 덩어리를 다 쓸 때마다 `{ type: "ack" }`(보내는 쪽이 한 번에 너무 많이 쌓아 두지 않게), 끝나면 `{ type: "done", set }`, 실패하면 `{ type: "error", message }`
 */
import { PeakBuilder, type PeakSet } from "../../domain/waveform/peakLevels";

type Request =
  | { type: "start"; sampleRate: number; frames: number }
  | { type: "chunk"; offset: number; samples: Float32Array }
  | { type: "finish" };

// 이 파일은 Worker 안에서 돌아가는데 lib.dom에는 Worker 전역이 없어서, 쓰는 부분만 좁혀 선언한다.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let builder: PeakBuilder | undefined;

function transfers(set: PeakSet): Transferable[] {
  return set.levels.flatMap((level) => [level.min.buffer, level.max.buffer]);
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === "start") {
      builder = new PeakBuilder(message.sampleRate, message.frames);
    } else if (message.type === "chunk") {
      if (!builder) throw new Error("파형 계산이 시작되지 않았습니다.");
      builder.addChunk(message.samples, message.offset);
      scope.postMessage({ type: "ack" });
    } else if (message.type === "finish") {
      if (!builder) throw new Error("파형 계산이 시작되지 않았습니다.");
      const set = builder.finish();
      builder = undefined;
      scope.postMessage({ type: "done", set }, transfers(set));
    }
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
