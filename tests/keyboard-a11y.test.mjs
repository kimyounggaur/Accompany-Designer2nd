/**
 * P6-2 접근성: 클립 키보드 조작(←→ 격자 한 칸 이동, Shift+←→ 길이, Enter 고르기)과 화면 낭독기 안내.
 * 설계서 수용 기준(단위 쪽): 방향키가 격자 한 칸씩 움직이고, 한 번 누르면 격자에 맞고, 0초 앞으로 가지 않고,
 * 옮겨도 클립 순서(=키보드 초점)가 바뀌지 않으며, 이어 누르면 실행 취소 한 단계로 묶인다.
 * (e2e: axe 위반 0, 키보드만으로 "업로드 → 재생 → 클립 선택 → 자르기 → 저장" — e2e/report-regression.spec.ts)
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";

globalThis.window = { AudioContext: FakeContext };

const actions = await import("../src/app/actions.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { useAnnounceStore } = await import("../src/state/announceStore.ts");
const { history } = await import("../src/state/history.ts");
const { announce } = await import("../src/services/announce.ts");
const { transportAnnouncement } = await import("../src/services/transportAnnouncement.ts");
const { stepOnGrid } = await import("../src/domain/timeline/clipMath.ts");
const { getGridStepSeconds, snapTime } = await import("../src/utils/audioMath.ts");
const { ko } = await import("../src/i18n/ko.ts");

const store = () => useDawStore.getState();
const tracks = () => store().tracks;
const message = () => useAnnounceStore.getState().message;
const clipById = (id) => tracks().flatMap((track) => track.clips).find((clip) => clip.id === id);
const order = (trackIndex = 0) => tracks()[trackIndex].clips.map((clip) => clip.id);
const clipOn = (trackId, id, startTime, overrides = {}) => ({
  id, audioBufferId: "asset", name: id, trackId, startTime, offset: 0, duration: 2, sourceBpm: 120,
  stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false, ...overrides,
});
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);

/** 첫 트랙에 a(0초)·b(3초)·c(6초) 클립 셋(길이 2초)과 10초짜리 음원을 놓는다. bpm 120, 반 박 격자 = 0.25초. */
function threeClips() {
  store().resetProject();
  history.clear();
  useAnnounceStore.getState().reset();
  useDawStore.setState({ snapEnabled: true, gridDivision: 2, bpm: 120 });
  store().addAudioAsset({ id: "asset", fileName: "asset.wav", duration: 10, sampleRate: 48000, channels: 1, source: "upload" });
  const trackId = tracks()[0].id;
  for (const [id, at] of [["a", 0], ["b", 3], ["c", 6]]) store().addClip(trackId, clipOn(trackId, id, at));
  store().setSelectedClips([]);
  history.clear();
  return trackId;
}

beforeEach(() => {
  threeClips();
});

// ───── 격자 계산 ─────

test("격자 한 칸의 길이: 박 길이 ÷ 분할 수, 1보다 작은 분할(마디 스냅)은 역수를 곱한다", () => {
  near(getGridStepSeconds(120, 2), 0.25, "120 BPM 반 박");
  near(getGridStepSeconds(120, 1), 0.5, "120 BPM 한 박");
  near(getGridStepSeconds(60, 4), 0.25, "60 BPM 네 칸");
  near(getGridStepSeconds(120, 0.25), 2, "120 BPM 한 마디(4박)");
  // snapTime은 같은 한 칸 길이로 가장 가까운 격자 선에 붙인다(예전 결과와 같다)
  near(snapTime(0.6, 120, true, 2), 0.5, "0.6초 → 0.5초");
  near(snapTime(0.7, 120, true, 2), 0.75, "0.7초 → 0.75초");
  assert.equal(snapTime(0.6, 120, false, 2), 0.6, "스냅이 꺼져 있으면 그대로");
});

test("stepOnGrid(스냅 켜짐): 선 위에서는 한 칸 옆 선으로, 선 사이에서는 그쪽의 첫 선으로", () => {
  near(stepOnGrid(1.0, 1, 0.25, true), 1.25, "선 위 → 오른쪽 한 칸");
  near(stepOnGrid(1.0, -1, 0.25, true), 0.75, "선 위 → 왼쪽 한 칸");
  near(stepOnGrid(1.1, 1, 0.25, true), 1.25, "선 사이 → 오른쪽 첫 선");
  near(stepOnGrid(1.1, -1, 0.25, true), 1.0, "선 사이 → 왼쪽 첫 선");
  near(stepOnGrid(0, -1, 0.25, true), -0.25, "0초 앞은 부르는 쪽이 막는다");
});

