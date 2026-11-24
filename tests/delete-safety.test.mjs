/**
 * P5-4 삭제 안전장치: 클립을 지우면 5초짜리 [되돌리기] 안내가 뜨고, 빈 트랙은 확인창 없이 지우며(클립이 든 트랙만 확인),
 * 우클릭 메뉴의 동작(복제·자르기·음소거 전환·이름 바꾸기)이 한 번의 실행 취소로 되돌아간다.
 * 설계서 수용 기준: 클립 삭제 → 5초 안에 [되돌리기] → 복원 (e2e: e2e/report-regression.spec.ts)
 * 여기서는 화면 없이 동작 함수와 이력·안내 저장소를 직접 확인한다.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { FakeContext } from "./helpers/fake-audio.mjs";

globalThis.window = { AudioContext: FakeContext };

const actions = await import("../src/app/actions.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { useDialogStore } = await import("../src/state/dialogStore.ts");
const { useNoticeStore, noticeDuration, NOTICE_DURATION_MS, DEFAULT_STATUS_MESSAGE } = await import("../src/state/noticeStore.ts");
const { history } = await import("../src/state/history.ts");
const { notify } = await import("../src/services/notify.ts");
const { canSliceAt, SLICE_EDGE_MARGIN } = await import("../src/domain/timeline/clipMath.ts");
const { getClipTimelineDuration } = await import("../src/utils/audioMath.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function sourceFiles(dir, found = []) {
  for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
    const path = `${dir}/${name}`;
    if (statSync(new URL(`../${path}`, import.meta.url)).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(name)) found.push(path);
  }
  return found;
}

beforeEach(() => {
  useDawStore.getState().resetProject();
  history.clear();
  useNoticeStore.getState().reset();
  useDialogStore.setState({ confirm: undefined });
});

const store = () => useDawStore.getState();
const tracks = () => store().tracks;
const notices = () => useNoticeStore.getState().notices;
const lastToast = () => notices()[notices().length - 1];
const status = () => useNoticeStore.getState().statusMessage;
const clipOn = (trackId, id, startTime) => ({
  id, audioBufferId: "asset", name: id, trackId, startTime, offset: 0, duration: 2, sourceBpm: 120,
  stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
});
const allClips = () => tracks().flatMap((track) => track.clips);
const clipCount = () => allClips().length;
const clipById = (id) => allClips().find((clip) => clip.id === id);

/** 첫 트랙에 a(0초)·b(3초)·c(6초) 클립 셋을 놓는다. */
function threeClips() {
  const trackId = tracks()[0].id;
  for (const [id, at] of [["a", 0], ["b", 3], ["c", 6]]) store().addClip(trackId, clipOn(trackId, id, at));
  return trackId;
}

// ───── 이력 단계 번호 ─────

test("이력: 단계마다 새 번호가 붙고, 실행 취소·다시 실행·비우기를 따라간다", () => {
  assert.equal(history.topId(), undefined, "처음에는 단계가 없다");
  const trackId = tracks()[0].id;
  store().addClip(trackId, clipOn(trackId, "a", 0));
  const first = history.topId();
  assert.equal(typeof first, "number");
  store().addClip(trackId, clipOn(trackId, "b", 3));
  const second = history.topId();
  assert.ok(second > first, "새 편집은 새 번호");

  store().undo();
  assert.equal(history.topId(), first);
  store().redo();
  assert.equal(history.topId(), second, "다시 실행하면 같은 단계가 돌아온다");
  history.clear();
  assert.equal(history.topId(), undefined);
});

test("이력: 기록하지 않는 편집과 바뀐 것이 없는 편집은 번호를 바꾸지 않고, 이어 붙는 편집은 번호를 지킨다", () => {
  const trackId = tracks()[0].id;
  store().addClip(trackId, clipOn(trackId, "a", 0));
  const top = history.topId();

  store().updateClip("a", { name: "임시" }, { history: false });
  assert.equal(clipById("a").name, "임시", "문서는 바뀌었다");
  assert.equal(history.topId(), top, "기록하지 않은 편집");

  store().updateClip("a", { name: "임시" });
  assert.equal(history.topId(), top, "같은 값으로 고친 편집은 기록하지 않는다");

  store().updateClip("a", { gain: 0.5 });
  const volume = history.topId();
  assert.ok(volume > top);
  store().updateClip("a", { gain: 0.6 });
  assert.equal(history.topId(), volume, "같은 값을 이어서 고치면 한 단계로 묶인다");
});

