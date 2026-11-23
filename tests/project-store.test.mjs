import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext, Source, counters } from "./helpers/fake-audio.mjs";

globalThis.window = { AudioContext: FakeContext };

const { projectStore, getDoc } = await import("../src/state/projectStore.ts");
const { createHistory, COALESCE_MS, HISTORY_LIMIT } = await import("../src/state/history.ts");
const { history } = await import("../src/state/history.ts");
const commands = await import("../src/state/commands/index.ts");
const { createDefaultTrack, createEmptyDoc } = await import("../src/state/docDefaults.ts");
const { planSync } = await import("../src/audio/engine/syncPlan.ts");
const { audioEngine } = await import("../src/audio/audioEngine.ts");
const { connectEngineSync } = await import("../src/app/engineSync.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { useRecordingStore } = await import("../src/state/recordingStore.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");

/** 트랙 20개 × 클립 50개 문서(보고서가 말한 "큰 프로젝트") */
function bigDoc(trackCount = 20, clipCount = 50) {
  const tracks = Array.from({ length: trackCount }, (_, t) => {
    const track = createDefaultTrack(t + 1);
    track.clips = Array.from({ length: clipCount }, (_, c) => ({
      id: `clip-${t}-${c}`, audioBufferId: "asset", name: `클립 ${t}-${c}`, trackId: track.id,
      startTime: c * 2, offset: 0, duration: 1.5, sourceBpm: 120, stretchMode: "none",
      gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
    }));
    return track;
  });
  return { id: "big", name: "큰 프로젝트", bpm: 120, sampleRate: 44100, tracks, audioAssets: {}, timeMarkers: [] };
}

function resetStore(doc = createEmptyDoc()) {
  audioEngine.stop();
  projectStore.setState({ doc });
  history.clear();
  useDawStore.setState({ selectedTrackId: undefined, selectedClipId: undefined, selectedClipIds: [] });
}

beforeEach(() => {
  resetStore();
  useNoticeStore.getState().reset();
});

// ───── 바뀐 부분만 새 객체 (S3) ─────

test("트랙 1개의 볼륨을 바꾸면 그 트랙만 새 참조이고 나머지 트랙·클립은 === 이다", () => {
  resetStore(bigDoc());
  const before = getDoc();
  const target = before.tracks[7];
  assert.equal(commands.updateTrack(target.id, { volume: 0.5 }), true);
  const after = getDoc();

  assert.notEqual(after, before);
  assert.notEqual(after.tracks, before.tracks);
  assert.notEqual(after.tracks[7], before.tracks[7]);
  assert.equal(after.tracks[7].volume, 0.5);
  assert.equal(after.tracks[7].clips, before.tracks[7].clips, "같은 트랙의 클립 목록도 그대로");
  after.tracks.forEach((track, index) => {
    if (index !== 7) assert.equal(track, before.tracks[index], `트랙 ${index}는 그대로`);
  });
  assert.equal(after.audioAssets, before.audioAssets);
  assert.equal(after.timeMarkers, before.timeMarkers);
});

test("클립 1개를 고치면 그 클립·그 트랙·트랙 목록만 새 참조다", () => {
  resetStore(bigDoc());
  const before = getDoc();
  commands.updateClip("clip-3-20", { startTime: 99 });
  const after = getDoc();
  assert.equal(after.tracks[3].clips[20].startTime, 99);
  assert.notEqual(after.tracks[3].clips[20], before.tracks[3].clips[20]);
  assert.notEqual(after.tracks[3].clips, before.tracks[3].clips);
  assert.equal(after.tracks[3].clips[19], before.tracks[3].clips[19]);
  assert.equal(after.tracks[3].clips[21], before.tracks[3].clips[21]);
  assert.equal(after.tracks[4], before.tracks[4]);
});

test("값이 같은 편집은 문서도 이력도 바꾸지 않는다", () => {
  resetStore(bigDoc());
  const before = getDoc();
  assert.equal(commands.updateTrack(before.tracks[0].id, { volume: before.tracks[0].volume }), false);
  assert.equal(commands.updateClip("clip-0-0", { startTime: 0, groupId: undefined }), false);
  assert.equal(commands.setBpm(120), false);
  assert.equal(commands.clearTimeMarkers(), false);
  assert.equal(getDoc(), before);
  assert.equal(history.depth().undo, 0);
});

test("문서는 얼려 있다: 직접 고치려 하면 오류가 난다", () => {
  resetStore(bigDoc(2, 2));
  commands.setProjectName("바꿈");
  assert.throws(() => { getDoc().tracks[0].volume = 1; }, TypeError);
  assert.throws(() => { getDoc().tracks[0].clips.push({}); }, TypeError);
});

// ───── 동기화 계획: 바뀐 것만 (S2) ─────

test("planSync: 볼륨 변경은 그 트랙 1개만 값을 다시 맞추고 클립 예약은 건드리지 않는다", () => {
  resetStore(bigDoc());
  const before = getDoc();
  commands.updateTrack(before.tracks[7].id, { volume: 0.4 });
  const plan = planSync(getDoc(), before);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].track.id, before.tracks[7].id);
  assert.equal(plan.steps[0].updateParams, true);
  assert.equal(plan.steps[0].reconcileClips, false);
  assert.equal(plan.tempoChanged, false);
  assert.deepEqual(plan.removedTrackIds, []);
});

