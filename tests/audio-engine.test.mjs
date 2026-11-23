import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/utils/wavEncoder.ts';
import { DEFAULT_DELAY_SETTINGS } from '../src/utils/delay.ts';
import { DEFAULT_REVERB_SETTINGS } from '../src/utils/reverb.ts';

class Param {
  value = 0;
  setTargetAtTime(value) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
  linearRampToValueAtTime(value) { this.value = value; }
  setValueCurveAtTime(values) { this.value = values.at(-1); }
}
class Node {
  constructor() {
    for (const name of ['gain', 'frequency', 'Q', 'threshold', 'ratio', 'attack', 'release', 'pan', 'delayTime', 'knee']) this[name] = new Param();
  }
  connect() {} disconnect() {}
}
class Source extends Node {
  playbackRate = new Param();
  start(...args) { this.started = args; Source.starts.push(this); }
  stop() { this.stopped = true; }
  static starts = [];
}
class FakeContext {
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
    const data = Array.from({length: channels}, () => new Float32Array(length));
    return { duration: length / sampleRate, length, numberOfChannels: channels, sampleRate, getChannelData: (n) => data[n] };
  }
}
globalThis.window = { AudioContext: FakeContext };
const { audioEngine } = await import('../src/audio/audioEngine.ts');

function projectWithClip() {
  const clip = { id: 'clip', audioBufferId: 'asset', name: 'clip', trackId: 'track', startTime: 1, offset: 0, duration: 3, sourceBpm: 120, stretchMode: 'none', gain: 1, fadeIn: 0, fadeOut: 0 };
  const track = { id: 'track', name: 'Track', volume: 1, pan: 0, muted: false, solo: false,
    eq: { enabled: false, bassGain: 0, middleLowGain: 0, middleHighGain: 0, highGain: 0, presenceGain: 0 },
    compressor: { enabled: false, threshold: -24, ratio: 2, attack: .01, release: .2 },
    delay: {...DEFAULT_DELAY_SETTINGS}, reverb: {...DEFAULT_REVERB_SETTINGS}, effectChain: [], clips: [clip] };
  return { id: 'project', name: 'Project', bpm: 120, sampleRate: 44100, tracks: [track], audioAssets: {}, timeMarkers: [] };
}

test('WAV encoder writes stereo PCM header and clips samples correctly', async () => {
  const bytes = await encodeWav([new Float32Array([-2, -.5, .5, 2])], 48000, 2).arrayBuffer();
  const data = new DataView(bytes);
  assert.equal(data.getUint16(20, true), 1);
  assert.equal(data.getUint16(22, true), 2);
  assert.equal(data.getUint32(24, true), 48000);
  assert.equal(data.getUint32(28, true), 192000);
  assert.equal(data.getUint32(40, true), 8);
  assert.equal(data.getInt16(44, true), -32768);
  assert.equal(data.getInt16(50, true), 32767);
});

test('playback keeps sources running on mixer and name edits; clip edits reschedule only that clip', async () => {
  Source.starts = [];
  const project = projectWithClip();
  const buffer = new FakeContext().createBuffer(1, 44100 * 10, 44100);
  audioEngine.registerBuffer('asset', buffer);
  project.tracks[0].clips.push({...project.tracks[0].clips[0], id: 'clip-2', startTime: 5});
  await audioEngine.play(project, 0);
  assert.equal(Source.starts.length, 2);
  assert.deepEqual(Source.starts[0].started, [1, 0, 3]);
  project.tracks[0].name = 'renamed';
  project.tracks[0].volume = .5;
  audioEngine.sync(project);
  assert.equal(Source.starts.length, 2);
  assert.equal(Source.starts[0].stopped, undefined);
  project.tracks[0].clips[0].startTime = 2;
  audioEngine.sync(project);
  assert.equal(Source.starts.length, 3);
  assert.equal(Source.starts[0].stopped, true);
  assert.equal(Source.starts[1].stopped, undefined);
  assert.deepEqual(Source.starts[2].started, [2, 0, 3]);
  audioEngine.stop();
});

test('delay and reverb parameter changes keep the running source', async () => {
  Source.starts = [];
  const project = projectWithClip(), track = project.tracks[0];
  track.delay.enabled = true; track.reverb.enabled = true;
  track.effectChain = [{id:'delay', type:'delay', enabled:true}, {id:'reverb', type:'reverb', enabled:true}];
  await audioEngine.play(project, 0);
  assert.equal(Source.starts.length, 1);
  track.delay.wet = .7; track.reverb.wet = .6;
  audioEngine.sync(project);
  assert.equal(Source.starts.length, 1);
  assert.equal(Source.starts[0].stopped, undefined);
  audioEngine.stop();
});

test('a clip already in progress starts at the proper source offset', async () => {
  Source.starts = [];
  const project = projectWithClip();
  await audioEngine.play(project, 2);
  assert.equal(Source.starts.length, 1);
  assert.deepEqual(Source.starts[0].started, [0, 1, 2]);
  audioEngine.stop();
});

test('missing source audio is reported instead of producing a silent mix', async () => {
  const project = projectWithClip();
  audioEngine.removeBuffer('asset');
  await assert.rejects(audioEngine.renderMix(project), /음원 1개/);
});
