/**
 * P5-1 실행 취소 엔진(immer 패치): 단계 묶음, 패치 크기, 안전장치, 되돌리기·다시 하기의 정확성.
 * 설계서 수용 기준:
 *  - 클립 100개 문서에서 볼륨 변경 200단계를 쌓아도 패치 크기 합 5MB 미만
 *  - 바뀐 것 없는 편집은 0단계
 *  - pointerup 없이 2초가 지나면 묶음이 끝나 다음 편집은 새 단계
 */
import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeContext } from "./helpers/fake-audio.mjs";

globalThis.window = { AudioContext: FakeContext };

const { applyPatches, enablePatches } = await import("immer");
enablePatches();
const { projectStore, getDoc } = await import("../src/state/projectStore.ts");
const { createHistory, history, COALESCE_MS, GESTURE_TIMEOUT_MS, HISTORY_LIMIT } = await import("../src/state/history.ts");
const { compactReplacePatches } = await import("../src/state/patches.ts");
const { installGestureGuards } = await import("../src/state/gestureGuards.ts");
const { editKey } = await import("../src/state/commands/editKey.ts");
const commands = await import("../src/state/commands/index.ts");
const { createDefaultTrack, createEmptyDoc } = await import("../src/domain/project/defaults.ts");

/** 트랙 trackCount개 × 클립 clipCount개 문서 */
function bigDoc(trackCount = 2, clipCount = 50) {
  const tracks = Array.from({ length: trackCount }, (_, t) => {
    const track = createDefaultTrack(t + 1);
    track.clips = Array.from({ length: clipCount }, (_, c) => ({
      id: `clip-${t}-${c}`, audioBufferId: "asset", name: `클립 ${t}-${c}`, trackId: track.id,
      startTime: c * 2, offset: 0, duration: 1.5, sourceBpm: 120, stretchMode: "none",
      gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
    }));
    return track;
  });
  return { schemaVersion: 2, id: "big", name: "큰 프로젝트", bpm: 120, timeSignature: { beats: 4, unit: 4 }, sampleRate: 44100, master: { volumeDb: 0 }, tracks, assets: {}, markers: [] };
}

function resetStore(doc = createEmptyDoc()) {
  projectStore.setState({ doc });
  history.clear();
}

/** 시계를 손으로 돌리는 이력(묶는 시간 시험용) */
function clockedHistory() {
  const clock = { now: 1000 };
  const local = createHistory(projectStore, { now: () => clock.now });
  return { local, clock };
}

const volumeOf = (index, value) => (draft) => { draft.tracks[index].volume = value; };

beforeEach(() => {
  mock.timers.reset();
  resetStore();
});

// ───── 기록하지 않는 것 ─────

test("바뀐 것 없는 편집은 0단계다", () => {
  resetStore(bigDoc());
  const before = getDoc();
  const trackId = before.tracks[0].id;
  assert.equal(history.edit("아무것도 안 함", () => {}), false);
  assert.equal(commands.updateTrack(trackId, { volume: before.tracks[0].volume }), false);
  assert.equal(commands.updateClip("clip-0-3", { gain: 1 }), false);
  assert.equal(commands.setProjectName(before.name), false);
  assert.equal(commands.moveClip("clip-0-49", trackId, { startTime: 98 }), false, "맨 뒤 클립을 같은 자리로 옮기면 바뀐 것이 없다");
  assert.equal(getDoc(), before, "문서는 같은 참조");
  assert.deepEqual(history.depth(), { undo: 0, redo: 0 });
  assert.equal(history.stats().patches, 0);
});

test("누르기만 하고 움직이지 않은 끌기는 단계를 만들지 않는다", () => {
  resetStore(bigDoc());
  history.beginGesture("clip:clip-0-3:drag");
  history.endGesture();
  assert.equal(history.depth().undo, 0);
});

// ───── 패치 크기 (설계서 수용 기준) ─────

test("클립 100개 문서에서 볼륨 변경 200단계를 쌓아도 패치 크기 합이 5MB 미만이다", () => {
  resetStore(bigDoc(2, 50));
  assert.equal(getDoc().tracks.reduce((sum, track) => sum + track.clips.length, 0), 100);
  const initial = getDoc();
  const { local, clock } = clockedHistory();
  for (let step = 1; step <= 200; step += 1) {
    clock.now += COALESCE_MS + 1; // 묶이지 않게
    local.edit("트랙 변경", volumeOf(step % 2, step / 400), { key: `track:${step % 2}:volume` });
  }
  const stats = local.stats();
  assert.equal(stats.steps.undo, 200);
  assert.equal(stats.patches, 400, "단계마다 다시 할 패치 1개 + 되돌릴 패치 1개");
  assert.ok(stats.bytes < 5 * 1024 * 1024, `패치 크기 합 ${stats.bytes}B`);
  assert.ok(stats.bytes / 200 < 1024, `단계당 ${Math.round(stats.bytes / 200)}B`);

  const final = getDoc();
  while (local.undo());
  assert.deepEqual(getDoc(), initial);
  while (local.redo());
  assert.deepEqual(getDoc(), final);
});

