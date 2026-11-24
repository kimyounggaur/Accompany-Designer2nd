/**
 * P5-5 기본 편집 기능의 흐름: 진짜 스토어·문서·이력·안내에 이어서 확인한다(소리 풀기만 가짜).
 *  - 재생선에서 자르기(Ctrl+E) · 여러 클립 옮기기 · 복제(Ctrl+D) · 복사·붙여넣기(Ctrl+C/V)가 모두 "실행 취소 한 단계"인가
 *  - 박자표를 바꾸면 마디 스냅의 칸 길이가 따라 바뀌는가
 *  - 파일을 끌어다 놓으면 놓은 자리(트랙·시간)에 클립이 생기는가
 *  - 녹음 카운트인이 박자표를 따르는가
 * 값 계산 자체의 경우의 수는 clip-editing-math.test.mjs.
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

const actions = await import("../src/app/actions.ts");
const { recordingHost } = await import("../src/app/recordingHost.ts");
const { importDroppedFiles } = await import("../src/app/importing.ts");
const { ko } = await import("../src/i18n/ko.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");
const { useRecordingStore } = await import("../src/state/recordingStore.ts");
const { useDialogStore } = await import("../src/state/dialogStore.ts");
const { history } = await import("../src/state/history.ts");
const { clearClipboard, copyClips, readClipboard } = await import("../src/services/clipboard.ts");
const { forgetAllAudio } = await import("../src/services/persistence/audioBlobs.ts");
const { clearPeaks } = await import("../src/services/peaksCache.ts");
const { audioEngine } = await import("../src/audio/currentEngine.ts");
const { createDefaultTrack, createEmptyDoc } = await import("../src/domain/project/defaults.ts");
const { dropPlacementAt } = await import("../src/domain/timeline/drop.ts");

const ASSET = { id: "asset", fileName: "asset.wav", duration: 10, sampleRate: 48000, channels: 1, source: "upload" };

const store = () => useDawStore.getState();
const tracks = () => store().tracks;
const allClips = () => tracks().flatMap((track) => track.clips);
const clipById = (id) => allClips().find((clip) => clip.id === id);
const idsOf = (trackIndex) => tracks()[trackIndex].clips.map((clip) => clip.id);
const status = () => useNoticeStore.getState().statusMessage;
const steps = () => history.depth().undo;
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} ≈ ${expected}`);

/**
 * 트랙마다 클립 목록 `[id, 시작(초), 길이(초) = 2, 덮어쓸 값]`을 주면 그 문서를 올린다.
 * 클립은 모두 음원 "asset"(10초)을 쓴다. 올린 직후라 이력도 안내도 비어 있다.
 */
function setup(specs, { bpm = 120, assets = { asset: ASSET } } = {}) {
  const built = specs.map((clips, index) => {
    const track = createDefaultTrack(index + 1);
    track.clips = clips.map(([id, start, duration = 2, extra = {}]) => makeClip(track.id, id, start, { duration, ...extra }));
    return track;
  });
  store().importProject({ ...createEmptyDoc(), bpm, tracks: built, assets });
  history.clear();
  useNoticeStore.getState().reset();
}

beforeEach(() => {
  forgetAllAudio();
  audioEngine.clearBuffers();
  clearPeaks();
  store().resetProject();
  history.clear();
  useNoticeStore.getState().reset();
  useDialogStore.setState({ confirm: undefined });
  clearClipboard();
});

// ───── 재생선에서 자르기 ─────