test("stepOnGrid: 부동소수점 끝자리가 있어도 '선 위'로 읽는다", () => {
  near(stepOnGrid(0.1 + 0.2, 1, 0.1, true), 0.4, "0.30000000000000004는 0.3 선 위");
  near(stepOnGrid(0.1 + 0.2, -1, 0.1, true), 0.2, "왼쪽도 한 칸");
  near(stepOnGrid(2.4999999, 1, 0.25, true), 2.75, "백만분의 1초 못 미친 값도 2.5 선 위");
});

test("stepOnGrid(스냅 꺼짐): 격자에 맞추지 않고 한 칸 길이만큼 더하거나 뺀다", () => {
  near(stepOnGrid(1.1, 1, 0.25, false), 1.35, "더하기");
  near(stepOnGrid(1.1, -1, 0.25, false), 0.85, "빼기");
  assert.equal(stepOnGrid(1.1, 1, 0, true), 1.1, "한 칸이 0이면 그대로");
  assert.ok(Number.isNaN(stepOnGrid(Number.NaN, 1, 0.25, true)), "숫자가 아닌 값은 그대로 돌려준다");
});

// ───── 제자리 이동 명령 ─────

test("setClipStarts: 시작 시간만 바꾸고 클립 순서(겹침 순서·초점)는 그대로다", () => {
  assert.deepEqual(order(), ["a", "b", "c"]);
  assert.equal(store().setClipStarts([{ clipId: "a", startTime: 1 }]), true);
  assert.equal(clipById("a").startTime, 1);
  assert.deepEqual(order(), ["a", "b", "c"], "끌기(moveClips)와 달리 a가 맨 뒤로 가지 않는다");
});

test("setClipStarts: 0초 아래는 0초로 막고, 바뀐 것이 없으면 이력 단계를 만들지 않는다", () => {
  assert.equal(store().setClipStarts([{ clipId: "b", startTime: -4 }]), true);
  assert.equal(clipById("b").startTime, 0);
  const depth = history.depth().undo;
  assert.equal(store().setClipStarts([{ clipId: "b", startTime: 0 }]), false, "같은 값");
  assert.equal(store().setClipStarts([{ clipId: "없는클립", startTime: 5 }]), false, "없는 클립");
  assert.equal(history.depth().undo, depth, "단계가 늘지 않는다");
});

test("setClipStarts: 같은 클립을 이어서 옮기면 실행 취소 한 단계로 묶이고, 한 번에 처음 자리로 돌아온다", () => {
  const before = history.depth().undo;
  store().setClipStarts([{ clipId: "a", startTime: 0.25 }]);
  store().setClipStarts([{ clipId: "a", startTime: 0.5 }]);
  store().setClipStarts([{ clipId: "a", startTime: 0.75 }]);
  assert.equal(history.depth().undo, before + 1, "세 번 눌러도 한 단계");
  actions.undo();
  assert.equal(clipById("a").startTime, 0, "한 번의 실행 취소로 처음 자리");
});

// ───── 클립 이동(←·→) ─────

test("nudgeClip: 스냅이 켜져 있으면 한 번에 격자 한 칸(0.25초)씩 가고 새 시작 시간을 알린다", () => {
  assert.equal(actions.nudgeClip("b", 1), true);
  near(clipById("b").startTime, 3.25, "오른쪽 한 칸");
  assert.equal(message(), ko.announce.clipStart("b", "3.25초"));
  actions.nudgeClip("b", -1);
  actions.nudgeClip("b", -1);
  near(clipById("b").startTime, 2.75, "왼쪽으로 두 칸");
  assert.deepEqual(order(), ["a", "b", "c"], "순서 그대로");
  assert.deepEqual(store().selectedClipIds, [], "선택도 그대로(초점을 옮기는 키라서 선택은 건드리지 않는다)");
});

test("nudgeClip: 격자 사이에 있던 클립은 첫 누름에서 가까운 격자 선에 붙는다", () => {
  store().setClipStarts([{ clipId: "b", startTime: 3.1 }]);
  actions.nudgeClip("b", 1);
  near(clipById("b").startTime, 3.25, "3.1 → 3.25");
  store().setClipStarts([{ clipId: "b", startTime: 3.1 }]);
  actions.nudgeClip("b", -1);
  near(clipById("b").startTime, 3.0, "3.1 → 3.0");
});

