import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectFile, restoreAudio } from '../src/storage/projectStorage.ts';

const legacyProject = () => ({
  id: 'p1', name: '테스트', bpm: 120, sampleRate: 44100,
  tracks: [{ id: 't1', name: '트랙 1', volume: 0.86, pan: 0, muted: false, solo: false,
    clips: [{ id: 'c1', audioBufferId: 'a1', trackId: 't1', name: '음원', startTime: 0, offset: 0, duration: 1, sourceBpm: 120, stretchMode: 'none', gain: 1, fadeIn: 0, fadeOut: 0 }] }],
  audioAssets: { a1: { id: 'a1', fileName: '음원.wav', duration: 1, sampleRate: 44100, channels: 1, waveformPeaks: [0, 1], blobUrl: 'javascript:alert(1)' } },
  timeMarkers: [],
});
const file = obj => new File([JSON.stringify(obj)], 'session.json', { type: 'application/json' });

test('legacy project may omit effect settings and cannot import a script URL', async () => {
  const result = await parseProjectFile(file(legacyProject()));
  assert.equal(result.project.tracks[0].eq, undefined);
  assert.equal(result.project.audioAssets.a1.blobUrl, undefined);
  assert.equal((await restoreAudio(result, async () => { throw new Error('should not decode'); })).missing, 1);
});

test('rejects invalid or malicious effect settings and preserves caller state', async () => {
  for (const damage of [p => p.tracks[0].effectChain = [null], p => p.tracks[0].eq = 'bad', p => p.tracks[0].compressor = { ratio: 'bad' }, p => p.tracks[0].delay = { enabled: 'yes' }, p => p.tracks[0].reverb = { mode: 'wrong' }, p => p.tracks[0].clips[0].gain = null]) {
    const project = legacyProject(); damage(project);
    await assert.rejects(parseProjectFile(file(project)));
  }
});

test('rejects unrecognized project documents and unsupported versions', async () => {
  await assert.rejects(parseProjectFile(file({anything: true})));
  await assert.rejects(parseProjectFile(file({format: 'accompany-designer-project', version: 99, project: legacyProject(), audio: {}})));
});

test('decodes only embedded base64 data and never a remote URL', async () => {
  const project = legacyProject();
  const base = { format: 'accompany-designer-project', version: 1, project, audio: { a1: 'data:audio/wav;base64,AQID' } };
  const valid = await parseProjectFile(file(base));
  assert.deepEqual([...new Uint8Array(await valid.audio.a1.arrayBuffer())], [1, 2, 3]);
  base.audio.a1 = 'javascript:alert(1)';
  await assert.rejects(parseProjectFile(file(base)));
});