test("끌기 한 번에 수백 번 편집해도 패치는 2개로 줄어든다(다시 1 + 되돌리기 1)", () => {
  resetStore(bigDoc(2, 50));
  const initial = getDoc();
  const trackId = initial.tracks[0].id;
  history.beginGesture(`track:${trackId}:volume`);
  for (let i = 1; i <= 600; i += 1) commands.updateTrack(trackId, { volume: i / 1000 });
  history.endGesture();
  assert.equal(history.depth().undo, 1);
  assert.equal(history.stats().patches, 2);
  assert.ok(history.stats().bytes < 1024);

  history.undo();
  assert.deepEqual(getDoc(), initial);
  history.redo();
  assert.equal(getDoc().tracks[0].volume, 0.6);
});

test("클립 끌기: 첫 이동만 목록을 바꾸고 이후는 값만 고쳐 패치가 작게 남는다", () => {
  resetStore(bigDoc(2, 50));
  const initial = getDoc();
  const trackId = initial.tracks[0].id;
  history.beginGesture("clip:clip-0-10:drag");
  for (let i = 1; i <= 100; i += 1) commands.moveClip("clip-0-10", trackId, { startTime: 20 + i * 0.25 });
  history.endGesture();
  assert.equal(history.depth().undo, 1, "끌기 한 번 = 한 단계");
  assert.ok(history.stats().patches <= 3, `패치 ${history.stats().patches}개`);

  const dragged = getDoc();
  assert.equal(dragged.tracks[0].clips.at(-1).id, "clip-0-10", "옮긴 클립은 맨 뒤(예전과 같음)");
  assert.equal(dragged.tracks[0].clips.at(-1).startTime, 45);
  history.undo();
  assert.deepEqual(getDoc(), initial, "순서까지 처음으로");
  history.redo();
  assert.deepEqual(getDoc(), dragged);
});

test("다른 트랙으로 끌고 다녀도 한 단계이고, 되돌리면 두 트랙 모두 처음으로 돌아온다", () => {
  resetStore(bigDoc(2, 20));
  const initial = getDoc();
  const [a, b] = initial.tracks.map((track) => track.id);
  history.beginGesture("clip:clip-0-5:drag");
  commands.moveClip("clip-0-5", a, { startTime: 3 });
  commands.moveClip("clip-0-5", b, { startTime: 4 });
  commands.moveClip("clip-0-5", b, { startTime: 5 });
  commands.moveClip("clip-0-5", a, { startTime: 6 });
  commands.moveClip("clip-0-5", b, { startTime: 7 });
  history.endGesture();
  assert.equal(history.depth().undo, 1);
  const moved = getDoc();
  assert.equal(moved.tracks[1].clips.at(-1).id, "clip-0-5");
  assert.equal(moved.tracks[1].clips.at(-1).trackId, b);
  history.undo();
  assert.deepEqual(getDoc(), initial);
  history.redo();
  assert.deepEqual(getDoc(), moved);
});

// ───── 조작 묶음 ─────

test("묶음 안의 편집은 key가 달라도 한 단계다", () => {
  resetStore(bigDoc(2, 3));
  const trackId = getDoc().tracks[0].id;
  history.beginGesture("track:mix");
  commands.updateTrack(trackId, { volume: 0.4 });
  commands.updateTrack(trackId, { pan: -0.5 });
  commands.updateClip("clip-0-1", { gain: 0.5 });
  history.endGesture();
  assert.equal(history.depth().undo, 1);
  history.undo();
  assert.equal(getDoc().tracks[0].pan, 0);
  assert.equal(getDoc().tracks[0].clips[1].gain, 1);
});