test("자르기: 여러 클립을 같은 자리에서 한꺼번에 자르고, 오른쪽 조각들이 선택되며, 실행 취소 한 번에 모두 돌아온다", () => {
  setup([[["a", 0, 4]], [["b", 1, 4]], [["c", 6, 2]]]);
  const result = store().sliceClipsAt(["a", "b", "c"], 2);
  assert.deepEqual(result, { ok: true, count: 2 }, "c는 2초에 없으니 건너뛴다");
  assert.deepEqual(tracks().map((track) => track.clips.length), [2, 2, 1]);

  const [a, aRight] = tracks()[0].clips;
  assert.deepEqual([a.id, a.startTime, a.duration], ["a", 0, 2]);
  assert.deepEqual([aRight.name, aRight.startTime, aRight.offset, aRight.duration], ["a 조각", 2, 2, 2]);
  const [b, bRight] = tracks()[1].clips;
  assert.deepEqual([b.startTime, b.duration, bRight.startTime, bRight.offset, bRight.duration], [1, 1, 2, 1, 3]);

  assert.deepEqual(store().selectedClipIds, [aRight.id, bRight.id], "오른쪽 조각들이 선택된다");
  assert.equal(store().selectedClipId, bRight.id);
  assert.equal(steps(), 1, "여러 클립을 잘라도 이력은 한 단계");

  assert.equal(store().undo().ok, true);
  assert.deepEqual(tracks().map((track) => track.clips.length), [1, 1, 1]);
  assert.equal(clipById("a").duration, 4);
  assert.equal(clipById("b").duration, 4);
  assert.equal(history.canUndo(), false);

  assert.equal(store().redo().ok, true);
  assert.deepEqual(tracks().map((track) => track.clips.length), [2, 2, 1]);
});

test("자르기: 같은 트랙에서 겹친 두 클립을 함께 잘라도 순서가 흐트러지지 않는다", () => {
  setup([[["a", 0, 4], ["b", 1, 4]]]);
  assert.equal(store().sliceClipsAt(["a", "b"], 2).ok, true);
  assert.deepEqual(tracks()[0].clips.map((clip) => [clip.name, clip.startTime, clip.duration]), [["a", 0, 2], ["a 조각", 2, 2], ["b", 1, 1], ["b 조각", 2, 3]]);
});

test("자르기: 하나도 자를 수 없으면 실패하고 문서·이력·선택이 그대로다", () => {
  setup([[["a", 0, 2]]]);
  store().setSelectedClips(["a"]);
  for (const [ids, time] of [[["a"], 100], [["a"], 0.01], [[], 1], [["없는 클립"], 1]]) {
    assert.deepEqual(store().sliceClipsAt(ids, time), { ok: false, reason: "none-cuttable" });
  }
  assert.equal(history.canUndo(), false);
  assert.deepEqual(idsOf(0), ["a"]);
  assert.deepEqual(store().selectedClipIds, ["a"]);
});

// ───── 여러 클립 옮기기 ─────

test("옮기기: 여러 클립이 대상 트랙의 맨 뒤로 함께 옮겨지고, 실행 취소 한 번에 모두 제자리로 돌아온다", () => {
  setup([[["a", 0], ["b", 4]], [["c", 1]]]);
  const [first, second] = tracks().map((track) => track.id);
  store().setSelectedClips(["a", "b"]);

  store().moveClips([
    { clipId: "a", trackId: second, startTime: 3 },
    { clipId: "b", trackId: second, startTime: 7 },
  ]);
  assert.deepEqual(idsOf(0), []);
  assert.deepEqual(idsOf(1), ["c", "a", "b"], "옮긴 클립은 대상 트랙 맨 뒤에, 쥔 클립(마지막)이 맨 위");
  assert.deepEqual([clipById("a").trackId, clipById("a").startTime, clipById("b").startTime], [second, 3, 7]);
  assert.deepEqual(store().selectedClipIds, ["a", "b"], "쥔 클립이 선택에 있으면 선택은 그대로");
  assert.equal(store().selectedClipId, "b");
  assert.equal(steps(), 1);

  store().undo();
  assert.deepEqual(idsOf(0), ["a", "b"]);
  assert.deepEqual(idsOf(1), ["c"]);
  assert.deepEqual([clipById("a").trackId, clipById("a").startTime, clipById("b").trackId, clipById("b").startTime], [first, 0, first, 4]);
});