// ───── 안내(토스트)의 시간과 합치기 ─────

test("안내 시간: 단계별 기본 시간, 안내가 가진 자기 시간이 우선, null은 닫을 때까지", () => {
  assert.equal(noticeDuration({ level: "success" }), NOTICE_DURATION_MS.success);
  assert.equal(noticeDuration({ level: "warning" }), 8000);
  assert.equal(noticeDuration({ level: "error" }), null);
  assert.equal(noticeDuration({ level: "success", durationMs: 5000 }), 5000);
  assert.equal(noticeDuration({ level: "success", durationMs: null }), null);
  assert.equal(noticeDuration({ level: "error", durationMs: 1200 }), 1200);
});

test("안내 합치기: 같은 문구는 횟수만 올리지만, 단추가 달린 안내는 합치지 않는다", () => {
  notify("success", "같은 문구");
  notify("success", "같은 문구");
  assert.equal(notices().length, 1);
  assert.equal(notices()[0].count, 2);

  useNoticeStore.getState().reset();
  const withAction = () => ({ label: "되돌리기", run() {} });
  notify("success", "같은 문구", { action: withAction() });
  notify("success", "같은 문구", { action: withAction() });
  assert.equal(notices().length, 2, "단추가 달린 안내 둘");

  useNoticeStore.getState().reset();
  notify("success", "같은 문구");
  notify("success", "같은 문구", { action: withAction() });
  notify("success", "같은 문구");
  assert.equal(notices().length, 3, "단추가 있는 쪽과 없는 쪽은 서로 합치지 않는다");
  assert.ok(notices().every((notice) => notice.count === 1));
});

// ───── 클립 삭제와 되돌리기 ─────

test("클립 삭제: 5초짜리 [되돌리기] 토스트가 뜨고, 누르면 그 클립이 돌아온다", () => {
  threeClips();
  actions.deleteClip("b");
  assert.equal(clipCount(), 2);

  const toast = lastToast();
  assert.equal(toast.level, "success");
  assert.equal(toast.message, "클립을 삭제했습니다.");
  assert.equal(toast.action.label, "되돌리기");
  assert.equal(actions.DELETE_UNDO_MS, 5000);
  assert.equal(noticeDuration(toast), 5000);

  toast.action.run();
  assert.equal(clipCount(), 3);
  assert.ok(clipById("b"), "지웠던 클립이 돌아왔다");
  assert.equal(status(), "실행 취소");
});

test("클립 삭제: 이미 없는 클립은 지운 일이 없으니 안내도 이력도 없다", () => {
  threeClips();
  const top = history.topId();
  actions.deleteClip("없는 클립");
  assert.equal(notices().length, 0);
  assert.equal(history.topId(), top);
  assert.equal(clipCount(), 3);
});

test("선택 삭제: 하나면 '클립을', 여럿이면 개수를 알리고, 되돌리기 한 번에 모두 돌아온다", () => {
  threeClips();
  store().setSelectedClips(["a"]);
  actions.deleteSelectedClips();
  assert.equal(lastToast().message, "클립을 삭제했습니다.");
  lastToast().action.run();
  assert.equal(clipCount(), 3);

  useNoticeStore.getState().reset();
  store().setSelectedClips(["a", "c"]);
  actions.deleteSelectedClips();
  assert.equal(clipCount(), 1);
  assert.equal(lastToast().message, "클립 2개를 삭제했습니다.");
  assert.equal(noticeDuration(lastToast()), 5000);
  lastToast().action.run();
  assert.equal(clipCount(), 3, "여러 클립도 한 단계");
  assert.ok(clipById("a") && clipById("c"));
});

test("선택 삭제: 고른 클립이 없으면 토스트 없이 상태 줄에만 알린다", () => {
  threeClips();
  store().selectClip(undefined);
  const top = history.topId();
  actions.deleteSelectedClips();
  assert.equal(notices().length, 0);
  assert.equal(status(), "선택된 클립이 없습니다.");
  assert.equal(history.topId(), top);
  assert.equal(clipCount(), 3);
});