test("nudgeClip: 곡 시작(0초) 앞으로는 가지 않고, 그 자리에서도 위치를 알린다", () => {
  assert.equal(actions.nudgeClip("a", -1), false, "이미 0초: 바뀐 것이 없다");
  near(clipById("a").startTime, 0, "0초");
  assert.equal(message(), ko.announce.clipStart("a", "0.00초"));
});

test("nudgeClip: 스냅이 꺼져 있으면 격자에 맞추지 않고 한 칸 길이만큼 간다", () => {
  useDawStore.setState({ snapEnabled: false });
  store().setClipStarts([{ clipId: "b", startTime: 3.1 }]);
  actions.nudgeClip("b", 1);
  near(clipById("b").startTime, 3.35, "3.1 + 0.25");
});

test("nudgeClip: 격자 칸 크기는 분할 수를 따른다(한 박 = 0.5초)", () => {
  useDawStore.setState({ gridDivision: 1 });
  actions.nudgeClip("b", 1);
  near(clipById("b").startTime, 3.5, "한 박");
});

test("nudgeClip: 선택에 들어 있는 클립이면 선택 전체가 같은 거리만큼 함께 가고 간격이 유지된다", () => {
  store().setSelectedClips(["a", "b"]);
  actions.nudgeClip("b", 1);
  near(clipById("a").startTime, 0.25, "a도 함께");
  near(clipById("b").startTime, 3.25, "b");
  near(clipById("c").startTime, 6, "선택 밖의 c는 그대로");
  // 맨 앞 클립(a)이 0초에서 멈추면 전체가 함께 멈춘다
  store().setClipStarts([{ clipId: "a", startTime: 0 }, { clipId: "b", startTime: 3 }]);
  actions.nudgeClip("b", -1);
  near(clipById("a").startTime, 0, "a는 0초 앞으로 못 간다");
  near(clipById("b").startTime, 3, "그래서 선택 전체가 그 자리에서 함께 멈춘다(끌기와 같은 규칙, 간격이 흐트러지지 않는다)");
});

test("nudgeClip: 선택 밖의 클립에서 누르면 그 클립만 간다", () => {
  store().setSelectedClips(["a"]);
  actions.nudgeClip("c", 1);
  near(clipById("a").startTime, 0, "선택된 a는 그대로");
  near(clipById("c").startTime, 6.25, "c만");
});

test("nudgeClip: 없는 클립이면 아무 일도 하지 않는다", () => {
  assert.equal(actions.nudgeClip("없음", 1), false);
  assert.equal(message(), "", "안내도 없다");
});

test("nudgeClip: 이어서 눌러도 실행 취소는 한 번", () => {
  const before = history.depth().undo;
  for (let i = 0; i < 4; i += 1) actions.nudgeClip("c", 1);
  near(clipById("c").startTime, 7, "네 칸");
  assert.equal(history.depth().undo, before + 1);
  actions.undo();
  near(clipById("c").startTime, 6, "한 번에 원래 자리");
});

// ───── 길이(Shift+←·→) ─────

test("resizeClip: 끝점을 격자 한 칸씩 늘리고 줄이며, 길이를 알린다", () => {
  assert.equal(actions.resizeClip("a", 1), true);
  near(clipById("a").duration, 2.25, "늘리기");
  assert.equal(message(), ko.announce.clipLength("a", "2.25초"));
  actions.resizeClip("a", -1);
  actions.resizeClip("a", -1);
  near(clipById("a").duration, 1.75, "줄이기");
  near(clipById("a").startTime, 0, "시작 자리는 그대로");
  near(clipById("a").offset, 0, "음원 안 시작 위치도 그대로");
});

test("resizeClip: 음원이 끝나는 곳과 최소 길이를 넘지 않고, 더 바꿀 수 없다고 알린다", () => {
  store().updateClip("a", { offset: 8, duration: 2 });
  assert.equal(actions.resizeClip("a", 1), false, "음원 끝(10초)까지 이미 썼다");
  near(clipById("a").duration, 2, "그대로");
  assert.equal(message(), ko.announce.clipLengthLimit("a", "2.00초"));

  store().updateClip("b", { duration: 0.2 });
  assert.equal(actions.resizeClip("b", -1), true, "0.2초 → 최소 길이");
  near(clipById("b").duration, 0.05, "최소 0.05초");
  assert.equal(actions.resizeClip("b", -1), false, "더 줄일 수 없다");
});

