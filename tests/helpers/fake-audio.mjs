/**
 * Node 테스트용 가짜 Web Audio. 노드를 흉내만 내고, 값을 기록한다.
 * 쓰는 쪽은 `globalThis.window = { AudioContext: FakeContext }`를 한 뒤 엔진을 가져온다.
 */
export const counters = { paramWrites: 0 };

export class Param {
  value = 0;
  setTargetAtTime(value) { this.value = value; counters.paramWrites++; }
  setValueAtTime(value) { this.value = value; counters.paramWrites++; }
  cancelScheduledValues() {}
  linearRampToValueAtTime(value) { this.value = value; }
  setValueCurveAtTime(values) { this.value = values.at(-1); }
}

export class Node {
  constructor() {
    for (const name of ['gain', 'frequency', 'Q', 'threshold', 'ratio', 'attack', 'release', 'pan', 'delayTime', 'knee']) this[name] = new Param();
  }
  connect() {}
  disconnect() {}
}

export class Source extends Node {
  playbackRate = new Param();
  start(...args) { this.started = args; Source.starts.push(this); }
  stop() { this.stopped = true; }
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
