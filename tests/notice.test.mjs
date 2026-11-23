import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STATUS_MESSAGE, NOTICE_DURATION_MS, useNoticeStore } from "../src/state/noticeStore.ts";
import { notify, notifyError } from "../src/services/notify.ts";
import { confirmAction } from "../src/services/confirm.ts";
import { useDialogStore } from "../src/state/dialogStore.ts";
import { fail, ok } from "../src/state/commandResult.ts";
import { useDawStore } from "../src/store/useDawStore.ts";
import { useRecordingStore } from "../src/state/recordingStore.ts";
import { history } from "../src/state/history.ts";
import * as actions from "../src/app/actions.ts";

const notices = () => useNoticeStore.getState().notices;
const status = () => useNoticeStore.getState().statusMessage;

beforeEach(() => {
  useNoticeStore.getState().reset();
  useDawStore.getState().resetProject();
  history.clear();
});

test("정보 안내는 상태 줄에만 나오고 토스트는 만들지 않는다", () => {
  notify("info", "클립 3개 선택됨");
  assert.equal(status(), "클립 3개 선택됨");
  assert.equal(notices().length, 0);
});

test("오류·경고·완료는 토스트가 되고 상태 줄에도 남는다", () => {
  notify("error", "업로드 실패");
  notify("warning", "음원 2개를 다시 연결해 주세요");
  notify("success", "저장했습니다");
  assert.deepEqual(notices().map((n) => n.level), ["error", "warning", "success"]);
  assert.equal(status(), "저장했습니다");
});

test("보이는 시간 규칙: 오류는 닫을 때까지, 경고 8초, 완료 3초", () => {
  assert.equal(NOTICE_DURATION_MS.error, null);
  assert.equal(NOTICE_DURATION_MS.warning, 8000);
  assert.equal(NOTICE_DURATION_MS.success, 3000);
});

test("같은 안내가 연달아 오면 새로 띄우지 않고 횟수만 올린다", () => {
  notify("error", "자동 저장에 실패했습니다.");
  const firstId = notices()[0].id;
  const firstStamp = notices()[0].stamp;
  notify("error", "자동 저장에 실패했습니다.");
  notify("error", "자동 저장에 실패했습니다.");
  assert.equal(notices().length, 1);
  assert.equal(notices()[0].id, firstId);
  assert.equal(notices()[0].count, 3);
  assert.ok(notices()[0].stamp > firstStamp, "닫히는 시간을 다시 재도록 stamp가 올라야 한다");
});

test("문구나 종류가 다르면 새 토스트다", () => {
  notify("error", "A 실패");
  notify("error", "B 실패");
  notify("warning", "B 실패");
  assert.equal(notices().length, 3);
});

test("토스트는 최대 5개까지만 쌓인다", () => {
  for (let i = 0; i < 8; i++) notify("success", `완료 ${i}`);
  assert.equal(notices().length, 5);
  assert.equal(notices()[0].message, "완료 3");
});

test("닫으면 그 토스트만 사라지고 상태 줄 문구는 남는다", () => {
  notify("error", "첫째");
  notify("error", "둘째");
  useNoticeStore.getState().dismiss(notices()[0].id);
  assert.deepEqual(notices().map((n) => n.message), ["둘째"]);
  assert.equal(status(), "둘째");
});

test("정보 안내가 와도 열려 있는 오류 토스트는 지워지지 않는다", () => {
  notify("error", "저장 실패");
  notify("info", "클립 삭제됨");
  assert.equal(notices().length, 1);
  assert.equal(notices()[0].message, "저장 실패");
  assert.equal(status(), "클립 삭제됨");
});

test("notifyError는 한국어 문장으로 바꿔 오류 토스트로 보내고 원문은 detail에만 둔다", () => {
  const original = new DOMException("Unable to decode audio data", "EncodingError");
  notifyError(original, { kind: "decode", title: "a.txt 디코딩 실패", fileName: "a.txt" });
  assert.equal(notices()[0].level, "error");
  assert.equal(notices()[0].message, "'a.txt'은(는) 오디오로 읽을 수 없습니다. mp3·wav·m4a 파일인지 확인해 주세요.");
  assert.equal(notices()[0].detail, "EncodingError: Unable to decode audio data");
  assert.equal(status(), notices()[0].message, "상태 줄에는 한국어 문장만 나간다");
});

test("notifyError는 이 앱이 던진 한국어 사유를 '○○ 실패: 사유'로 보인다", () => {
  notifyError(new Error("프로젝트 파일이 올바르지 않습니다."), { kind: "projectFile", title: "프로젝트 불러오기 실패" });
  assert.equal(notices()[0].message, "프로젝트 불러오기 실패: 프로젝트 파일이 올바르지 않습니다.");
  assert.equal(notices()[0].detail, undefined);
});

test("같은 오류가 이어지면 ×N으로 합치고 원문 detail은 유지한다", () => {
  const context = { kind: "generic", title: "믹스 저장 실패" };
  notifyError(new TypeError("Failed to fetch"), context);
  notifyError(new TypeError("Failed to fetch"), context);
  assert.equal(notices().length, 1);
  assert.equal(notices()[0].count, 2);
  assert.equal(notices()[0].detail, "TypeError: Failed to fetch");
});