test("옮기기: 같은 트랙 안에서 순서가 그대로면 시작 시간만 바뀐다", () => {
  setup([[["a", 0], ["b", 4]]]);
  const trackId = tracks()[0].id;
  assert.equal(store().moveClips([{ clipId: "a", trackId, startTime: 1 }, { clipId: "b", trackId, startTime: 5 }]), undefined);
  assert.deepEqual(idsOf(0), ["a", "b"]);
  assert.deepEqual([clipById("a").startTime, clipById("b").startTime], [1, 5]);
  assert.equal(steps(), 1);
  store().undo();
  assert.deepEqual([clipById("a").startTime, clipById("b").startTime], [0, 4]);
});

test("옮기기: 끌기 묶음 안에서 여러 번 옮겨도 이력은 한 단계다", () => {
  setup([[["a", 0], ["b", 4]], []]);
  const [first, second] = tracks().map((track) => track.id);
  store().setSelectedClips(["a", "b"]);
  history.beginGesture("clip:drag");
  for (const shift of [1, 2, 3]) {
    store().moveClips([
      { clipId: "a", trackId: second, startTime: shift },
      { clipId: "b", trackId: second, startTime: 4 + shift },
    ]);
  }
  history.endGesture();
  assert.deepEqual([clipById("a").trackId, clipById("a").startTime, clipById("b").startTime], [second, 3, 7]);
  assert.equal(steps(), 1, "프레임마다 옮겨도 한 번의 끌기");
  store().undo();
  assert.deepEqual([clipById("a").trackId, clipById("a").startTime, clipById("b").trackId, clipById("b").startTime], [first, 0, first, 4]);
  assert.equal(history.canUndo(), false);
});

test("옮기기: 쥔 클립이 선택 밖이면 그 클립만 선택된다(단일 이동과 같다)", () => {
  setup([[["a", 0], ["b", 4]]]);
  const trackId = tracks()[0].id;
  store().setSelectedClips(["b"]);
  store().moveClips([{ clipId: "a", trackId, startTime: 1 }]);
  assert.deepEqual(store().selectedClipIds, ["a"]);
  assert.equal(store().selectedClipId, "a");
});

test("옮기기: 없는 클립·없는 트랙·빈 목록은 건너뛰고, 아무것도 못 옮기면 이력·선택이 그대로다", () => {
  setup([[["a", 0]]]);
  const trackId = tracks()[0].id;
  store().setSelectedClips(["a"]);
  store().moveClips([]);
  store().moveClips([{ clipId: "없는 클립", trackId, startTime: 1 }]);
  store().moveClips([{ clipId: "a", trackId: "없는 트랙", startTime: 1 }]);
  store().moveClips([{ clipId: "a", trackId, startTime: 0 }]);
  assert.equal(history.canUndo(), false, "그 자리 그대로면 기록하지 않는다");
  assert.equal(clipById("a").startTime, 0);
  assert.deepEqual(store().selectedClipIds, ["a"]);
});

// ───── 복제 ─────

test("복제: 고른 클립을 한 덩어리로 덩어리 끝 뒤에 같은 트랙·같은 간격으로 놓고(음소거 유지), 복제본이 선택되며, 실행 취소 한 번에 사라진다", () => {
  setup([[["a", 0, 2], ["b", 3, 1]], [["c", 1, 3, { muted: true }]]]);
  store().setSelectedClips(["a", "b", "c"]);
  const result = store().duplicateSelectedClips();
  assert.deepEqual(result, { ok: true, count: 3 });

  // 덩어리는 0 ~ 4초: 복제본은 4초 뒤에서 시작한다
  const [a2, b2] = tracks()[0].clips.slice(2);
  const [c2] = tracks()[1].clips.slice(1);
  assert.deepEqual([a2.name, a2.startTime, b2.name, b2.startTime, c2.name, c2.startTime], ["a 복사본", 4, "b 복사본", 7, "c 복사본", 5]);
  assert.equal(c2.muted, true, "음소거 상태도 그대로 복제된다");
  assert.ok([a2, b2, c2].every((clip) => clip.audioBufferId === "asset" && !["a", "b", "c"].includes(clip.id)), "새 id, 같은 음원");
  assert.deepEqual(store().selectedClipIds, [a2.id, b2.id, c2.id], "복제본이 선택된다");
  assert.equal(store().selectedClipId, c2.id);
  assert.equal(steps(), 1);

  store().undo();
  assert.deepEqual(tracks().map((track) => track.clips.map((clip) => clip.id)), [["a", "b"], ["c"]]);
});

