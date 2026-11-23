/**
 * 녹음 한 번의 전체 흐름: 가짜 엔진·녹음기에 진짜 녹음 저장소·프로젝트 문서·명령·안내를 이어 본다(app/recordingHost).
 * 설계 P3-5 수용 기준: "10초 녹음 중 projectStore 변경 0회, 끝에 1회".
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";
import { SAMPLE_RATE, createHarness } from "./helpers/recording-harness.mjs";

globalThis.window = { AudioContext: FakeContext };

const { projectStore, getDoc } = await import("../src/state/projectStore.ts");
const { history } = await import("../src/state/history.ts");
const commands = await import("../src/state/commands/index.ts");
const { createDefaultTrack, createEmptyDoc } = await import("../src/state/docDefaults.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { useRecordingStore, DEFAULT_RECORDING_SETTINGS } = await import("../src/state/recordingStore.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");
const { recordingHost } = await import("../src/app/recordingHost.ts");
const actions = await import("../src/app/actions.ts");

const near = (actual, expected, message = "", tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} 기대 ${expected}, 실제 ${actual}`);

const clip = (id, trackId, startTime = 0) => ({
  id, audioBufferId: "asset", name: id, trackId, startTime, offset: 0, duration: 2, sourceBpm: 120,
  stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
});

function resetAll(doc = createEmptyDoc()) {
  projectStore.setState({ doc });
  history.clear();
  useDawStore.setState({ selectedTrackId: undefined, selectedClipId: undefined, selectedClipIds: [], playhead: 0, isPlaying: false });
  useRecordingStore.setState({ ...DEFAULT_RECORDING_SETTINGS });
  useRecordingStore.getState().resetForNewProject();
  useNoticeStore.getState().reset();
}

/** 트랙 n개짜리 문서. `filled`에 든 번호(0부터)의 트랙에는 클립이 하나씩 있다. */
function docWithTracks(count, filled = []) {
  const doc = createEmptyDoc();
  doc.tracks = Array.from({ length: count }, (_, index) => {
    const track = createDefaultTrack(index + 1);
    if (filled.includes(index)) track.clips = [clip(`old-${index}`, track.id, 0)];
    return track;
  });
  return doc;
}

const harness = (options = {}) => createHarness({ host: recordingHost, ...options });

beforeEach(() => resetAll());

// ───────── 수용 기준: 녹음 중 문서 0회, 끝에 1회 ─────────