test("planSync: 이름만 바뀌면 값은 다시 맞추되 클립은 그대로, 클립 이동은 그 트랙만 클립을 다시 맞춘다", () => {
  resetStore(bigDoc());
  let before = getDoc();
  commands.updateTrack(before.tracks[1].id, { name: "새 이름" });
  let plan = planSync(getDoc(), before);
  assert.deepEqual(plan.steps.map((step) => [step.track.id, step.reconcileClips]), [[before.tracks[1].id, false]]);

  before = getDoc();
  commands.updateClip("clip-5-5", { startTime: 77 });
  plan = planSync(getDoc(), before);
  assert.deepEqual(plan.steps.map((step) => [step.track.id, step.reconcileClips]), [[before.tracks[5].id, true]]);
});

test("planSync: 템포·솔로가 바뀌면 모든 트랙, 지운 트랙은 removedTrackIds, 처음이면 전부", () => {
  resetStore(bigDoc(4, 3));
  let before = getDoc();
  commands.setBpm(90);
  let plan = planSync(getDoc(), before);
  assert.equal(plan.tempoChanged, true);
  assert.equal(plan.steps.length, 4);
  assert.ok(plan.steps.every((step) => step.updateParams && step.reconcileClips));

  before = getDoc();
  commands.updateTrack(before.tracks[2].id, { solo: true });
  plan = planSync(getDoc(), before);
  assert.equal(plan.solo, true);
  assert.equal(plan.steps.length, 4, "솔로가 처음 켜지면 다른 트랙의 음량도 바뀐다");
  assert.ok(plan.steps.every((step) => !step.reconcileClips));

  before = getDoc();
  const removedId = before.tracks[1].id;
  commands.removeTrack(removedId);
  plan = planSync(getDoc(), before);
  assert.deepEqual(plan.removedTrackIds, [removedId]);
  assert.equal(plan.steps.length, 0);

  plan = planSync(getDoc(), undefined);
  assert.equal(plan.steps.length, 3);
  assert.ok(plan.steps.every((step) => step.trackChanged && step.reconcileClips));
});

test("planSync는 트랙 20개 × 클립 50개에서 1ms보다 훨씬 빠르다", () => {
  resetStore(bigDoc());
  const docs = [getDoc()];
  for (let i = 0; i < 100; i++) {
    commands.updateTrack(getDoc().tracks[i % 20].id, { volume: 0.3 + (i % 10) * 0.05 + i * 0.0001 });
    docs.push(getDoc());
  }
  const start = performance.now();
  for (let round = 0; round < 20; round++) {
    for (let i = 1; i < docs.length; i++) planSync(docs[i], docs[i - 1]);
  }
  const perCall = (performance.now() - start) / (20 * (docs.length - 1));
  assert.ok(perCall < 0.2, `planSync 1회 ${perCall.toFixed(4)}ms`);
});

// ───── 엔진: 바뀐 트랙만 건드린다 ─────