test("새 묶음은 이전 묶음의 단계에 이어 붙지 않는다(같은 key여도 별개의 끌기)", () => {
  resetStore(bigDoc(1, 1));
  const trackId = getDoc().tracks[0].id;
  const drag = (to) => {
    history.beginGesture(`track:${trackId}:volume`);
    commands.updateTrack(trackId, { volume: to });
    history.endGesture();
  };
  drag(0.2);
  drag(0.4);
  drag(0.6);
  assert.equal(history.depth().undo, 3);
  history.undo();
  assert.equal(getDoc().tracks[0].volume, 0.4);
  history.undo();
  assert.equal(getDoc().tracks[0].volume, 0.2);
});

test("끌기 직후의 키보드 조정은 끌기 단계에 섞이지 않는다", () => {
  resetStore(bigDoc(1, 1));
  const trackId = getDoc().tracks[0].id;
  history.beginGesture(`track:${trackId}:volume`);
  commands.updateTrack(trackId, { volume: 0.5 });
  history.endGesture();
  commands.updateTrack(trackId, { volume: 0.55 }); // 800ms 안, 같은 값이지만 끌기가 끝난 뒤
  assert.equal(history.depth().undo, 2);
});

test("2초 동안 편집이 없으면 묶음이 끝나 다음 편집은 새 단계다(pointerup을 놓친 경우)", () => {
  resetStore(bigDoc(1, 1));
  mock.timers.enable({ apis: ["setTimeout"] });
  const trackId = getDoc().tracks[0].id;
  assert.equal(GESTURE_TIMEOUT_MS, 2000);

  history.beginGesture("drag");
  commands.updateTrack(trackId, { volume: 0.2 });
  mock.timers.tick(1500);
  commands.updateTrack(trackId, { volume: 0.3 }); // 편집이 이어지면 제한 시간이 다시 시작된다
  mock.timers.tick(1500);
  assert.ok(history.openGesture(), "마지막 편집 뒤 1.5초: 아직 열려 있다");
  commands.updateTrack(trackId, { volume: 0.4 });
  assert.equal(history.depth().undo, 1);

  mock.timers.tick(GESTURE_TIMEOUT_MS);
  assert.equal(history.openGesture(), undefined, "마지막 편집 뒤 2초: 닫혔다");
  commands.updateTrack(trackId, { volume: 0.9 });
  assert.equal(history.depth().undo, 2, "다음 편집은 새 단계");

  history.undo();
  assert.equal(getDoc().tracks[0].volume, 0.4);
});

test("편집 없이 열어 둔 묶음도 2초 뒤에는 닫힌다", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  history.beginGesture("drag");
  mock.timers.tick(GESTURE_TIMEOUT_MS - 1);
  assert.ok(history.openGesture());
  mock.timers.tick(1);
  assert.equal(history.openGesture(), undefined);
});

test("묶음을 새로 열면 열려 있던 묶음은 먼저 닫힌다. endGesture(조건)은 조건이 맞을 때만 닫는다", () => {
  const first = history.beginGesture("a", "pointer");
  const second = history.beginGesture("b", "focus");
  assert.notEqual(first, second);
  assert.deepEqual(history.openGesture(), { id: second, key: "b", kind: "focus" });

  history.endGesture({ id: first });
  assert.ok(history.openGesture(), "번호가 다르면 닫지 않는다");
  history.endGesture({ kind: "pointer" });
  assert.ok(history.openGesture(), "종류가 다르면 닫지 않는다");
  history.endGesture({ kind: "focus" });
  assert.equal(history.openGesture(), undefined);
  history.endGesture();
});

test("묶음이 열린 채 실행 취소를 하면 묶음이 닫히고, 이어지는 편집은 새 단계다", () => {
  resetStore(bigDoc(1, 1));
  const trackId = getDoc().tracks[0].id;
  const start = getDoc().tracks[0].volume;
  history.beginGesture("drag");
  commands.updateTrack(trackId, { volume: 0.3 });
  assert.equal(history.undo(), true);
  assert.equal(history.openGesture(), undefined);
  assert.equal(getDoc().tracks[0].volume, start);
  commands.updateTrack(trackId, { volume: 0.6 });
  assert.equal(history.depth().undo, 1);
  assert.equal(history.canRedo(), false);
});

// ───── 키보드·연타(묶음 없이 key로 묶기) ─────