test("복제: 같은 그룹이던 클립이 둘 이상이면 복제본끼리 새 그룹으로 묶고, 하나뿐이면 그룹 없이 놓는다", () => {
  setup([[["a", 0, 2, { groupId: "g1" }], ["b", 2, 2, { groupId: "g1" }]], [["c", 0, 2, { groupId: "g2" }]]]);
  store().setSelectedClips(["a", "b", "c"]);
  store().duplicateSelectedClips();
  const [a2, b2] = tracks()[0].clips.slice(2);
  const c2 = tracks()[1].clips[1];
  assert.ok(a2.groupId !== undefined && a2.groupId === b2.groupId, "a·b 복제본은 같은 새 그룹");
  assert.notEqual(a2.groupId, "g1", "원래 그룹과는 따로");
  assert.equal(c2.groupId, undefined, "그룹의 한 명뿐이면 그룹을 잇지 않는다");
  assert.deepEqual([clipById("a").groupId, clipById("b").groupId, clipById("c").groupId], ["g1", "g1", "g2"], "원본의 그룹은 그대로");
});

test("복제: 고른 클립이 없으면 실패하고 문서·이력이 그대로다. 복제본을 다시 복제하면 바로 뒤로 이어진다", () => {
  setup([[["a", 0, 2]]]);
  assert.deepEqual(store().duplicateSelectedClips(), { ok: false, reason: "none-selected" });
  assert.equal(history.canUndo(), false);

  store().setSelectedClips(["a"]);
  store().duplicateSelectedClips();
  store().duplicateSelectedClips();
  assert.deepEqual(tracks()[0].clips.map((clip) => clip.startTime), [0, 2, 4]);
  assert.equal(steps(), 2, "복제 한 번이 한 단계");
});

// ───── 복사·붙여넣기 ─────

test("붙여넣기: 트랙만 골랐으면 그 트랙부터 놓고, 모자란 트랙은 새로 만들며, 실행 취소 한 번에 클립과 새 트랙이 함께 사라진다", () => {
  setup([[["a", 1], ["b", 3]], [["c", 2]], [], []]);
  assert.equal(copyClips(tracks(), ["a", "c"]), 2);
  store().selectClip(undefined);
  useDawStore.setState({ selectedTrackId: tracks()[3].id });

  const result = store().pasteClips(readClipboard(), 10);
  assert.deepEqual(result, { ok: true, count: 2, newTracks: 1 });
  assert.equal(tracks().length, 5);
  const [aCopy] = tracks()[3].clips;
  const [cCopy] = tracks()[4].clips;
  assert.deepEqual([aCopy.name, aCopy.startTime, aCopy.audioBufferId], ["a", 10, "asset"], "가장 앞 클립이 재생 위치에");
  assert.deepEqual([cCopy.name, cCopy.startTime, cCopy.trackId], ["c", 11, tracks()[4].id], "서로의 시간 간격과 트랙 간격을 지킨다");
  assert.deepEqual(store().selectedClipIds, [aCopy.id, cCopy.id]);
  assert.equal(steps(), 1, "새 트랙을 만든 것까지 한 단계");

  store().undo();
  assert.equal(tracks().length, 4);
  assert.deepEqual(tracks().map((track) => track.clips.length), [2, 1, 0, 0]);
});

