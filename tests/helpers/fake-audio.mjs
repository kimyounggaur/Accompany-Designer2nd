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
  exponentialRampToValueAtTime(value, time) { this.#value = value; this.events.push({ type: 'expramp', value, time }); }
  setValueCurveAtTime(values, time, duration) { this.#value = values.at(-1); this.events.push({ type: 'curve', time, duration }); }
}

export class Node {
  /** 만들 때 붙는 이름(gain, delay, convolver …). 시험에서 노드를 종류별로 찾는 데 쓴다. */
  kind;
  /** 지금 이어져 있는 도착 노드들(연결선 기록) */
  connections = [];
  constructor(kind = 'node') {
    this.kind = kind;
    for (const name of ['gain', 'frequency', 'Q', 'threshold', 'ratio', 'attack', 'release', 'pan', 'delayTime', 'knee']) this[name] = new Param();
  }
  /** 실제 Web Audio처럼 받는 노드를 돌려준다(이어 붙여 쓸 수 있게). 같은 도착지에 또 이어도 한 줄이다. */
  connect(destination) {
    if (!this.connections.includes(destination)) this.connections.push(destination);
    return destination;
  }
  /** 도착지를 주면 그 줄만, 없으면 모두 끊는다(모두 끊을 때만 `disconnected`가 켜진다). */
  disconnect(destination) {
    if (destination === undefined) {
      this.connections = [];
      this.disconnected = true;
    } else {
      this.connections = this.connections.filter((to) => to !== destination);
    }
  }
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
  state = 'running'; currentTime = 0; sampleRate = 44100; destination = new Node('destination');
  /** 만든 노드들(종류별로 세어 볼 때) */
  nodes = [];
  /** createBuffer 호출 기록: { channels, length, sampleRate } */
  buffersCreated = [];
  make(kind) { const node = new Node(kind); this.nodes.push(node); return node; }
  createGain() { return this.make('gain'); }
  createAnalyser() { return this.make('analyser'); }
  createDynamicsCompressor() { return this.make('compressor'); }
  createWaveShaper() { return this.make('waveshaper'); }
  createBiquadFilter() { return this.make('biquad'); }
  createStereoPanner() { return this.make('panner'); }
  createDelay() { return this.make('delay'); }
  createConvolver() { return this.make('convolver'); }
  createChannelSplitter() { return this.make('splitter'); }
  createChannelMerger() { return this.make('merger'); }
  createBufferSource() { const source = new Source('source'); this.nodes.push(source); return source; }
  /** 메트로놈 클릭용. `start()`는 부르지만 `Source.starts`에는 남기지 않아도 되는 단순한 소리 원천이다. */
  createOscillator() { const source = new Source('oscillator'); source.type = 'sine'; this.nodes.push(source); return source; }
  createBuffer(channels, length, sampleRate) {
    this.buffersCreated.push({ channels, length, sampleRate });
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate, length, numberOfChannels: channels, sampleRate,
      getChannelData: (n) => data[n],
      copyToChannel: (source, channel) => { data[channel].set(source); },
    };
  }
  /** 종류별로 만든 노드 */
  all(kind) { return this.nodes.filter((node) => node.kind === kind); }
}

/**
 * 손으로 돌리는 이펙트 타이머(가상 시간). `advance(ms)`를 부르면 그 시간 안에 닿은 일을 시각 순서대로 한다.
 * 이펙트가 맡기는 일 `after(ms, action)`은 취소 함수를 돌려준다.
 */
export function createManualTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    after(ms, action) {
      const id = nextId++;
      pending.set(id, { due: now + ms, action });
      return () => { pending.delete(id); };
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let first;
        for (const [id, entry] of pending) if (entry.due <= until && (!first || entry.due < first.entry.due)) first = { id, entry };
        if (!first) break;
        pending.delete(first.id);
        now = Math.max(now, first.entry.due);
        first.entry.action();
      }
      now = until;
    },
    get pending() { return pending.size; },
    get now() { return now; },
  };
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

/**
 * 가짜 OfflineAudioContext. 실제처럼 `startRendering()`은 예약된 `suspend(t)` 시각마다 멈추고 `resume()`을 기다린다
 * (재개하지 않으면 영원히 끝나지 않는다). 결과 버퍼는 채널마다 "프레임 번호"로 채워 두어, 어디서부터 잘랐는지 값으로 알 수 있다.
 */
export class FakeOfflineContext extends FakeContext {
  constructor(channels, length, sampleRate) {
    super();
    this.state = 'suspended';
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.audioWorklet = { addModule: async () => {} };
    /** 예약된 멈춤: { time, resolve } */
    this.marks = [];
    /** 렌더가 닿은 멈춤 시각들(순서대로) */
    this.reached = [];
    this.resumes = 0;
    this.completed = false;
    this.copies = [];
    this.pendingResume = undefined;
  }
  suspend(time) {
    return new Promise((resolve) => { this.marks.push({ time, resolve }); });
  }
  resume() {
    this.resumes += 1;
    const resume = this.pendingResume;
    this.pendingResume = undefined;
    resume?.();
    return Promise.resolve();
  }
  async startRendering() {
    const marks = [...this.marks].sort((a, b) => a.time - b.time);
    for (const mark of marks) {
      this.currentTime = mark.time;
      this.reached.push(mark.time);
      await new Promise((resume) => { this.pendingResume = resume; mark.resolve(); });
    }
    this.currentTime = this.length / this.sampleRate;
    this.completed = true;
    const { length, numberOfChannels, sampleRate } = this;
    const data = Array.from({ length: numberOfChannels }, () => Float32Array.from({ length }, (_, frame) => frame));
    return {
      length, numberOfChannels, sampleRate, duration: length / sampleRate,
      getChannelData: (channel) => data[channel],
      copyFromChannel: (destination, channel, offset = 0) => {
        this.copies.push({ channel, offset, frames: destination.length });
        destination.set(data[channel].subarray(offset, offset + destination.length));
      },
    };
  }
}