test("엔진 sync: 재생 중 한 트랙의 볼륨 변경은 소스를 다시 시작하지 않고, 1ms 안에 끝나며, 그 트랙의 값만 쓴다", async () => {
  resetStore(bigDoc());
  Source.starts = [];
  audioEngine.registerBuffer("asset", new FakeContext().createBuffer(1, 44100 * 5, 44100));
  await audioEngine.play(getDoc(), 0);
  assert.equal(Source.starts.length, 1000, "클립 1000개가 모두 예약됨");

  const timings = [];
  let before = getDoc();
  for (let i = 0; i < 60; i++) {
    commands.updateTrack(getDoc().tracks[i % 20].id, { volume: 0.2 + i * 0.01 });
    const after = getDoc();
    counters.paramWrites = 0;
    const start = performance.now();
    audioEngine.sync(after, before);
    timings.push(performance.now() - start);
    assert.ok(counters.paramWrites > 0 && counters.paramWrites <= 12, `값 쓰기 ${counters.paramWrites}회: 트랙 1개 분량(믹서 2 + EQ 5 + 컴프 4)만`);
    before = after;
  }
  assert.equal(Source.starts.length, 1000, "소스는 하나도 다시 시작되지 않음");
  assert.ok(Source.starts.every((source) => source.stopped === undefined));
  // 기준은 "1ms 미만". 평균·최대는 가비지 수집 같은 시험 환경의 잡음에 흔들리므로 중앙값으로 보고, 최대는 아주 넉넉하게만 본다.
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];
  assert.ok(median < 1, `sync 중앙값 ${median.toFixed(4)}ms`);
  assert.ok(timings.at(-1) < 50, `sync 최대 ${timings.at(-1).toFixed(4)}ms`);
  audioEngine.stop();
});

test("엔진 sync: 클립 1개를 옮기면 그 클립만 다시 예약하고, 트랙을 지우면 그 트랙의 소리만 멈춘다", async () => {
  resetStore(bigDoc(3, 4));
  Source.starts = [];
  audioEngine.registerBuffer("asset", new FakeContext().createBuffer(1, 44100 * 5, 44100));
  await audioEngine.play(getDoc(), 0);
  assert.equal(Source.starts.length, 12);

  let before = getDoc();
  commands.updateClip("clip-1-2", { startTime: 20 });
  audioEngine.sync(getDoc(), before);
  assert.equal(Source.starts.length, 13);
  assert.equal(Source.starts.filter((source) => source.stopped).length, 1);

  before = getDoc();
  const removed = before.tracks[2].id;
  commands.removeTrack(removed);
  audioEngine.sync(getDoc(), before);
  assert.equal(Source.starts.filter((source) => !source.stopped).length, 8, "남은 소리 = 트랙 2개 × 클립 4개");
  audioEngine.stop();
});

test("엔진 sync: 재생 시작 직후에 문서가 바뀌어도 엔진이 마지막으로 맞춘 문서를 기준으로 따라잡는다", async () => {
  resetStore(bigDoc(2, 2));
  Source.starts = [];
  audioEngine.registerBuffer("asset", new FakeContext().createBuffer(1, 44100 * 5, 44100));
  const stale = getDoc();
  await audioEngine.play(stale, 0); // 이 문서로 소리 경로를 만들었다
  commands.updateClip("clip-0-0", { startTime: 30 });
  commands.updateClip("clip-0-1", { startTime: 40 });
  // 알려 주는 이전 문서가 엉뚱해도(중간 문서) 엔진은 자기가 맞춰 둔 문서와 비교한다.
  audioEngine.sync(getDoc(), getDoc());
  const live = Source.starts.filter((source) => !source.stopped);
  assert.equal(live.length, 4, "옮긴 클립 2개는 새로 예약하고 옛 예약은 멈췄다");
  assert.equal(Source.starts.length, 6, "처음 4개 + 다시 예약한 2개");
  assert.ok(live.some((source) => source.started[0] === 30));
  assert.ok(live.some((source) => source.started[0] === 40));
  audioEngine.stop();
});

// ───── 엔진 연결 ─────

test("connectEngineSync: 문서가 바뀔 때마다 (새 문서, 이전 문서)로 한 번씩 부르고, 끊으면 부르지 않는다", () => {
  const calls = [];
  const off = connectEngineSync({ sync: (doc, previous) => calls.push([doc, previous]) });
  const first = getDoc();
  commands.setProjectName("A");
  commands.setProjectName("A"); // 같은 값: 문서가 안 바뀌므로 부르지 않는다
  commands.setBpm(100);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], first);
  assert.equal(calls[1][1], calls[0][0]);
  assert.equal(calls[1][0], getDoc());
  // 화면 상태(선택·재생 위치)는 문서가 아니므로 부르지 않는다.
  useDawStore.getState().setPlayhead(3);
  useDawStore.getState().selectTrack(getDoc().tracks[0].id);
  assert.equal(calls.length, 2);
  off();
  commands.setBpm(110);
  assert.equal(calls.length, 2);
});

