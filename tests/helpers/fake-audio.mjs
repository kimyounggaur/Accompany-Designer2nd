/**
 * Node 테스트용 가짜 Web Audio. 노드를 흉내만 내고, 값을 기록한다.
 * 쓰는 쪽은 `globalThis.window = { AudioContext: FakeContext }`를 한 뒤 엔진을 가져온다.
 */
export const counters = { paramWrites: 0 };

export class Param {
  #value = 0;
  /** `param.value = x`로 직접 넣은 값들(예약 메서드로 넣은 값은 `events`에만 남는다). 실제 기본값 1과 달리 가짜는 0에서 시작한다. */
  assigned = [];
  /** 예약된 일들을 순서대로 기록한다: { type, value, time } */
  events = [];
  get value() { return this.#value; }
  set value(next) { this.#value = next; this.assigned.push(next); }
  setTargetAtTime(value, time, constant) { this.#value = value; counters.paramWrites++; this.events.push({ type: 'target', value, time, constant }); }
  setValueAtTime(value, time) { this.#value = value; counters.paramWrites++; this.events.push({ type: 'set', value, time }); }
  cancelScheduledValues(time) { this.events.push({ type: 'cancel', time }); }
  cancelAndHoldAtTime(time) { this.events.push({ type: 'hold', time }); }
  linearRampToValueAtTime(value, time) { this.#value = value; this.events.push({ type: 'ramp', value, time }); }
  setValueCurveAtTime(values, time, duration) { this.#value = values.at(-1); this.events.push({ type: 'curve', time, duration }); }
}

export class Node {
  constructor() {
    for (const name of ['gain', 'frequency', 'Q', 'threshold', 'ratio', 'attack', 'release', 'pan', 'delayTime', 'knee']) this[name] = new Param();
  }
  /** 실제 Web Audio처럼 받는 노드를 돌려준다(이어 붙여 쓸 수 있게). */
  connect(destination) { return destination; }
  disconnect() { this.disconnected = true; }
}

export class Source extends Node {
  playbackRate = new Param();
  /** start(when, offset, duration)에 넘긴 값 */
  started = undefined;
  /** stop(when)에 넘긴 값. stop()이 불렸는지는 stopped로 본다. */
  stopped = undefined;
  stopAt = undefined;
  onended = null;
  start(...args) { this.started = args; Source.starts.push(this); }
  stop(when) { this.stopped = true; this.stopAt = when; }
  /** 소리가 자연히 끝난 것처럼 onended를 부른다. */
  finish() { this.onended?.(); }
  static starts = [];
}

export class FakeContext {
  state = 'running'; currentTime = 0; sampleRate = 44100; destination = new Node();
  createGain() { return new Node(); }
  createAnalyser() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createWaveShaper() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createStereoPanner() { return new Node(); }
  createDelay() { return new Node(); }
  createConvolver() { return new Node(); }
  createChannelSplitter() { return new Node(); }
  createChannelMerger() { return new Node(); }
  createBufferSource() { return new Source(); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, length, numberOfChannels: channels, sampleRate, getChannelData: (n) => data[n] };
  }
}

/** 손으로 돌리는 틱 타이머. `fire()`를 부르면 예약기가 한 번 깨어난다. */
export function createManualTimer() {
  const timer = {
    running: false, interval: undefined, callback: undefined, starts: 0, disposed: false,
    start(interval, callback) { timer.running = true; timer.interval = interval; timer.callback = callback; timer.starts++; },
    stop() { timer.running = false; },
    dispose() { timer.running = false; timer.disposed = true; },
    fire() { if (timer.running) timer.callback(); },
  };
  return timer;
}