test("붙여넣기: 클립을 고른 채면 트랙 선택은 따르지 않고 복사한 클립이 있던 트랙에 놓는다", () => {
  setup([[["a", 1], ["b", 3]], [["c", 2]], [], []]);
  copyClips(tracks(), ["a", "c"]);
  store().setSelectedClips(["b"]);
  useDawStore.setState({ selectedTrackId: tracks()[3].id });
  const result = store().pasteClips(readClipboard(), 5);
  assert.deepEqual(result, { ok: true, count: 2, newTracks: 0 });
  assert.equal(tracks().length, 4);
  assert.deepEqual(tracks().map((track) => track.clips.length), [3, 2, 0, 0]);
  assert.equal(tracks()[0].clips[2].startTime, 5);
  assert.equal(tracks()[1].clips[1].startTime, 6);
});

test("붙여넣기: 복사한 트랙이 지워졌고 고른 트랙도 없으면 첫 트랙에 놓는다", () => {
  setup([[["a", 0]], [["c", 0]]]);
  copyClips(tracks(), ["c"]);
  assert.equal(store().deleteTrack(tracks()[1].id).ok, true);
  store().selectClip(undefined);
  useDawStore.setState({ selectedTrackId: undefined });
  const result = store().pasteClips(readClipboard(), 3);
  assert.equal(result.ok, true);
  assert.deepEqual(tracks()[0].clips.map((clip) => [clip.name, clip.startTime]), [["a", 0], ["c", 3]]);
});

test("붙여넣기: 이 프로젝트에 음원이 없는 클립은 붙이지 않는다(전부 없으면 실패, 일부면 있는 것만)", () => {
  setup([[["a", 0], ["x", 1, 2, { audioBufferId: "다른 프로젝트 음원" }]]]);
  copyClips(tracks(), ["x"]);
  assert.deepEqual(store().pasteClips(readClipboard(), 5), { ok: false, reason: "no-source" });
  assert.equal(history.canUndo(), false);
  assert.equal(allClips().length, 2);

  copyClips(tracks(), ["a", "x"]);
  const result = store().pasteClips(readClipboard(), 5);
  assert.deepEqual(result, { ok: true, count: 1, newTracks: 0 });
  assert.deepEqual(tracks()[0].clips.map((clip) => clip.name), ["a", "x", "a"], "음원이 있는 a만 붙었다");
  assert.equal(tracks()[0].clips[2].startTime, 5);
});

test("붙여넣기: 복사한 것이 비어 있으면 실패한다", () => {
  setup([[["a", 0]]]);
  assert.deepEqual(store().pasteClips({ items: [], originTrackId: "x" }, 0), { ok: false, reason: "empty" });
  assert.equal(history.canUndo(), false);
});

// ───── 동작(안내 문구) ─────

test("동작: 재생선에서 자르기 — 고른 클립이 없으면 재생선이 지나는 모든 클립을 자르고 개수를 알린다", () => {
  setup([[["a", 0, 4]], [["b", 1, 4]], [["c", 6, 2]]]);
  store().selectClip(undefined);
  store().setCursor(2);
  actions.sliceSelectedClipsAtPlayhead();
  assert.equal(status(), ko.notice.clipsSliced(2));
  assert.deepEqual(tracks().map((track) => track.clips.length), [2, 2, 1]);
  assert.equal(steps(), 1);
});

test("동작: 재생선에서 자르기 — 하나만 자르면 '클립 자르기 완료', 고른 클립만 자른다", () => {
  setup([[["a", 0, 4]], [["b", 1, 4]]]);
  store().setSelectedClips(["a"]);
  store().setCursor(2);
  actions.sliceSelectedClipsAtPlayhead();
  assert.equal(status(), "클립 자르기 완료");
  assert.deepEqual(tracks().map((track) => track.clips.length), [2, 1], "고르지 않은 b는 그대로");
});