test("되돌리기 안전장치: 그 사이에 다른 편집을 했으면 엉뚱한 편집을 되돌리지 않고 안내만 한다", () => {
  threeClips();
  actions.deleteClip("a");
  const toast = lastToast();
  store().updateClip("b", { name: "새 이름" }); // 삭제 뒤의 다른 편집
  const top = history.topId();

  toast.action.run();
  assert.equal(clipCount(), 2, "지운 클립은 지워진 채");
  assert.equal(clipById("b").name, "새 이름", "그 사이의 편집은 그대로");
  assert.equal(history.topId(), top, "이력은 건드리지 않았다");
  const warning = lastToast();
  assert.equal(warning.level, "warning");
  assert.match(warning.message, /그 사이에 다른 편집/);
  assert.match(warning.message, /Ctrl\+Z/);
});

test("연속 삭제: 토스트가 따로 남고, 맨 위 단계의 단추만 듣는다", () => {
  threeClips();
  actions.deleteClip("a");
  actions.deleteClip("b");
  assert.equal(notices().length, 2, "단추가 달린 토스트는 합쳐지지 않는다");
  const [first, second] = notices();

  first.action.run(); // 위에 b의 삭제가 있으니 거절
  assert.equal(clipCount(), 1);
  assert.equal(lastToast().level, "warning");

  second.action.run(); // b 복원
  assert.equal(clipCount(), 2);
  assert.ok(clipById("b") && !clipById("a"));

  first.action.run(); // 이제 a의 삭제가 맨 위
  assert.equal(clipCount(), 3);
  assert.ok(clipById("a"));
});

test("undoDeletion: 단계 번호가 없거나 어긋나면 되돌리지 않는다", () => {
  threeClips();
  actions.deleteClip("a");
  assert.equal(actions.undoDeletion(undefined), false);
  assert.equal(actions.undoDeletion(history.topId() + 1), false);
  assert.equal(clipCount(), 2, "아무것도 되돌리지 않았다");
  assert.equal(lastToast().level, "warning");

  assert.equal(actions.undoDeletion(history.topId()), true);
  assert.equal(clipCount(), 3);
});