test("10초 녹음: 녹음 중에는 문서가 한 번도 바뀌지 않고, 끝나는 순간 한 번 바뀌며 실행 취소 1단계(녹음 추가)다", async () => {
  const track = getDoc().tracks[0];
  let docChanges = 0;
  const offDoc = projectStore.subscribe(() => (docChanges += 1));
  let storeUpdates = 0;
  const offStore = useRecordingStore.subscribe(() => (storeUpdates += 1));

  const h = harness({ now: 1 });
  await h.controller.start();
  assert.equal(useRecordingStore.getState().status, "recording");
  assert.equal(useRecordingStore.getState().trackId, track.id, "비어 있는 첫 트랙에 녹음한다");
  assert.equal(docChanges, 0, "빈 트랙이 있으면 시작할 때도 문서를 건드리지 않는다");
  const storeBefore = storeUpdates;

  const chunks = Math.ceil((10 * SAMPLE_RATE) / 4096); // 약 10초
  for (let index = 0; index < chunks; index += 1) {
    h.setNowMs(index * 85); // 조각은 약 85 ms마다 온다
    h.recorder.emit(4096);
  }
  assert.equal(docChanges, 0, "녹음하는 10초 동안 문서 변경 0회");
  assert.equal(history.depth().undo, 0);
  assert.deepEqual(getDoc().audioAssets, {});
  assert.equal(getDoc().tracks[0].clips.length, 0, "클립은 녹음이 끝나야 생긴다");
  const progress = useRecordingStore.getState();
  assert.ok(progress.waveformPeaks.length > 0, "그동안 파형은 녹음 저장소에 쌓인다");
  near(progress.elapsed, (chunks * 4096) / SAMPLE_RATE, "경과 시간", 0.1);
  const duringRecording = storeUpdates - storeBefore;
  assert.ok(duringRecording <= 10 * 20, `녹음 저장소 갱신 ${duringRecording}회(10초, 초당 20회 이하)`);

  await h.controller.stop();
  assert.equal(docChanges, 1, "끝나는 순간 문서 변경은 한 번");
  assert.equal(history.depth().undo, 1);
  assert.equal(history.undoLabel(), "녹음 추가");
  const doc = getDoc();
  const assets = Object.values(doc.audioAssets);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].sourceType, "recording");
  assert.equal(doc.tracks[0].clips.length, 1);
  const recorded = doc.tracks[0].clips[0];
  assert.equal(recorded.audioBufferId, assets[0].id);
  assert.equal(recorded.trackId, track.id);
  assert.equal(recorded.name, assets[0].fileName);
  assert.deepEqual(
    { track: useDawStore.getState().selectedTrackId, clip: useDawStore.getState().selectedClipId, clips: useDawStore.getState().selectedClipIds },
    { track: track.id, clip: recorded.id, clips: [recorded.id] },
    "새 클립이 선택된다",
  );
  assert.equal(useRecordingStore.getState().status, "idle");
  assert.deepEqual(useRecordingStore.getState().waveformPeaks, []);
  assert.equal(useNoticeStore.getState().notices.at(-1).level, "success");
  offDoc();
  offStore();

  // 음원과 클립이 한 번에 사라지고, 다시 실행하면 함께 돌아온다.
  assert.equal(history.undo(), true);
  assert.deepEqual(getDoc().audioAssets, {});
  assert.equal(getDoc().tracks[0].clips.length, 0);
  assert.equal(history.redo(), true);
  assert.equal(Object.keys(getDoc().audioAssets).length, 1);
  assert.equal(getDoc().tracks[0].clips.length, 1);
});

test("녹음이 끝나면 곡 위치(재생 위치)는 멈춘 자리에, 재생 표시는 꺼진다", async () => {
  useDawStore.setState({ playhead: 2 });
  const h = harness({ now: 1, playhead: 2 });
  await h.controller.start();
  assert.equal(useDawStore.getState().isPlaying, true);
  h.recorder.emit(4096);
  h.context.currentTime = 4.1; // 1.1초에 시작한 반주가 3초 흘렀다
  await h.controller.stop();
  assert.equal(useDawStore.getState().isPlaying, false);
  near(useDawStore.getState().playhead, 2 + 3, "멈춘 자리");
});

// ───────── 녹음할 트랙 고르기 ─────────

test("녹음 대기 트랙이 있으면 그 트랙에 녹음한다", async () => {
  resetAll(docWithTracks(3));
  const [, second] = getDoc().tracks;
  assert.equal(useRecordingStore.getState().toggleArm(second.id).ok, true);
  const h = harness();
  await h.controller.start();
  assert.equal(useRecordingStore.getState().trackId, second.id);
  h.recorder.emit(4096);
  await h.controller.stop();
  assert.equal(getDoc().tracks[1].clips.length, 1);
  assert.equal(getDoc().tracks[0].clips.length, 0);
  assert.equal(useRecordingStore.getState().armedTrackId, second.id, "녹음 대기는 녹음이 끝나도 남는다");
});

test("녹음 대기 트랙이 없으면 클립이 없는 첫 트랙에 녹음한다", async () => {
  resetAll(docWithTracks(3, [0]));
  const h = harness();
  await h.controller.start();
  assert.equal(useRecordingStore.getState().trackId, getDoc().tracks[1].id);
  h.controller.cancel({ silent: true });
});