test("connectEngineSync: 엔진이 오류를 내도 문서 편집은 반영되고 오류는 안내로 간다", () => {
  const off = connectEngineSync({ sync() { throw new Error("엔진 고장"); } });
  assert.doesNotThrow(() => commands.setBpm(95));
  assert.equal(getDoc().bpm, 95);
  const notices = useNoticeStore.getState().notices;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, "error");
  assert.match(notices[0].message, /재생 중 변경 반영 실패/);
  off();
});

// ───── 이력 ─────

test("실행 취소·다시 실행은 바꾸기 전 문서 참조를 그대로 돌려놓는다", () => {
  const initial = getDoc();
  commands.setProjectName("하나");
  const one = getDoc();
  commands.setProjectName("둘");
  const two = getDoc();
  assert.equal(history.depth().undo, 2);
  assert.equal(history.undo(), true);
  assert.equal(getDoc(), one);
  assert.equal(history.undo(), true);
  assert.equal(getDoc(), initial);
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), true);
  assert.equal(getDoc(), one);
  assert.equal(history.redo(), true);
  assert.equal(getDoc(), two);
  assert.equal(history.redo(), false);
});

test("새 편집을 하면 다시 실행 목록이 비워진다. 이력은 100단계까지", () => {
  commands.setProjectName("a");
  commands.setProjectName("b");
  history.undo();
  assert.equal(history.canRedo(), true);
  commands.setProjectName("c");
  assert.equal(history.canRedo(), false);

  history.clear();
  for (let i = 0; i < HISTORY_LIMIT + 25; i++) commands.setProjectName(`이름 ${i}`);
  assert.equal(history.depth().undo, HISTORY_LIMIT);
});

test("조작 묶음(beginGesture~endGesture)은 한 단계, record:false는 이력에 남지 않는다", () => {
  const initial = getDoc();
  history.beginGesture("drag");
  const trackId = getDoc().tracks[0].id;
  commands.updateTrack(trackId, { volume: 0.1 });
  commands.updateTrack(trackId, { volume: 0.2 });
  commands.updateTrack(trackId, { volume: 0.3 });
  history.endGesture();
  assert.equal(history.depth().undo, 1);
  history.undo();
  assert.equal(getDoc(), initial);

  history.clear();
  commands.updateTrack(trackId, { volume: 0.7 }, { record: false });
  assert.equal(history.depth().undo, 0);
  assert.equal(getDoc().tracks[0].volume, 0.7);
});

test("같은 key로 800ms 안에 이어진 편집은 한 단계, 시간이 지나거나 key가 다르면 새 단계", () => {
  let clock = 1000;
  const local = createHistory(projectStore, { now: () => clock });
  const set = (name, key) => local.edit("이름", (draft) => { draft.name = name; }, { key });

  set("a", "name");
  clock += COALESCE_MS - 1;
  set("ab", "name");
  clock += COALESCE_MS - 1;
  set("abc", "name");
  assert.equal(local.depth().undo, 1, "연속 입력은 한 단계");

  clock += COALESCE_MS + 1;
  set("abcd", "name");
  assert.equal(local.depth().undo, 2, "멈췄다가 다시 입력하면 새 단계");

  set("x", "other");
  assert.equal(local.depth().undo, 3, "key가 다르면 새 단계");
  set("y", undefined);
  set("z", undefined);
  assert.equal(local.depth().undo, 5, "key가 없으면 묶지 않는다");
});

// ───── 거울 저장소(useDawStore) ─────

test("useDawStore의 문서 필드는 projectStore.doc과 같은 참조다(같은 호출 안에서 바로)", () => {
  const store = useDawStore.getState;
  store().addTrack();
  assert.equal(store().tracks, getDoc().tracks);
  assert.equal(store().tracks.length, 2);
  assert.equal(store().selectedTrackId, store().tracks[1].id);

  store().setBpm(88);
  assert.equal(store().bpm, 88);
  assert.equal(store().audioAssets, getDoc().audioAssets);

  const trackId = store().tracks[0].id;
  store().addClip(trackId, { id: "c1", audioBufferId: "a", name: "c", trackId, startTime: 0, offset: 0, duration: 1, sourceBpm: 88, stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0 });
  assert.deepEqual(store().selectedClipIds, ["c1"]);
  assert.equal(store().tracks[0].clips[0].id, "c1");

  assert.equal(store().undo().ok, true);
  assert.equal(store().tracks[0].clips.length, 0);
  assert.deepEqual(store().selectedClipIds, [], "되돌리면 선택이 풀린다");
  assert.equal(store().redo().ok, true);
  assert.equal(store().tracks[0].clips.length, 1);
});