test("구조: 클립을 지우는 길은 모두 actions를 거친다(어디서 지워도 되돌리기 안내가 뜬다)", () => {
  const allowed = new Set(["src/app/actions.ts", "src/store/useDawStore.ts"]);
  const offenders = sourceFiles("src").filter((path) => {
    if (allowed.has(path) || path.startsWith("src/state/")) return false;
    return /\.(deleteClip|deleteSelectedClips|deleteClips)\(/.test(read(path));
  });
  assert.deepEqual(offenders, []);
});

test("구조: 토스트는 안내가 가진 시간을 읽는다", () => {
  const source = read("src/ui/feedback/ToastRegion.tsx");
  assert.match(source, /noticeDuration\(/);
  assert.ok(!/NOTICE_DURATION_MS\[/.test(source), "단계별 시간표를 직접 읽으면 안내의 자기 시간이 무시된다");
});

// ───── 트랙 삭제 ─────

test("트랙 삭제: 빈 트랙은 확인창 없이 바로 지우고(상태 줄 안내), 실행 취소로 돌아온다", async () => {
  store().addTrack();
  const added = tracks()[tracks().length - 1];
  const total = tracks().length;
  assert.equal(added.clips.length, 0);

  const done = await actions.deleteTrack(added.id);
  assert.equal(done, true);
  assert.equal(useDialogStore.getState().confirm, undefined, "확인창이 뜨지 않았다");
  assert.equal(tracks().length, total - 1);
  assert.equal(status(), `${added.name} 트랙이 삭제되었습니다. 실행 취소로 되돌릴 수 있습니다.`);
  assert.equal(notices().length, 0, "정보는 토스트가 아니다");

  store().undo();
  assert.equal(tracks().length, total);
  assert.ok(tracks().some((track) => track.id === added.id));
});

test("트랙 삭제: 클립이 든 트랙은 확인창을 거치고, 취소하면 그대로, 확인하면 지우며 실행 취소로 돌아온다", async () => {
  while (tracks().length < 2) store().addTrack(); // 마지막 하나는 지울 수 없으니 트랙이 둘 이상이어야 한다
  const trackId = tracks()[0].id;
  store().addClip(trackId, clipOn(trackId, "a", 0));
  store().addClip(trackId, clipOn(trackId, "b", 3));
  const total = tracks().length;

  const cancelled = actions.deleteTrack(trackId);
  const request = useDialogStore.getState().confirm;
  assert.ok(request, "확인창이 열렸다");
  assert.equal(request.tone, "danger");
  assert.match(request.message, /클립 2개/);
  useDialogStore.getState().close(request.id, false);
  assert.equal(await cancelled, false);
  assert.equal(tracks().length, total, "취소하면 그대로");
  assert.equal(clipCount(), 2);
  assert.equal(notices().length, 0);

  const confirmed = actions.deleteTrack(trackId);
  const second = useDialogStore.getState().confirm;
  assert.ok(second && second.id !== request.id);
  useDialogStore.getState().close(second.id, true);
  assert.equal(await confirmed, true);
  assert.equal(tracks().length, total - 1);

  store().undo();
  assert.equal(tracks().length, total);
  assert.equal(clipCount(), 2, "트랙과 클립이 함께 돌아온다");
});

test("트랙 삭제: 마지막 하나는 지울 수 없고, 없는 트랙은 아무 일도 없다", async () => {
  while (tracks().length > 1) assert.equal(await actions.deleteTrack(tracks()[tracks().length - 1].id), true);
  useNoticeStore.getState().reset();

  assert.equal(await actions.deleteTrack(tracks()[0].id), false);
  assert.equal(status(), "트랙은 하나 이상 필요합니다.");
  assert.equal(tracks().length, 1);
  assert.equal(useDialogStore.getState().confirm, undefined, "빈 마지막 트랙이라 확인창도 없다");

  useNoticeStore.getState().reset();
  assert.equal(await actions.deleteTrack("없는 트랙"), false);
  assert.equal(status(), DEFAULT_STATUS_MESSAGE, "안내도 없다");
  assert.equal(notices().length, 0);
});

test("구조: 화면은 트랙 삭제를 actions.deleteTrack으로만 부른다(옛 확인 함수가 남지 않는다)", () => {
  assert.ok(!sourceFiles("src").some((path) => /deleteTrackWithConfirm/.test(read(path))));
  assert.match(read("src/components/Timeline.tsx"), /deleteTrack\(/);
});

// ───── 이름 바꾸기 ─────

test("이름 바꾸기: 앞뒤 공백은 지우고, 비면 바꾸지 않고 알리며, 같은 이름은 이력을 늘리지 않는다", () => {
  threeClips();
  assert.equal(actions.renameClip("a", "  새 이름  "), true);
  assert.equal(clipById("a").name, "새 이름");

  const top = history.topId();
  assert.equal(actions.renameClip("a", "   "), false);
  assert.equal(clipById("a").name, "새 이름");
  assert.equal(status(), "클립 이름은 비워 둘 수 없습니다.");
  assert.equal(history.topId(), top);

  assert.equal(actions.renameClip("a", "새 이름"), true);
  assert.equal(history.topId(), top, "바뀐 것이 없으면 기록하지 않는다");
  store().undo();
  assert.equal(clipById("a").name, "a", "한 번의 실행 취소로 원래 이름");
});

// ───── 음소거 전환 ─────

test("음소거 전환: 하나라도 소리가 나면 모두 음소거, 모두 음소거였으면 모두 해제, 호출마다 한 단계", () => {
  threeClips();
  store().toggleClipMuted("a"); // a만 음소거: 섞인 상태
  store().setSelectedClips(["a", "b", "c"]);
  const muted = () => allClips().map((clip) => [clip.id, Boolean(clip.muted)]);
  assert.deepEqual(muted(), [["a", true], ["b", false], ["c", false]]);

  actions.toggleSelectedClipsMuted();
  assert.deepEqual(muted(), [["a", true], ["b", true], ["c", true]]);
  actions.toggleSelectedClipsMuted();
  assert.deepEqual(muted(), [["a", false], ["b", false], ["c", false]]);
  actions.toggleSelectedClipsMuted();
  assert.deepEqual(muted(), [["a", true], ["b", true], ["c", true]]);

  store().undo(); // 마지막 전환만 되돌린다
  assert.deepEqual(muted(), [["a", false], ["b", false], ["c", false]]);
  store().undo();
  assert.deepEqual(muted(), [["a", true], ["b", true], ["c", true]]);
  store().undo();
  assert.deepEqual(muted(), [["a", true], ["b", false], ["c", false]], "첫 전환도 한 단계");
});

test("음소거 전환: 고른 클립이 없으면 아무 일도 없다", () => {
  threeClips();
  store().selectClip(undefined);
  const top = history.topId();
  actions.toggleSelectedClipsMuted();
  assert.equal(history.topId(), top);
  assert.ok(allClips().every((clip) => !clip.muted));
});

// ───── 복제 ─────

test("복제: 원본 바로 뒤, 같은 트랙에 '복사본'이 생기고 선택되며, 한 번의 실행 취소로 없어진다", () => {
  const trackId = threeClips();
  const original = clipById("b");
  const length = getClipTimelineDuration(store().bpm, original);

  actions.duplicateClip("b");
  assert.equal(clipCount(), 4);
  const copy = allClips().find((clip) => clip.name === "b 복사본");
  assert.ok(copy, "복사본이 생겼다");
  assert.equal(copy.trackId, trackId);
  assert.equal(copy.startTime, original.startTime + length);
  assert.deepEqual(store().selectedClipIds, [copy.id]);
  assert.equal(clipById("b").startTime, original.startTime, "원본은 그대로");
  assert.equal(status(), "클립을 복제했습니다.");

  store().undo();
  assert.equal(clipCount(), 3);
});

test("복제: 없는 클립은 아무 일도 없다", () => {
  threeClips();
  const top = history.topId();
  actions.duplicateClip("없는 클립");
  assert.equal(clipCount(), 3);
  assert.equal(history.topId(), top);
});

// ───── 재생선에서 자르기 ─────

test("재생선에서 자르기: 클립 안이면 둘로 나뉘고, 밖이면 안내만 하고 바꾸지 않는다", () => {
  threeClips(); // b: 3초부터 2초 길이(원음 길이 기준 — 아래에서 실제 길이를 읽는다)
  const clip = clipById("b");
  const length = getClipTimelineDuration(store().bpm, clip);

  store().setCursor(clip.startTime + length / 2);
  actions.sliceClipAtPlayhead("b");
  assert.equal(clipCount(), 4);
  assert.equal(status(), "클립 자르기 완료");
  assert.equal(store().selectedClipIds.length, 1, "오른쪽 조각이 선택된다");

  const top = history.topId();
  store().setCursor(100);
  actions.sliceClipAtPlayhead("c");
  assert.equal(clipCount(), 4);
  assert.equal(status(), "재생선이 이 클립 안에 있어야 자를 수 있습니다.");
  assert.equal(history.topId(), top);

  actions.sliceClipAtPlayhead("없는 클립");
  assert.equal(status(), "자를 클립을 선택하세요.");
  assert.equal(clipCount(), 4);
});

test("자를 수 있는 자리: 양쪽 끝에서 0.03초 안쪽만(클립이 어디서 시작해도 같다)", () => {
  const bpm = store().bpm;
  assert.equal(SLICE_EDGE_MARGIN, 0.03);
  for (const startTime of [0, 4]) {
    const clip = clipOn("t", "x", startTime);
    const length = getClipTimelineDuration(bpm, clip);
    const at = (local) => startTime + local;
    const label = (text) => `시작 ${startTime}초: ${text}`;

    assert.equal(canSliceAt(clip, bpm, at(length / 2)), true, label("가운데"));
    assert.equal(canSliceAt(clip, bpm, at(0)), false, label("시작점"));
    assert.equal(canSliceAt(clip, bpm, at(SLICE_EDGE_MARGIN - 0.001)), false, label("앞쪽 여백 안"));
    assert.equal(canSliceAt(clip, bpm, at(SLICE_EDGE_MARGIN + 0.001)), true, label("앞쪽 여백 바로 밖"));
    assert.equal(canSliceAt(clip, bpm, at(length - SLICE_EDGE_MARGIN + 0.001)), false, label("뒤쪽 여백 안"));
    assert.equal(canSliceAt(clip, bpm, at(length - SLICE_EDGE_MARGIN - 0.001)), true, label("뒤쪽 여백 바로 밖"));
    assert.equal(canSliceAt(clip, bpm, at(length)), false, label("끝점"));
    assert.equal(canSliceAt(clip, bpm, startTime - 1), false, label("클립 앞"));
    assert.equal(canSliceAt(clip, bpm, at(length + 5)), false, label("클립 뒤"));
  }
});