test("묶음 없이 같은 값을 이어서 고치면 한 단계(키보드 화살표 5번), 켜고 끄기는 누를 때마다 한 단계", () => {
  resetStore(bigDoc(1, 1));
  const trackId = getDoc().tracks[0].id;
  const start = getDoc().tracks[0].volume;
  for (let i = 1; i <= 5; i += 1) commands.updateTrack(trackId, { volume: Math.round((start - i * 0.01) * 100) / 100 });
  assert.equal(history.depth().undo, 1);
  commands.updateTrack(trackId, { pan: 0.2 });
  assert.equal(history.depth().undo, 2, "다른 값(팬)은 새 단계");

  commands.updateTrack(trackId, { muted: true });
  commands.updateTrack(trackId, { muted: false });
  commands.updateTrack(trackId, { muted: true });
  assert.equal(history.depth().undo, 5, "켜고 끄기는 한 번마다 한 단계");

  history.undo();
  history.undo();
  history.undo();
  history.undo();
  assert.equal(getDoc().tracks[0].volume, Math.round((start - 0.05) * 100) / 100);
  history.undo();
  assert.equal(getDoc().tracks[0].volume, start, "5번 올린 것이 한 번에 돌아온다");
});

test("이펙트 노브는 안쪽 이름까지 key가 되어 서로 다른 노브가 한 단계로 묶이지 않는다", () => {
  resetStore(bigDoc(1, 1));
  const track = getDoc().tracks[0];
  commands.updateTrack(track.id, { eq: { ...track.eq, bassGain: 3 } });
  commands.updateTrack(track.id, { eq: { ...getDoc().tracks[0].eq, bassGain: 4 } });
  assert.equal(history.depth().undo, 1, "같은 노브를 이어서 고침");
  commands.updateTrack(track.id, { eq: { ...getDoc().tracks[0].eq, highGain: 2 } });
  assert.equal(history.depth().undo, 2, "다른 노브");
});

test("프로젝트 이름을 이어서 치면 한 단계, 클립 이름도 묶음 없이 이어 치면 한 단계", () => {
  resetStore(bigDoc(1, 2));
  for (const name of ["가", "가나", "가나다"]) commands.setProjectName(name);
  assert.equal(history.depth().undo, 1);
  for (const name of ["a", "ab"]) commands.updateClip("clip-0-0", { name });
  assert.equal(history.depth().undo, 2);
});

test("실행 취소·다시 실행 뒤의 편집은 그 앞 단계에 이어 붙지 않는다", () => {
  resetStore(bigDoc(1, 1));
  const { local, clock } = clockedHistory();
  const key = "track:0:volume";
  local.edit("A", volumeOf(0, 0.1), { key });
  clock.now += 10;
  local.edit("B", (draft) => { draft.tracks[0].pan = 0.5; }, { key: "track:0:pan" });
  clock.now += 10;
  local.undo(); // B를 되돌림
  clock.now += 10;
  local.edit("C", volumeOf(0, 0.2), { key }); // A와 같은 key, 800ms 안
  assert.equal(local.depth().undo, 2, "A에 이어 붙지 않고 새 단계");
  assert.equal(local.depth().redo, 0);
});

test("key가 없거나 시간이 지나면 묶지 않는다", () => {
  resetStore(bigDoc(1, 1));
  const { local, clock } = clockedHistory();
  local.edit("1", volumeOf(0, 0.1), { key: "k" });
  clock.now += COALESCE_MS - 1;
  local.edit("2", volumeOf(0, 0.2), { key: "k" });
  assert.equal(local.depth().undo, 1);
  clock.now += COALESCE_MS - 1;
  local.edit("3", volumeOf(0, 0.3), { key: "k" });
  assert.equal(local.depth().undo, 1, "마지막 입력 뒤 800ms까지 이어진다");
  clock.now += COALESCE_MS;
  local.edit("4", volumeOf(0, 0.4), { key: "k" });
  assert.equal(local.depth().undo, 2);
  local.edit("5", volumeOf(0, 0.5));
  local.edit("6", volumeOf(0, 0.6));
  assert.equal(local.depth().undo, 4, "key가 없으면 묶지 않는다");
});

test("record:false 편집은 문서만 바꾸고, 묶음 중이어도 이력에 남지 않는다", () => {
  resetStore(bigDoc(1, 1));
  const trackId = getDoc().tracks[0].id;
  history.beginGesture("drag");
  commands.updateTrack(trackId, { volume: 0.3 }, { record: false });
  history.endGesture();
  assert.equal(getDoc().tracks[0].volume, 0.3);
  assert.deepEqual(history.depth(), { undo: 0, redo: 0 });
});