test("빈 트랙이 하나도 없으면 새 트랙을 이력 없이 만들고, 취소하면 그 트랙을 거둔다", async () => {
  resetAll(docWithTracks(2, [0, 1]));
  const h = harness();
  await h.controller.start();
  assert.equal(getDoc().tracks.length, 3);
  assert.equal(useRecordingStore.getState().trackId, getDoc().tracks[2].id);
  assert.equal(history.depth().undo, 0, "새 트랙은 이력에 남기지 않는다");
  h.controller.cancel({ silent: true });
  assert.equal(getDoc().tracks.length, 2, "취소하면 만든 빈 트랙을 거둔다");
  assert.equal(history.depth().undo, 0);
  assert.equal(useRecordingStore.getState().status, "idle");
});

test("새 트랙에 녹음을 마치면 클립이 그 트랙에 놓이고, 실행 취소는 녹음(음원·클립)만 되돌린다", async () => {
  resetAll(docWithTracks(2, [0, 1]));
  const h = harness();
  await h.controller.start();
  h.recorder.emit(4096);
  await h.controller.stop();
  assert.equal(getDoc().tracks.length, 3);
  assert.equal(getDoc().tracks[2].clips.length, 1);
  assert.equal(history.depth().undo, 1);
  history.undo();
  assert.deepEqual(getDoc().audioAssets, {});
  assert.equal(getDoc().tracks.length, 3, "트랙은 남고");
  assert.equal(getDoc().tracks[2].clips.length, 0, "그 안의 녹음 클립만 사라진다");
});

// ───────── 빈 녹음·실패 ─────────

test("녹음된 소리가 없으면 경고 토스트를 띄우고, 새로 만든 트랙을 거두며, 문서는 그대로다", async () => {
  resetAll(docWithTracks(1, [0]));
  const before = getDoc();
  const h = harness();
  await h.controller.start();
  assert.equal(getDoc().tracks.length, 2);
  await h.controller.stop(); // 조각이 없다
  const toast = useNoticeStore.getState().notices.at(-1);
  assert.equal(toast.level, "warning");
  assert.equal(toast.message, "녹음된 소리가 없어 클립을 만들지 않았습니다.");
  assert.equal(getDoc().tracks.length, 1);
  assert.equal(getDoc().audioAssets, before.audioAssets);
  assert.equal(history.depth().undo, 0);
});

test("마이크를 쓸 수 없으면 오류 토스트가 나오고 문서는 그대로다", async () => {
  const before = getDoc();
  const denied = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
  const h = harness({ openError: denied });
  await h.controller.start();
  const toast = useNoticeStore.getState().notices.at(-1);
  assert.equal(toast.level, "error");
  assert.equal(getDoc(), before);
  assert.equal(useRecordingStore.getState().status, "idle");
});

test("저장하다 실패하면 오류 토스트가 나오고 문서는 그대로다", async () => {
  const before = getDoc();
  const h = harness({ decodeError: new Error("디코드 실패") });
  await h.controller.start();
  h.recorder.emit(4096);
  await h.controller.stop();
  assert.equal(useNoticeStore.getState().notices.at(-1).level, "error");
  assert.equal(getDoc(), before);
  assert.equal(history.depth().undo, 0);
  assert.equal(useRecordingStore.getState().status, "idle");
});

// ───────── 녹음 중에 막는 것 ─────────

test("녹음 중에는 실행 취소·다시 실행·트랙 삭제를 막고 이유를 알린다", async () => {
  resetAll(docWithTracks(2, [0]));
  commands.setBpm(100); // 되돌릴 거리를 하나 만든다
  const h = harness();
  await h.controller.start();
  assert.equal(useRecordingStore.getState().status, "recording");

  assert.equal(useDawStore.getState().undo().reason, "recording");
  assert.equal(useDawStore.getState().redo().reason, "recording");
  assert.equal(useDawStore.getState().deleteTrack(getDoc().tracks[0].id).reason, "recording");
  assert.equal(getDoc().bpm, 100, "되돌려지지 않았다");

  actions.undo();
  assert.equal(useNoticeStore.getState().statusMessage, "녹음 중에는 실행 취소와 다시 실행을 할 수 없습니다.");
  h.controller.cancel({ silent: true });
});

