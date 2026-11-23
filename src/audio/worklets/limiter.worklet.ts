/**
 * 마스터 리미터(AudioWorklet). 계산은 `limiterCore.ts`의 `LookaheadLimiter`가 하고, 여기서는 오디오 입출력과 보고만 맡는다.
 * 5 ms 앞을 미리 보고 −1 dBFS를 넘지 않게 이득을 내린다. 출력은 입력보다 5 ms 늦다.
 *
 * 약 40 ms마다 그동안 가장 낮았던 이득을 dB로 메인 스레드에 알린다: `{ reduction: -3.2 }` (이득을 내리지 않았으면 0).
 */
import { gainToDb, LookaheadLimiter } from "./limiterCore";

// AudioWorkletGlobalScope의 전역은 lib.dom에 없어서 이 모듈 안에서만 선언한다.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

/** 보고 간격(프레임). 48 kHz에서 약 43 ms */
const REPORT_FRAMES = 2048;

class LimiterProcessor extends AudioWorkletProcessor {
  private readonly limiter = new LookaheadLimiter(sampleRate, 2);
  private frames = 0;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || !output.length) return true;
    this.limiter.process(inputs[0] ?? [], output);
    this.frames += output[0].length;
    if (this.frames >= REPORT_FRAMES) {
      this.frames = 0;
      this.port.postMessage({ reduction: Math.min(0, gainToDb(this.limiter.takeMinGain())) });
    }
    return true;
  }
}

registerProcessor("limiter", LimiterProcessor);