test("되돌리기는 그 단계가 바꾼 곳만 되돌린다: 그 뒤에 기록 없이(record:false) 바뀐 값은 그대로 남는다", () => {
  resetStore(bigDoc(1, 1));
  const trackId = getDoc().tracks[0].id;
  const clipId = getDoc().tracks[0].clips[0].id;
  const originalVolume = getDoc().tracks[0].volume;
  commands.updateTrack(trackId, { volume: 0.3 }); // 기록되는 편집
  commands.updateClip(clipId, { sourceBpm: 98 }, { record: false }); // 기록 안 하는 편집(음원 정보 갱신처럼)
  assert.equal(history.undo(), true);
  assert.equal(getDoc().tracks[0].volume, originalVolume, "기록된 편집은 되돌아간다");
  assert.equal(getDoc().tracks[0].clips[0].sourceBpm, 98, "기록 안 한 변경은 그대로 남는다");
  assert.equal(history.redo(), true);
  assert.equal(getDoc().tracks[0].volume, 0.3);
  assert.equal(getDoc().tracks[0].clips[0].sourceBpm, 98);
});

test("이력은 200단계까지, 오래된 단계부터 버린다", () => {
  assert.equal(HISTORY_LIMIT, 200);
  resetStore();
  for (let i = 0; i < 230; i += 1) commands.addTrack();
  assert.equal(history.depth().undo, 200);
  let undone = 0;
  while (history.undo()) undone += 1;
  assert.equal(undone, 200);
  assert.equal(getDoc().tracks.length, 1 + 30, "버려진 30단계는 되돌릴 수 없다");
});

// ───── 안전장치 ─────

