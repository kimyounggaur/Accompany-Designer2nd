/**
 * 녹음기(AudioWorklet). 계산은 `recorderCore.ts`의 `ChunkRecorder`가 하고, 여기서는 오디오 입력과 메인 스레드와의 메시지만 맡는다.
 * 옛 방식의 ScriptProcessorNode(폐기 예정, 메인 스레드에서 돌아 끊김)를 대신한다.
 *
 * 메인 스레드 → 녹음기
 *   { type: "start", startFrame }   이 프레임(오디오 시계)부터 담는다.
 *   { type: "stop" }                남은 조각을 내보내고 끝낸다.
 * 녹음기 → 메인 스레드
 *   { type: "chunk", samples, peaks, firstFrame }   4096 프레임마다(소유권을 넘겨 복사하지 않는다)
 *   { type: "stopped", firstFrame, frames }          "stop" 뒤, 마지막 조각 다음에 한 번
 */
import { ChunkRecorder } from "./recorderCore";

// AudioWorkletGlobalScope의 전역은 lib.dom에 없어서 이 모듈 안에서만 선언한다.
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

type Command = { type: "start"; startFrame: number } | { type: "stop" };

class RecorderProcessor extends AudioWorkletProcessor {
  private readonly core = new ChunkRecorder((chunk) => {
    this.port.postMessage({ type: "chunk", ...chunk }, [chunk.samples.buffer, chunk.peaks.buffer]);
  });

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<Command>) => {
      const command = event.data;
      if (command.type === "start") {
        this.core.arm(command.startFrame);
      } else if (command.type === "stop") {
        this.core.stop();
        this.port.postMessage({ type: "stopped", firstFrame: this.core.firstFrame, frames: this.core.framesCaptured });
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = inputs[0] ?? [];
    const length = outputs[0]?.[0]?.length ?? channels[0]?.length ?? 128;
    this.core.process(channels, currentFrame, length);
    return true; // 출력은 0으로 둔다(소리를 내지 않는다)
  }
}

registerProcessor("recorder", RecorderProcessor);