test("동작: 재생선에서 자르기 — 자를 클립이 없으면 이유만 알리고 문서는 그대로", () => {
  setup([[["a", 0, 2]], [["b", 5, 2]]]);
  store().selectClip(undefined);
  store().setCursor(3.5);
  actions.sliceSelectedClipsAtPlayhead();
  assert.equal(status(), ko.notice.playheadOnNoClip);

  store().setSelectedClips(["b"]);
  store().setCursor(1);
  actions.sliceSelectedClipsAtPlayhead();
  assert.equal(status(), ko.notice.playheadOutsideSelection, "고른 클립을 재생선이 지나지 않는다");
  assert.equal(history.canUndo(), false);
  assert.equal(allClips().length, 2);
});

test("동작: 복제 — 하나면 '클립을 복제했습니다.', 여럿이면 개수, 고른 것이 없으면 안내만", () => {
  setup([[["a", 0], ["b", 3]]]);
  store().selectClip(undefined);
  actions.duplicateSelectedClips();
  assert.equal(status(), ko.notice.duplicateNeedsSelection);
  assert.equal(history.canUndo(), false);

  store().setSelectedClips(["a"]);
  actions.duplicateSelectedClips();
  assert.equal(status(), "클립을 복제했습니다.");

  store().setSelectedClips(["a", "b"]);
  actions.duplicateSelectedClips();
  assert.equal(status(), ko.notice.clipsDuplicated(2));
});

test("동작: 복사·붙여넣기 — 안내 문구와 새 트랙 안내, 복사한 것이 없을 때의 안내", () => {
  setup([[["a", 1]], [["b", 2]], []]);
  actions.pasteClips();
  assert.equal(status(), ko.notice.pasteNeedsCopy, "아직 복사한 것이 없다");

  store().selectClip(undefined);
  actions.copySelectedClips();
  assert.equal(status(), ko.notice.copyNeedsSelection);

  store().setSelectedClips(["a", "b"]);
  actions.copySelectedClips();
  assert.equal(status(), "클립 2개 복사됨");

  store().selectClip(undefined);
  useDawStore.setState({ selectedTrackId: tracks()[2].id });
  store().setCursor(10);
  actions.pasteClips();
  assert.equal(status(), ko.notice.clipsPastedToNewTracks(2, 1), "셋째 트랙부터 두 줄이 필요해서 새 트랙이 하나 생긴다");
  assert.equal(tracks().length, 4);

  useDawStore.setState({ selectedTrackId: undefined });
  store().selectClip(undefined);
  actions.pasteClips();
  assert.equal(status(), "클립 2개 붙여넣기 완료", "새 트랙이 필요 없으면 일반 안내");
});

test("동작: 붙여넣기 — 음원이 없는 클립이면 붙였다고 알리지 않고 이유를 알린다", () => {
  setup([[["x", 0, 2, { audioBufferId: "다른 프로젝트 음원" }]]]);
  copyClips(tracks(), ["x"]);
  actions.pasteClips();
  assert.equal(status(), ko.notice.pasteNeedsSource);
  assert.equal(allClips().length, 1);
});

// ───── 박자표와 마디 스냅 ─────

test("박자표: 마디 스냅의 칸 길이가 박자표를 따라 바뀌고, 실행 취소·다시 실행도 따라간다", () => {
  store().setPlaylistSnap("bar");
  near(store().gridDivision, 1 / 4, "4/4 한 마디 = 4박");

  store().setTimeSignature({ beats: 3, unit: 4 });
  assert.deepEqual(store().timeSignature, { beats: 3, unit: 4 });
  near(store().gridDivision, 1 / 3, "3/4 한 마디 = 3박");
  assert.equal(steps(), 1);

  store().undo();
  assert.deepEqual(store().timeSignature, { beats: 4, unit: 4 });
  near(store().gridDivision, 1 / 4, "되돌리면 격자도 돌아온다");

  store().redo();
  near(store().gridDivision, 1 / 3);
});