test("클립을 다른 트랙으로 옮기고, 자르고, 지우는 동작이 예전과 같다", () => {
  const store = useDawStore.getState;
  store().addTrack();
  const [a, b] = store().tracks.map((track) => track.id);
  const clip = { id: "c1", audioBufferId: "x", name: "클립", trackId: a, startTime: 1, offset: 0, duration: 4, sourceBpm: 120, stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0 };
  store().addClip(a, clip);

  store().moveClip("c1", b, { startTime: 2 });
  assert.equal(store().tracks[0].clips.length, 0);
  assert.equal(store().tracks[1].clips[0].trackId, b);
  assert.equal(store().tracks[1].clips[0].startTime, 2);

  const sliced = store().sliceClipAt("c1", 4);
  assert.equal(sliced.ok, true);
  const parts = store().tracks[1].clips;
  assert.equal(parts.length, 2);
  assert.equal(parts[0].duration, 2);
  assert.equal(parts[1].startTime, 4);
  assert.equal(parts[1].offset, 2);
  assert.deepEqual(store().selectedClipIds, [parts[1].id]);

  assert.equal(store().sliceClipAt("c1", 2.01).reason, "outside-clip");
  assert.equal(store().sliceClipAt("없음", 1).reason, "not-found");

  store().setSelectedClips(parts.map((part) => part.id));
  const grouped = store().groupSelectedClips();
  assert.equal(grouped.ok, true);
  assert.equal(grouped.count, 2);
  assert.ok(store().tracks[1].clips[0].groupId);
  assert.equal(store().tracks[1].clips[0].groupId, store().tracks[1].clips[1].groupId);
  assert.equal(store().ungroupSelectedClips().ok, true);
  assert.equal(store().tracks[1].clips[0].groupId, undefined);

  const deleted = store().deleteSelectedClips();
  assert.equal(deleted.ok, true);
  assert.equal(deleted.count, 2);
  assert.equal(store().tracks[1].clips.length, 0);
  assert.deepEqual(store().selectedClipIds, []);
});

test("트랙 삭제는 선택·녹음 대기를 정리하고, 마지막 트랙과 녹음 중에는 거절한다", () => {
  const store = useDawStore.getState;
  assert.equal(store().deleteTrack(store().tracks[0].id).reason, "last-track");
  store().addTrack();
  const [a, b] = store().tracks.map((track) => track.id);
  const recording = useRecordingStore.getState;
  assert.equal(recording().toggleArm(b).ok, true);
  assert.equal(recording().armedTrackId, b);
  store().selectTrack(b);

  recording().setProgress({ status: "recording" });
  assert.equal(store().deleteTrack(b).reason, "recording");
  assert.equal(recording().armedTrackId, b, "거절되면 녹음 대기는 그대로");
  recording().resetProgress();

  const result = store().deleteTrack(b);
  assert.equal(result.ok, true);
  assert.equal(store().tracks.length, 1);
  assert.equal(store().selectedTrackId, a);
  assert.equal(recording().armedTrackId, undefined);
  assert.equal(recording().status, "idle");
  assert.equal(store().deleteTrack("없는-트랙").reason, "last-track");
});

test("프로젝트 불러오기·새 프로젝트는 문서를 통째로 바꾸고 화면 상태를 처음으로 돌리며, 실행 취소로 되돌릴 수 있다", () => {
  const store = useDawStore.getState;
  const initialId = getDoc().id;
  const imported = bigDoc(2, 2);
  store().setPlayhead(9);
  store().importProject({ ...imported, bpm: 999 });
  assert.equal(getDoc().id, "big");
  assert.equal(store().bpm, 300, "범위를 벗어난 템포는 보정");
  assert.equal(store().playhead, 0);
  assert.equal(store().tracks.length, 2);
  assert.equal(store().tracks[0].effectChain.length, 4, "빠진 값은 기본값으로 채움");

  store().resetProject();
  assert.equal(store().tracks.length, 1);
  assert.equal(store().name, "새 세션");

  history.undo();
  history.undo();
  assert.equal(getDoc().id, initialId);
});