test("녹음 중에는 녹음 대기 트랙을 바꿀 수 없다", async () => {
  const h = harness();
  await h.controller.start();
  const target = getDoc().tracks[0].id;
  assert.equal(useRecordingStore.getState().toggleArm(target).ok, false);
  assert.equal(useRecordingStore.getState().armedTrackId, undefined);
  h.controller.cancel({ silent: true });
});

// ───────── 녹음 문서 변경 함수 ─────────

const recordedAsset = (id = "asset-x", duration = 3) => ({
  id, fileName: "녹음 001.wav", duration, sampleRate: 44100, channels: 1, waveformPeaks: [0.1], sourceType: "recording",
});

test("addRecording: 음원과 클립을 한 번에 넣고 이력 한 단계(녹음 추가)만 남긴다", () => {
  const trackId = getDoc().tracks[0].id;
  let docChanges = 0;
  const off = projectStore.subscribe(() => (docChanges += 1));
  const placedOn = commands.addRecording({ trackId, asset: recordedAsset(), clipId: "clip-x", startTime: 1.5, bpm: 96 });
  off();
  assert.equal(placedOn, trackId);
  assert.equal(docChanges, 1);
  assert.equal(history.depth().undo, 1);
  assert.equal(history.undoLabel(), "녹음 추가");
  const [placed] = getDoc().tracks[0].clips;
  assert.deepEqual(
    { id: placed.id, buffer: placed.audioBufferId, start: placed.startTime, offset: placed.offset, duration: placed.duration, bpm: placed.sourceBpm, stretch: placed.stretchMode, muted: placed.muted },
    { id: "clip-x", buffer: "asset-x", start: 1.5, offset: 0, duration: 3, bpm: 96, stretch: "none", muted: false },
  );
});

test("addRecording: 앞을 잘라 낸 만큼 offset이 늘고 길이는 줄며, 시작 위치는 0 아래로 내려가지 않는다", () => {
  const trackId = getDoc().tracks[0].id;
  commands.addRecording({ trackId, asset: recordedAsset("a", 2), clipId: "c", startTime: -3, trim: 0.25, bpm: 120 });
  const [placed] = getDoc().tracks[0].clips;
  assert.equal(placed.startTime, 0);
  assert.equal(placed.offset, 0.25);
  assert.equal(placed.duration, 1.75);
});

test("addRecording: 녹음하는 사이 트랙이 사라졌다면 새 트랙을 만들어 놓고 그 id를 돌려준다", () => {
  const gone = createDefaultTrack(9);
  const placedOn = commands.addRecording({ trackId: gone.id, asset: recordedAsset(), clipId: "clip-y", startTime: 0, bpm: 120 });
  assert.notEqual(placedOn, gone.id);
  const track = getDoc().tracks.find((item) => item.id === placedOn);
  assert.ok(track);
  assert.equal(track.clips[0].id, "clip-y");
  assert.equal(track.clips[0].trackId, placedOn);
  assert.equal(history.depth().undo, 1, "트랙 추가와 녹음이 한 단계");
  history.undo();
  assert.equal(getDoc().tracks.some((item) => item.id === placedOn), false);
  assert.deepEqual(getDoc().audioAssets, {});
});

test("addRecording으로 만든 클립은 길이가 0.01초 아래로 줄지 않는다", () => {
  const trackId = getDoc().tracks[0].id;
  commands.addRecording({ trackId, asset: recordedAsset("tiny", 0.005), clipId: "tiny-clip", startTime: 0, bpm: 120 });
  assert.equal(getDoc().tracks[0].clips[0].duration, 0.01);
});