test("박자표: 6/8·2/4도 마디 스냅 간격을 따르고, 마디가 아닌 스냅은 박자표와 상관없다", () => {
  store().setPlaylistSnap("bar");
  store().setTimeSignature({ beats: 6, unit: 8 });
  near(store().gridDivision, 1 / 3, "6/8 한 마디 = 4분음표 3개");
  store().setTimeSignature({ beats: 2, unit: 4 });
  near(store().gridDivision, 1 / 2, "2/4 한 마디 = 2박");

  store().setPlaylistSnap("beat");
  const beat = store().gridDivision;
  store().setTimeSignature({ beats: 3, unit: 4 });
  assert.equal(store().gridDivision, beat, "박 스냅은 박자표를 따르지 않는다");
});

test("박자표: 같은 박자표를 다시 고르면 이력에 남기지 않는다", () => {
  store().setTimeSignature({ beats: 4, unit: 4 });
  assert.equal(history.canUndo(), false);
});

// ───── 파일 끌어다 놓기 ─────

const fileOf = (name, bytes) => new File([new Uint8Array(bytes)], name, { type: "audio/wav" });

/** 소리 풀기를 가짜로: 파일마다 새 임시 음원 id를 주고, 이름에 "깨진"이 들어 있으면 풀지 못한다 */
function fakeDecoder(durations = {}) {
  let counter = 0;
  return {
    decode: async (file) => {
      if (file.name.includes("깨진")) throw new Error("decode failed");
      const id = `drop${++counter}`;
      return {
        asset: { id, fileName: file.name, duration: durations[file.name] ?? 4, sampleRate: 44100, channels: 2, source: "upload", mimeType: file.type || undefined, byteSize: file.size },
        registerAs: () => {},
        release: () => {},
      };
    },
  };
}

test("끌어다 놓기: 놓은 트랙·시간에 클립이 생기고(재생 위치와 상관없이) 음원도 문서에 들어간다", async () => {
  setup([[], []], { assets: {} });
  store().setCursor(7);
  await importDroppedFiles([fileOf("반주.wav", [1])], { row: 1, time: 2.5 }, fakeDecoder());
  assert.equal(tracks().length, 2, "트랙이 늘지 않는다");
  assert.deepEqual(tracks()[0].clips, []);
  const [clip] = tracks()[1].clips;
  assert.deepEqual([clip.name, clip.startTime, clip.trackId], ["반주.wav", 2.5, tracks()[1].id]);
  assert.equal(clip.stretchMode, "none");
  assert.ok(store().assets[clip.audioBufferId], "음원도 문서에 들어갔다");
});

test("끌어다 놓기: 트랙 아래 빈 곳(칸 번호 = 트랙 수)에 놓으면 새 트랙이 하나 생긴다", async () => {
  setup([[["a", 0]]], { assets: { asset: ASSET } });
  await importDroppedFiles([fileOf("새.wav", [2])], { row: 1, time: 3 }, fakeDecoder());
  assert.equal(tracks().length, 2);
  assert.deepEqual(tracks()[1].clips.map((clip) => [clip.name, clip.startTime]), [["새.wav", 3]]);
  assert.deepEqual(idsOf(0), ["a"], "위 트랙은 그대로");
});

test("끌어다 놓기: 놓은 트랙에 이미 클립이 겹쳐 있어도 사용자가 고른 자리에 그대로 놓는다", async () => {
  setup([[["긴 클립", 0, 10]]]);
  await importDroppedFiles([fileOf("겹침.wav", [3])], { row: 0, time: 1 }, fakeDecoder());
  assert.equal(tracks().length, 1, "새 트랙으로 피하지 않는다");
  assert.deepEqual(tracks()[0].clips.map((clip) => [clip.name, clip.startTime]), [["긴 클립", 0], ["겹침.wav", 1]]);
});

