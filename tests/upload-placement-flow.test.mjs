/**
 * 업로드가 새 클립을 어느 트랙에 놓는지(P4-5, 보고서 B8): app/importing.ts를 진짜 스토어·문서에 이어서 확인한다.
 * 소리 풀기만 가짜로 끼운다(규칙 자체의 경우의 수는 placement.test.mjs).
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";
import { makeClip } from "./helpers/docs.mjs";

const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
  removeItem: (key) => { storage.delete(key); },
};
globalThis.window = { AudioContext: FakeContext, localStorage };

const { useDawStore } = await import("../src/store/useDawStore.ts");
const { getDoc } = await import("../src/state/projectStore.ts");
const { history } = await import("../src/state/history.ts");
const { importAudioFiles } = await import("../src/app/importing.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");
const { forgetAllAudio } = await import("../src/services/persistence/audioBlobs.ts");
const { clearPeaks } = await import("../src/services/peaksCache.ts");
const { audioEngine } = await import("../src/audio/currentEngine.ts");
const { createDefaultTrack, createEmptyDoc } = await import("../src/domain/project/defaults.ts");

const fileOf = (name, bytes) => new File([new Uint8Array(bytes)], name, { type: "audio/wav" });

/** 소리 풀기를 가짜로: 파일 이름으로 길이를 정한다(정하지 않은 파일은 10초). 파일마다 내용이 달라야 같은 파일로 보지 않는다. */
function fakeDecoder(durations = {}) {
  let counter = 0;
  const decode = async (file) => {
    const id = `tmp${++counter}`;
    return {
      asset: { id, fileName: file.name, duration: durations[file.name] ?? 10, sampleRate: 44100, channels: 2, source: "upload", mimeType: file.type || undefined, byteSize: file.size },
      registerAs: () => {},
      release: () => {},
    };
  };
  return { decode };
}

/** 트랙을 만들어 클립을 넣은 문서를 올린다 */
function loadDoc(tracks, bpm = 120) {
  useDawStore.getState().importProject({ ...createEmptyDoc(), bpm, tracks });
  history.clear();
}

const clipNames = (track) => track.clips.map((clip) => clip.name);

beforeEach(() => {
  forgetAllAudio();
  audioEngine.clearBuffers();
  clearPeaks();
  useNoticeStore.getState().reset();
  useDawStore.getState().importProject(createEmptyDoc());
  useDawStore.setState({ cursor: 0, selectedTrackId: undefined, selectedClipId: undefined, selectedClipIds: [] });
  history.clear();
});

test("처음 올린 음원은 첫 트랙의 재생 위치에 놓이고 트랙은 늘지 않는다", async () => {
  useDawStore.setState({ cursor: 3 });
  await importAudioFiles([fileOf("반주.wav", [1])], fakeDecoder());
  const doc = getDoc();
  assert.equal(doc.tracks.length, 1);
  assert.deepEqual(clipNames(doc.tracks[0]), ["반주.wav"]);
  assert.equal(doc.tracks[0].clips[0].startTime, 3);
  assert.equal(doc.tracks[0].clips[0].trackId, doc.tracks[0].id);
  assert.equal(doc.tracks[0].clips[0].stretchMode, "none");
});

test("같은 자리에 두 번째로 올리면 새 트랙에 놓이고, 그 트랙이 선택된다", async () => {
  const deps = fakeDecoder();
  await importAudioFiles([fileOf("하나.wav", [1])], deps);
  await importAudioFiles([fileOf("둘.wav", [2])], deps);
  const doc = getDoc();
  assert.equal(doc.tracks.length, 2);
  assert.deepEqual(clipNames(doc.tracks[0]), ["하나.wav"]);
  assert.deepEqual(clipNames(doc.tracks[1]), ["둘.wav"]);
  assert.equal(useDawStore.getState().selectedTrackId, doc.tracks[1].id);
});