test("notifyError의 action 단추가 토스트에 실린다", () => {
  let ran = 0;
  notifyError(new DOMException("full", "QuotaExceededError"), { kind: "autosave", title: "자동 저장 실패" }, { action: { label: "프로젝트 파일로 저장", run: () => { ran += 1; } } });
  assert.equal(notices()[0].action?.label, "프로젝트 파일로 저장");
  notices()[0].action.run();
  assert.equal(ran, 1);
});

test("초기 상태 줄 문구", () => {
  assert.equal(status(), DEFAULT_STATUS_MESSAGE);
});

test("확인창: 확인하면 true, 취소하면 false, 새 요청이 오면 앞의 것은 취소로 끝난다", async () => {
  const first = confirmAction({ title: "t", message: "m" });
  const firstRequest = useDialogStore.getState().confirm;
  assert.equal(firstRequest.confirmLabel, "확인");
  assert.equal(firstRequest.tone, "default");
  useDialogStore.getState().close(firstRequest.id, true);
  assert.equal(await first, true);
  assert.equal(useDialogStore.getState().confirm, undefined);

  const second = confirmAction({ title: "t", message: "m", tone: "danger" });
  const third = confirmAction({ title: "t2", message: "m2" });
  assert.equal(await second, false);
  const thirdRequest = useDialogStore.getState().confirm;
  useDialogStore.getState().close(thirdRequest.id, false);
  assert.equal(await third, false);
});

test("결과 도우미: ok는 자료를 싣고 fail은 이유를 싣는다", () => {
  assert.deepEqual(ok({ count: 2 }), { ok: true, count: 2 });
  assert.deepEqual(fail("empty"), { ok: false, reason: "empty" });
});

// ───── 명령 → 안내 연결(app/actions) ─────

test("되돌릴 것이 없으면 정보 안내만 하고 기록은 만들지 않는다", () => {
  actions.undo();
  assert.equal(status(), "실행 취소할 작업이 없습니다.");
  assert.equal(notices().length, 0);
  actions.redo();
  assert.equal(status(), "다시 실행할 작업이 없습니다.");
});

test("선택이 없을 때 지우기·퀀타이즈·그룹은 거절 안내를 하고 기록을 만들지 않는다", () => {
  const before = history.depth().undo;
  actions.deleteSelectedClips();
  assert.equal(status(), "선택된 클립이 없습니다.");
  actions.quantizeSelectedClips();
  assert.equal(status(), "퀀타이즈할 클립이 없습니다.");
  actions.groupSelectedClips();
  assert.equal(status(), "그룹화할 클립을 두 개 이상 선택하세요.");
  assert.equal(history.depth().undo, before);
});

test("스토어 함수는 문구 대신 결과를 돌려준다", () => {
  const store = useDawStore.getState();
  const refused = store.deleteSelectedClips();
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "none-selected");
  assert.equal(store.sliceClipAt("없는-클립", 1).reason, "not-found");
  assert.equal(store.deleteTrack(store.tracks[0].id).reason, "last-track");
  assert.equal(Object.hasOwn(useDawStore.getState(), "commandMessage"), false);
});

test("그리기: 소리 파일도 선택한 클립도 없으면 안내하고 클립을 만들지 않는다", () => {
  const trackId = useDawStore.getState().tracks[0].id;
  const created = actions.addClipFromSource(undefined, trackId, 0);
  assert.equal(created, undefined);
  assert.equal(status(), "오디오를 업로드하거나 클립을 선택한 뒤 그리세요.");
  assert.equal(useDawStore.getState().tracks[0].clips.length, 0);
});

test("도구·스냅·녹음 옵션을 바꿔도 안내하지 않는다(화면이 이미 보여 줌)", () => {
  const store = useDawStore.getState();
  notify("info", "이전 안내");
  store.setPlaylistTool("slice");
  store.setPlaylistSnap("beat");
  store.setGlobalSnap("beat");
  useRecordingStore.getState().setMetronome(true);
  useRecordingStore.getState().setCountIn(2);
  store.togglePerformanceMode();
  assert.equal(status(), "이전 안내");
  assert.equal(notices().length, 0);
});

test("녹음 대기를 켜고 끄면 정보 안내가 나온다", () => {
  const trackId = useDawStore.getState().tracks[0].id;
  actions.toggleRecordingArm(trackId);
  assert.equal(status(), "이 트랙에 녹음하도록 설정했습니다.");
  actions.toggleRecordingArm(trackId);
  assert.equal(status(), "녹음 대기 트랙을 해제했습니다.");
});

test("녹음 중에는 녹음 대기 트랙을 바꿀 수 없다는 경고 토스트가 나온다", () => {
  const trackId = useDawStore.getState().tracks[0].id;
  useRecordingStore.getState().setProgress({ status: "recording" });
  actions.toggleRecordingArm(trackId);
  assert.equal(notices()[0].level, "warning");
  assert.equal(notices()[0].message, "녹음 중에는 녹음 대기 트랙을 바꿀 수 없습니다.");
});
