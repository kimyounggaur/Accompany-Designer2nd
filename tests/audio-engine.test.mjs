import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/utils/wavEncoder.ts';
import { DEFAULT_DELAY_SETTINGS } from '../src/utils/delay.ts';
import { DEFAULT_REVERB_SETTINGS } from '../src/utils/reverb.ts';
import { produce } from 'immer';
import { FakeContext, Source } from './helpers/fake-audio.mjs';

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
  const base = projectWithClip();
  const buffer = new FakeContext().createBuffer(1, 44100 * 10, 44100);
  audioEngine.registerBuffer('asset', buffer);
  // 문서는 바꾸지 않고 새로 만든다(immer). 엔진은 참조가 같은 트랙·클립을 건너뛴다.
  const project = produce(base, (draft) => { draft.tracks[0].clips.push({ ...base.tracks[0].clips[0], id: 'clip-2', startTime: 5 }); });
  await audioEngine.play(project, 0);
  assert.equal(Source.starts.length, 2);
  assert.deepEqual(Source.starts[0].started, [1, 0, 3]);
  const renamed = produce(project, (draft) => { draft.tracks[0].name = 'renamed'; draft.tracks[0].volume = .5; });
  audioEngine.sync(renamed, project);
  assert.equal(Source.starts.length, 2);
  assert.equal(Source.starts[0].stopped, undefined);
  const moved = produce(renamed, (draft) => { draft.tracks[0].clips[0].startTime = 2; });
  audioEngine.sync(moved, renamed);
  assert.equal(Source.starts.length, 3);
  assert.equal(Source.starts[0].stopped, true);
  assert.equal(Source.starts[1].stopped, undefined);
  assert.deepEqual(Source.starts[2].started, [2, 0, 3]);
  audioEngine.stop();
});

test('delay and reverb parameter changes keep the running source', async () => {
  Source.starts = [];
  const base = projectWithClip();
  const project = produce(base, (draft) => {
    const track = draft.tracks[0];
    track.delay.enabled = true; track.reverb.enabled = true;
    track.effectChain = [{ id: 'delay', type: 'delay', enabled: true }, { id: 'reverb', type: 'reverb', enabled: true }];
  });
  await audioEngine.play(project, 0);
  assert.equal(Source.starts.length, 1);
  const wetter = produce(project, (draft) => { draft.tracks[0].delay.wet = .7; draft.tracks[0].reverb.wet = .6; });
  audioEngine.sync(wetter, project);
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