test("선택한 트랙의 그 구간이 비어 있으면 첫 트랙이 아니어도 그 트랙에 놓인다", async () => {
  const first = createDefaultTrack(1);
  const second = createDefaultTrack(2);
  first.clips = [makeClip(first.id, "앞", 0, { duration: 10 })];
  loadDoc([first, second]);
  useDawStore.setState({ selectedTrackId: second.id, cursor: 0 });
  await importAudioFiles([fileOf("새.wav", [3])], fakeDecoder());
  const doc = getDoc();
  assert.equal(doc.tracks.length, 2, "트랙이 늘지 않는다");
  assert.deepEqual(clipNames(doc.tracks[1]), ["새.wav"]);
});

test("템포 맞춤으로 짧아진 클립의 끝 뒤에 올리면 같은 트랙에 놓이고, 그 앞에 올리면 새 트랙에 놓인다", async () => {
  // 프로젝트 템포 120, 원본 BPM 60 → 배속 2: 원본 10초가 타임라인에서는 0~5초
  const track = createDefaultTrack(1);
  track.clips = [makeClip(track.id, "빠른 클립", 0, { duration: 10, sourceBpm: 60, stretchMode: "resample" })];
  loadDoc([track]);
  useDawStore.setState({ selectedTrackId: track.id, cursor: 5 });
  await importAudioFiles([fileOf("뒤.wav", [4])], fakeDecoder({ "뒤.wav": 2 }));
  let doc = getDoc();
  assert.equal(doc.tracks.length, 1, "원본 길이(10초)로 판단했다면 새 트랙이 생겼을 것이다");
  assert.deepEqual(clipNames(doc.tracks[0]), ["빠른 클립", "뒤.wav"]);

  useDawStore.setState({ selectedTrackId: doc.tracks[0].id, cursor: 4 });
  await importAudioFiles([fileOf("겹침.wav", [5])], fakeDecoder({ "겹침.wav": 2 }));
  doc = getDoc();
  assert.equal(doc.tracks.length, 2, "4~6초는 빠른 클립(0~5초)과 겹친다");
  assert.deepEqual(clipNames(doc.tracks[1]), ["겹침.wav"]);
});

test("템포 맞춤으로 길어진 클립은 원본 길이가 끝난 뒤에도 자리를 차지한다", async () => {
  // 프로젝트 템포 120, 원본 BPM 240 → 배속 0.5: 원본 10초가 타임라인에서는 0~20초
  const track = createDefaultTrack(1);
  track.clips = [makeClip(track.id, "느린 클립", 0, { duration: 10, sourceBpm: 240, stretchMode: "resample" })];
  loadDoc([track]);
  useDawStore.setState({ selectedTrackId: track.id, cursor: 15 });
  await importAudioFiles([fileOf("겹침.wav", [6])], fakeDecoder({ "겹침.wav": 2 }));
  const doc = getDoc();
  assert.equal(doc.tracks.length, 2, "원본 길이(10초)로 판단했다면 같은 트랙에 겹쳐 놓았을 것이다");
  assert.deepEqual(clipNames(doc.tracks[0]), ["느린 클립"]);
  assert.deepEqual(clipNames(doc.tracks[1]), ["겹침.wav"]);
});

test("파일 여러 개를 한꺼번에 올리면 한 파일씩 차례로 규칙을 적용해 같은 자리의 파일은 각자 새 트랙에 놓인다", async () => {
  await importAudioFiles([fileOf("가.wav", [1]), fileOf("나.wav", [2]), fileOf("다.wav", [3])], fakeDecoder({ "가.wav": 4, "나.wav": 3, "다.wav": 2 }));
  const doc = getDoc();
  assert.equal(doc.tracks.length, 3);
  assert.deepEqual(doc.tracks.map(clipNames), [["가.wav"], ["나.wav"], ["다.wav"]]);
  assert.deepEqual(doc.tracks.map((track) => track.clips[0].startTime), [0, 0, 0]);
});

test("파일 여러 개 중 일부가 안 풀려도 나머지는 규칙대로 놓인다", async () => {
  const deps = fakeDecoder();
  const decode = async (file) => {
    if (file.name === "깨진.wav") throw new Error("decode failed");
    return deps.decode(file);
  };
  await importAudioFiles([fileOf("깨진.wav", [0]), fileOf("정상.wav", [1]), fileOf("정상 둘.wav", [2])], { decode });
  const doc = getDoc();
  assert.deepEqual(doc.tracks.map(clipNames), [["정상.wav"], ["정상 둘.wav"]]);
});