function fakeEnvironment() {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = new EventTarget();
  return { doc, win };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("안전장치: 문서의 pointerup·pointercancel은 끌기 묶음만 닫고, 글자 입력(초점) 묶음은 닫지 않는다", async () => {
  const { doc, win } = fakeEnvironment();
  const off = installGestureGuards(history, doc, win);

  history.beginGesture("drag", "pointer");
  doc.dispatchEvent(new Event("pointerup"));
  await tick();
  assert.equal(history.openGesture(), undefined);

  history.beginGesture("drag", "pointer");
  doc.dispatchEvent(new Event("pointercancel"));
  await tick();
  assert.equal(history.openGesture(), undefined);

  history.beginGesture("name", "focus");
  doc.dispatchEvent(new Event("pointerup"));
  await tick();
  assert.ok(history.openGesture(), "칸 안을 눌러도 입력 묶음은 이어진다");
  history.endGesture();
  off();
});

test("안전장치: 뗌과 같은 순간 새 끌기가 시작되면 새 끌기는 닫지 않는다", async () => {
  const { doc, win } = fakeEnvironment();
  const off = installGestureGuards(history, doc, win);
  history.beginGesture("first");
  doc.dispatchEvent(new Event("pointerup"));
  const second = history.beginGesture("second"); // 한 박자 사이에 시작
  await tick();
  assert.deepEqual(history.openGesture(), { id: second, key: "second", kind: "pointer" });
  history.endGesture();
  off();
});

test("안전장치: 뗀 순간에 일어나는 마지막 편집도 같은 단계에 들어간다(한 박자 뒤에 닫는다)", async () => {
  resetStore(bigDoc(1, 1));
  const trackId = getDoc().tracks[0].id;
  const { doc, win } = fakeEnvironment();
  const off = installGestureGuards(history, doc, win);
  history.beginGesture("drag");
  commands.updateTrack(trackId, { volume: 0.4 });
  doc.dispatchEvent(new Event("pointerup"));
  commands.updateTrack(trackId, { volume: 0.45 }); // 같은 뗌을 받는 다른 부품이 하는 마지막 편집
  await tick();
  assert.equal(history.depth().undo, 1);
  off();
});

test("안전장치: 창 blur와 탭 숨김은 모든 묶음을 닫고, 거두면 더는 닫지 않는다", async () => {
  const { doc, win } = fakeEnvironment();
  const off = installGestureGuards(history, doc, win);

  history.beginGesture("name", "focus");
  win.dispatchEvent(new Event("blur"));
  assert.equal(history.openGesture(), undefined);

  history.beginGesture("drag");
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.ok(history.openGesture(), "보이는 상태로 바뀐 것은 무시");
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(history.openGesture(), undefined);

  off();
  history.beginGesture("drag");
  doc.dispatchEvent(new Event("pointerup"));
  win.dispatchEvent(new Event("blur"));
  await tick();
  assert.ok(history.openGesture(), "거둔 뒤에는 닫지 않는다");
  history.endGesture();
});

// ───── 돌려놓기가 정확한가 ─────

test("되돌릴 수 없는 모양으로 어긋난 이력은 잘못된 문서를 만들지 않고 비워진다", () => {
  resetStore(bigDoc(2, 3));
  const errors = mock.method(console, "error", () => {});
  commands.updateClip("clip-1-2", { gain: 0.2 }, { key: undefined });
  // 이력에 없는 방법으로 문서 모양이 바뀜(트랙이 사라짐)
  projectStore.setState({ doc: { ...getDoc(), tracks: [getDoc().tracks[0]] } });
  const broken = getDoc();
  assert.equal(history.undo(), false);
  assert.equal(getDoc(), broken, "문서는 건드리지 않는다");
  assert.deepEqual(history.depth(), { undo: 0, redo: 0 });
  assert.equal(errors.mock.callCount(), 1);
  errors.mock.restore();
});

/** 같은 순서로 같은 값을 뽑는 난수(시험을 다시 돌려도 같은 길을 가도록) */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("여러 종류의 편집을 섞어 쌓은 뒤 모두 되돌리면 처음 문서, 모두 다시 하면 마지막 문서와 같다", () => {
  for (const seed of [1, 7, 42]) {
    resetStore(bigDoc(3, 12));
    const random = seeded(seed);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const initial = getDoc();
    let counter = 0;

    for (let step = 0; step < 160; step += 1) {
      const doc = getDoc();
      const tracks = doc.tracks;
      const allClips = tracks.flatMap((track) => track.clips);
      const grouped = random() < 0.25;
      if (grouped) history.beginGesture(`seed-${step}`);
      const op = Math.floor(random() * 14);
      if (op === 0) commands.addTrack();
      else if (op === 1 && tracks.length > 1) commands.removeTrack(pick(tracks).id);
      else if (op === 2) commands.reorderTrack(pick(tracks).id, random() < 0.5 ? -1 : 1);
      else if (op === 3) commands.updateTrack(pick(tracks).id, { volume: Math.round(random() * 100) / 100 });
      else if (op === 4) commands.updateTrack(pick(tracks).id, { muted: random() < 0.5 });
      else if (op === 5) commands.updateTrack(pick(tracks).id, { name: `트랙 ${counter += 1}` });
      else if (op === 6 && allClips.length) commands.moveClip(pick(allClips).id, pick(tracks).id, { startTime: Math.round(random() * 400) / 4 });
      else if (op === 7 && allClips.length) commands.updateClip(pick(allClips).id, { gain: Math.round(random() * 100) / 100, fadeIn: Math.round(random() * 10) / 10 });
      else if (op === 8 && allClips.length > 3) commands.deleteClips([pick(allClips).id, pick(allClips).id]);
      else if (op === 9 && allClips.length) commands.sliceClipAt(pick(allClips).id, 0.5 + random());
      else if (op === 10 && allClips.length) commands.toggleClipMuted(pick(allClips).id);
      else if (op === 11 && allClips.length) commands.quantizeClips(allClips.slice(0, 5).map((clip) => clip.id), 4);
      else if (op === 12) commands.setBpm(60 + Math.floor(random() * 120));
      else if (op === 13 && allClips.length) commands.groupClips(allClips.slice(0, 3).map((clip) => clip.id), `group-${step}`);
      if (grouped) history.endGesture();
    }

    const final = getDoc();
    const steps = history.depth().undo;
    assert.ok(steps > 20, `seed ${seed}: 단계 ${steps}`);
    let undone = 0;
    while (history.undo()) undone += 1;
    assert.equal(undone, steps);
    assert.deepEqual(getDoc(), initial, `seed ${seed}: 모두 되돌림`);
    let redone = 0;
    while (history.redo()) redone += 1;
    assert.equal(redone, steps);
    assert.deepEqual(getDoc(), final, `seed ${seed}: 모두 다시 함`);
  }
});

test("맨 뒤 클립을 같은 트랙에서 옮기는 빠른 길도 예전 방식(목록을 새로 만듦)과 같은 문서를 만든다", () => {
  resetStore(bigDoc(2, 6));
  const before = getDoc();
  const trackId = before.tracks[0].id;
  const last = before.tracks[0].clips.at(-1);
  commands.moveClip(last.id, trackId, { startTime: 77, gain: 0.5 });
  const after = getDoc();

  const expected = before.tracks[0].clips.map((clip) => (clip.id === last.id ? { ...last, startTime: 77, gain: 0.5, trackId } : clip));
  assert.deepEqual(after.tracks[0].clips, expected);
  assert.equal(after.tracks[0].clips[0], before.tracks[0].clips[0], "다른 클립은 같은 참조");
  assert.equal(after.tracks[1], before.tracks[1], "다른 트랙은 같은 참조");

  // 맨 뒤가 아닌 클립은 맨 뒤로 가고, 다른 트랙으로 가면 대상 트랙의 맨 뒤에 놓인다
  const middle = after.tracks[0].clips[2];
  commands.moveClip(middle.id, trackId, { startTime: 1 });
  assert.equal(getDoc().tracks[0].clips.at(-1).id, middle.id);
  const otherId = after.tracks[1].id;
  commands.moveClip(middle.id, otherId, { startTime: 2 });
  assert.equal(getDoc().tracks[1].clips.at(-1).id, middle.id);
  assert.equal(getDoc().tracks[1].clips.at(-1).trackId, otherId);
  assert.equal(getDoc().tracks[0].clips.some((clip) => clip.id === middle.id), false);
});

// ───── 패치 줄이기(patches.ts) ─────

const replace = (path, value) => ({ op: "replace", path, value });

test("compactReplacePatches: 같은 자리를 나중에 다시 바꾼 앞선 패치를 버린다", () => {
  const out = compactReplacePatches([
    replace(["a", "x"], 1),
    replace(["b"], 5),
    replace(["a", "x"], 2),
    replace(["a", "x"], 3),
  ]);
  assert.deepEqual(out, [replace(["b"], 5), replace(["a", "x"], 3)]);
});

test("compactReplacePatches: 윗자리를 나중에 통째로 바꾸면 그 안쪽의 앞선 패치도 버린다. 안쪽을 나중에 바꾼 것은 남긴다", () => {
  assert.deepEqual(
    compactReplacePatches([replace(["a", "x"], 1), replace(["a", "y"], 2), replace(["a"], { x: 9, y: 9 })]),
    [replace(["a"], { x: 9, y: 9 })],
  );
  assert.equal(
    compactReplacePatches([replace(["a"], { x: 9, y: 9 }), replace(["a", "x"], 1)]),
    undefined,
    "통째로 바꾼 뒤 안쪽을 고친 것은 둘 다 필요하다",
  );
  assert.deepEqual(
    compactReplacePatches([replace(["a"], { x: 1, y: 1 }), replace(["a", "x"], 2), replace(["a", "x"], 3)]),
    [replace(["a"], { x: 1, y: 1 }), replace(["a", "x"], 3)],
  );
});

test("compactReplacePatches: add·remove가 섞였거나 줄일 것이 없으면 undefined", () => {
  assert.equal(compactReplacePatches([replace(["a"], 1), { op: "add", path: ["b", 0], value: 1 }, replace(["a"], 2)]), undefined);
  assert.equal(compactReplacePatches([replace(["a"], 1), { op: "remove", path: ["b", 0] }]), undefined);
  assert.equal(compactReplacePatches([replace(["a"], 1), replace(["b"], 2)]), undefined);
  assert.equal(compactReplacePatches([replace(["a"], 1)]), undefined);
  assert.equal(compactReplacePatches([]), undefined);
});

test("compactReplacePatches: 어떤 순서로 섞여도 줄인 패치를 적용한 문서는 원래 패치를 적용한 문서와 같다", () => {
  const base = { a: { x: 1, y: 2 }, b: [10, { z: 3 }], c: "k" };
  const random = seeded(2024);
  const valueFor = (path) => {
    const r = Math.floor(random() * 1000);
    const key = path.join("/");
    if (key === "a") return { x: r, y: r + 1 };
    if (key === "b") return [r, { z: r + 2 }];
    if (key === "b/1") return { z: r };
    return r;
  };
  const candidates = [["a"], ["a", "x"], ["a", "y"], ["b"], ["b", 0], ["b", 1], ["b", 1, "z"], ["c"]];
  let compacted = 0;
  for (let round = 0; round < 400; round += 1) {
    const length = 2 + Math.floor(random() * 18);
    const patches = Array.from({ length }, () => {
      const path = candidates[Math.floor(random() * candidates.length)];
      return replace(path, valueFor(path));
    });
    const reduced = compactReplacePatches(patches);
    const expected = applyPatches(base, patches);
    const actual = applyPatches(base, reduced ?? patches);
    assert.deepEqual(actual, expected, `round ${round}`);
    if (reduced) {
      compacted += 1;
      assert.ok(reduced.length < patches.length);
    }
  }
  assert.ok(compacted > 300, `줄어든 경우 ${compacted}/400`);
});

// ───── 묶음 key ─────

test("editKey: 숫자만 바뀔 때만 key가 생긴다", () => {
  const track = createDefaultTrack(1);
  assert.equal(editKey("track:t1", track, { volume: 0.5 }), "track:t1:volume");
  assert.equal(editKey("track:t1", track, { volume: 0.5, pan: 0.2 }), "track:t1:pan,volume");
  assert.equal(editKey("track:t1", track, { volume: track.volume }), undefined, "바뀐 것이 없다");
  assert.equal(editKey("track:t1", track, { muted: true }), undefined, "켜고 끄기는 묶지 않는다");
  assert.equal(editKey("track:t1", track, { volume: 0.5, muted: true }), undefined);
  assert.equal(editKey("track:t1", track, { volume: Number.NaN }), undefined);
  assert.equal(editKey("track:t1", track, { name: "새 이름" }), "track:t1:name");
  assert.equal(editKey("clip:c1", { fadeCurve: "linear" }, { fadeCurve: "log" }), undefined, "고르는 값은 묶지 않는다");
});

test("editKey: 이펙트 설정은 안쪽 이름까지 key에 넣고, 켜고 끄기·고르기가 섞이면 key가 없다", () => {
  const track = createDefaultTrack(1);
  assert.equal(editKey("track:t1", track, { eq: { ...track.eq, bassGain: 4 } }), "track:t1:eq.bassGain");
  assert.equal(editKey("track:t1", track, { eq: { ...track.eq, bassGain: 4, highGain: 1 } }), "track:t1:eq.bassGain,eq.highGain");
  assert.equal(editKey("track:t1", track, { eq: { ...track.eq, enabled: false } }), undefined);
  assert.equal(editKey("track:t1", track, { reverb: { ...track.reverb, mode: "hall" } }), undefined, "방식을 고르는 값");
  assert.equal(editKey("track:t1", track, { eq: { ...track.eq } }), undefined, "안쪽이 그대로");
  const same = { eq: track.eq };
  assert.equal(editKey("track:t1", track, same), undefined);
});

// ───── 연결이 새 엔진을 쓰는지(구조) ─────

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("구조: 끌기는 묶음(beginGesture)으로 연결되고 옛 방식(captureHistory·history:false)은 남지 않는다", () => {
  const clipView = read("src/components/ClipView.tsx");
  const timeline = read("src/components/Timeline.tsx");
  const store = read("src/store/useDawStore.ts");

  assert.match(clipView, /history\.beginGesture\(`clip:\$\{clip\.id\}:drag`\)/);
  assert.match(timeline, /history\.beginGesture\(`clips:\$\{mode\}`\)/);
  assert.match(timeline, /history\.beginGesture\(`track:\$\{track\.id\}:volume`\)/);
  assert.match(timeline, /history\.beginGesture\(`track:\$\{track\.id\}:name`, "focus"\)/);
  for (const [name, source] of [["ClipView", clipView], ["Timeline", timeline]]) {
    assert.doesNotMatch(source, /captureHistory|beginHistoryGroup|endHistoryGroup/, `${name}에 옛 연결이 남아 있다`);
    assert.doesNotMatch(source, /history:\s*false/, `${name}에 { history: false }가 남아 있다`);
  }
  assert.doesNotMatch(store, /captureHistory|beginHistoryGroup|endHistoryGroup/);
  assert.doesNotMatch(read("src/state/history.ts"), /capture\(/, "지금 문서를 한 단계로 남기는 capture는 없다");
});

test("구조: 앱이 켜질 때 안전장치를 걸고 끌 때 거둔다. 글자 입력 칸은 초점 묶음을 쓴다", () => {
  const bootstrap = read("src/app/bootstrap.ts");
  assert.match(bootstrap, /installGestureGuards\(history\)/);
  assert.match(bootstrap, /offGestureGuards\(\)/);
  assert.match(read("src/ui/transport/TopBar.tsx"), /useTextGesture\("project:name"\)/);
  assert.match(read("src/ui/inspector/ClipPanel.tsx"), /useTextGesture\(/);
  assert.match(read("src/ui/inspector/useHistoryGesture.ts"), /beginGesture\(key, "focus"\)/);
  for (const panel of ["TrackMixPanel", "EqPanel", "CompressorPanel", "MasterPanel", "ClipPanel"]) {
    assert.match(read(`src/ui/inspector/${panel}.tsx`), /useHistoryGesture\(/, `${panel}은 key를 넘겨 묶음 연결을 쓴다`);
  }
});