test("resizeClip: 템포 맞춤(배속)이 켜진 클립은 화면 길이로 격자에 맞추고 음원 길이로 환산한다", () => {
  // 원본 60 BPM, 프로젝트 120 BPM → 2배속: 음원 4초가 화면에서는 2초
  store().updateClip("a", { stretchMode: "resample", sourceBpm: 60, duration: 4 });
  actions.resizeClip("a", 1);
  near(clipById("a").duration, 4.5, "화면 2.25초 = 음원 4.5초");
  assert.equal(message(), ko.announce.clipLength("a", "2.25초"), "알림은 화면 길이");
});

test("resizeClip: 이 클립 하나만 바뀌고, 이어서 눌러도 실행 취소는 한 번", () => {
  store().setSelectedClips(["a", "b"]);
  const before = history.depth().undo;
  actions.resizeClip("a", 1);
  actions.resizeClip("a", 1);
  near(clipById("a").duration, 2.5, "a");
  near(clipById("b").duration, 2, "선택된 b는 그대로");
  assert.equal(history.depth().undo, before + 1);
});

// ───── 고르기(Enter) ─────

test("selectClipFromKeyboard: 고르고, 더하기 키와 함께 누르면 더하거나 뺀다. 결과를 알린다", () => {
  actions.selectClipFromKeyboard("a", false);
  assert.deepEqual(store().selectedClipIds, ["a"]);
  assert.equal(message(), ko.announce.clipSelected("a"));
  actions.selectClipFromKeyboard("b", true);
  assert.deepEqual(store().selectedClipIds, ["a", "b"]);
  actions.selectClipFromKeyboard("b", true);
  assert.deepEqual(store().selectedClipIds, ["a"]);
  assert.equal(message(), ko.announce.clipDeselected("b"));
});

// ───── 화면 낭독기 안내 ─────

test("announce: 같은 문구가 이어져도 번호가 올라 다시 읽힌다", () => {
  announce("재생 중");
  const first = useAnnounceStore.getState().seq;
  announce("재생 중");
  assert.equal(message(), "재생 중");
  assert.equal(useAnnounceStore.getState().seq, first + 1);
});

test("transportAnnouncement: 재생·정지는 한 번씩, 녹음 단계는 녹음 문구만 읽는다", () => {
  const idle = { playing: false, recording: "idle" };
  assert.equal(transportAnnouncement(idle, { playing: true, recording: "idle" }), "재생 중");
  assert.equal(transportAnnouncement({ playing: true, recording: "idle" }, idle), "재생 멈춤");
  assert.equal(transportAnnouncement(idle, idle), undefined, "바뀐 것이 없으면 읽지 않는다");

  assert.equal(transportAnnouncement(idle, { playing: false, recording: "preparing" }), undefined, "준비 중은 읽지 않는다");
  assert.equal(transportAnnouncement({ playing: false, recording: "preparing" }, { playing: false, recording: "counting-in" }), "녹음 준비, 카운트인");
  assert.equal(transportAnnouncement({ playing: false, recording: "counting-in" }, { playing: true, recording: "recording" }), "녹음 중", "녹음이 시작되며 재생도 켜져도 녹음만 읽는다");
  assert.equal(transportAnnouncement({ playing: true, recording: "recording" }, { playing: true, recording: "stopping" }), undefined, "마무리 중은 읽지 않는다");
  assert.equal(transportAnnouncement({ playing: true, recording: "stopping" }, { playing: false, recording: "idle" }), "녹음 멈춤", "끝나며 재생도 꺼져도 녹음만 읽는다");
  assert.equal(transportAnnouncement({ playing: false, recording: "preparing" }, idle), undefined, "준비 중 실패(오류 안내가 따로 있다)는 '멈춤'을 읽지 않는다");
  assert.equal(transportAnnouncement({ playing: false, recording: "recording" }, { playing: true, recording: "recording" }), undefined, "녹음 중 재생만 바뀐 것은 읽지 않는다");
});

test("시간을 말로 읽는 형태: 1분 미만은 초만, 1분 넘으면 분과 초", () => {
  assert.equal(ko.announce.spokenTime(2.5), "2.50초");
  assert.equal(ko.announce.spokenTime(75.125), "1분 15.13초");
  assert.equal(ko.announce.spokenTime(-3), "0.00초", "음수는 0으로");
});