test("끌어다 놓기: 파일 여러 개는 놓은 트랙부터 아래로 한 줄씩 같은 시간에 놓이고, 모자란 트랙은 새로 만든다", async () => {
  setup([[], []], { assets: {} });
  await importDroppedFiles([fileOf("가.wav", [1]), fileOf("나.wav", [2]), fileOf("다.wav", [3])], { row: 1, time: 4 }, fakeDecoder());
  assert.equal(tracks().length, 4, "둘째 트랙부터 셋 → 트랙 2개가 새로 생긴다");
  assert.deepEqual(tracks().map((track) => track.clips.map((clip) => [clip.name, clip.startTime])), [[], [["가.wav", 4]], [["나.wav", 4]], [["다.wav", 4]]]);
});

test("끌어다 놓기: 풀리지 않는 파일은 건너뛰고, 다음 파일은 그 칸을 비우지 않고 바로 이어서 놓는다", async () => {
  setup([[], []], { assets: {} });
  await importDroppedFiles([fileOf("깨진.wav", [1]), fileOf("나.wav", [2])], { row: 0, time: 1 }, fakeDecoder());
  assert.equal(tracks().length, 2);
  assert.deepEqual(tracks().map((track) => track.clips.map((clip) => clip.name)), [["나.wav"], []]);
  assert.equal(useNoticeStore.getState().notices.some((notice) => notice.level === "error"), true, "깨진 파일은 오류로 알린다");
});

test("끌어다 놓기: 스냅이 반영된 시간(마디 시작)이 그대로 클립 시작이 된다", async () => {
  setup([[]], { assets: {} });
  store().setPlaylistSnap("bar");
  store().setTimeSignature({ beats: 3, unit: 4 });
  const state = store();
  // 120 BPM 3/4 → 한 마디 1.5초. 96px/s 확대에서 x = 300px(3.125초)는 가장 가까운 마디 시작 3초로 붙는다.
  const placement = dropPlacementAt(300, 20, { zoomPxPerSecond: 96, trackHeight: 116, trackCount: state.tracks.length, bpm: state.bpm, snap: state.snapEnabled, gridDivision: state.gridDivision });
  near(placement.time, 3);
  await importDroppedFiles([fileOf("마디.wav", [4])], placement, fakeDecoder());
  near(tracks()[0].clips[0].startTime, 3);
});

// ───── 녹음 카운트인과 박자표 ─────

test("녹음 설정: 카운트인 박 수가 박자표에 맞는 값으로 정해지고, 저장된 값은 그대로다", () => {
  useRecordingStore.getState().setCountIn(4);
  assert.equal(recordingHost.settings().countInBeats, 4, "4/4에서 4는 1마디");
  assert.deepEqual(recordingHost.timeSignature(), { beats: 4, unit: 4 });

  store().setTimeSignature({ beats: 3, unit: 4 });
  assert.equal(recordingHost.settings().countInBeats, 3, "3/4에서는 가장 가까운 선택지 1마디(3박)");
  assert.deepEqual(recordingHost.timeSignature(), { beats: 3, unit: 4 });
  assert.equal(useRecordingStore.getState().countInBeats, 4, "저장된 값은 바꾸지 않는다: 4/4로 돌아오면 다시 4");

  store().setTimeSignature({ beats: 6, unit: 8 });
  assert.equal(recordingHost.settings().countInBeats, 6, "6/8의 한 마디는 클릭 6번");
  assert.deepEqual(recordingHost.timeSignature(), { beats: 6, unit: 8 });

  store().undo();
  store().undo();
  assert.equal(recordingHost.settings().countInBeats, 4);
});

test("녹음 설정: 카운트인이 없음(0)이면 박자표와 상관없이 0이다", () => {
  useRecordingStore.getState().setCountIn(0);
  store().setTimeSignature({ beats: 6, unit: 8 });
  assert.equal(recordingHost.settings().countInBeats, 0);
});
