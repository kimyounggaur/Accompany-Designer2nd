/**
 * 출력 측정 프로브(개발용). 주소에 `?probe=1`이 있을 때만 마스터 출력 뒤에 붙는다(audio/probe.ts).
 * 스피커로 나가는 신호를 직접 받아 "튀는 지점"(클릭·끊김)을 센다. 보고서의 실측과 같은 방법이다.
 *
 *  - jumps : 이웃한 두 샘플의 차가 0.2를 넘은 횟수. 시험 음원(220Hz, 0.8)의 정상 최대 변화량은 약 0.025라서 8배 넘는 값은 클릭이다.
 *  - gaps  : 소리가 나기 시작한 뒤 3ms 이상 이어진 무음 횟수(끊김). 첫 소리가 나기 전의 무음은 세지 않는다.
 *  - peak  : 절댓값 최댓값 / longestGapMs : 가장 긴 무음 길이
 *  - jumpLog : 튄 지점을 앞에서 8개까지 [오디오 시각, 직전 값, 지금 값]으로 적은 것
 * 0.1초마다 보고하고, `reset` 메시지를 받으면 모든 값을 0으로 되돌린다.
 */

// AudioWorkletGlobalScope의 전역은 lib.dom에 없어서 이 모듈 안에서만 선언한다.
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

const JUMP_THRESHOLD = 0.2;
/** 튄 지점을 앞에서 이만큼만 적어 둔다(어느 순간에 튀는지 찾는 용도) */
const JUMP_LOG_LIMIT = 8;
const SILENCE_LEVEL = 1e-4;

class Probe extends AudioWorkletProcessor {
  private readonly gapFrames = Math.round(0.003 * sampleRate); // 3ms
  private last = 0;
  private jumps = 0;
  private jumpLog: [number, number, number][] = [];
  private quiet = 0;
  private gaps = 0;
  private longestQuiet = 0;
  private peak = 0;
  private frames = 0;
  private armed = false;
  /** 리셋 직후 첫 샘플은 비교할 직전 값이 없으니 세지 않는다(소리 중간에 리셋해도 가짜 튐이 생기지 않게) */
  private primed = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === "reset") this.reset();
    };
  }

  private reset() {
    this.last = 0;
    this.jumps = 0;
    this.jumpLog = [];
    this.quiet = 0;
    this.gaps = 0;
    this.longestQuiet = 0;
    this.peak = 0;
    this.frames = 0;
    this.armed = false;
    this.primed = false;
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const x = channel[i];
      if (this.primed && Math.abs(x - this.last) > JUMP_THRESHOLD) {
        this.jumps++;
        // [오디오 시각(초), 직전 값, 지금 값]
        if (this.jumpLog.length < JUMP_LOG_LIMIT) this.jumpLog.push([currentTime + i / sampleRate, this.last, x]);
      }
      if (Math.abs(x) < SILENCE_LEVEL) {
        if (this.armed) {
          this.quiet++;
          if (this.quiet === this.gapFrames) this.gaps++; // 3ms 이상 무음 1회
          if (this.quiet > this.longestQuiet) this.longestQuiet = this.quiet;
        }
      } else {
        this.armed = true;
        this.quiet = 0;
      }
      if (Math.abs(x) > this.peak) this.peak = Math.abs(x);
      this.last = x;
      this.primed = true;
    }
    this.frames += channel.length;
    if (this.frames >= sampleRate / 10) {
      // 0.1초마다 보고
      this.port.postMessage({ jumps: this.jumps, gaps: this.gaps, peak: this.peak, longestGapMs: (this.longestQuiet / sampleRate) * 1000, jumpLog: this.jumpLog });
      this.frames = 0;
    }
    return true;
  }
}

registerProcessor("probe", Probe);

export {};
