import { test } from "node:test";
import assert from "node:assert/strict";
import { CountInCancelledError, isCountInCancelled, toUserMessage } from "../src/services/errors.ts";
import { ko } from "../src/i18n/ko.ts";

const decode = { kind: "decode", title: "a.mp3 디코딩 실패", fileName: "a.mp3" };
const mic = { kind: "microphone", title: "녹음 시작 실패" };
const autosave = { kind: "autosave", title: "자동 저장 실패" };
const generic = { kind: "generic", title: "프로젝트 저장 실패" };
const projectFile = { kind: "projectFile", title: "프로젝트 불러오기 실패" };

const dom = (message, name) => new DOMException(message, name);

test("오디오 해독 실패: 브라우저마다 다른 영어 문장이 모두 같은 한국어 안내가 된다", () => {
  const samples = [
    dom("Unable to decode audio data", "EncodingError"),
    new Error("Unable to decode audio data"),
    dom("The buffer passed to decodeAudioData contains an unknown content type.", "EncodingError"),
    new TypeError("Failed to execute 'decodeAudioData' on 'BaseAudioContext'"),
    "Decoding failed",
    undefined,
  ];
  for (const sample of samples) {
    const { message } = toUserMessage(sample, decode);
    assert.equal(message, "'a.mp3'은(는) 오디오로 읽을 수 없습니다. mp3·wav·m4a 파일인지 확인해 주세요.");
    assert.doesNotMatch(message, /unable|decode|error/i);
  }
});

test("오디오 해독 실패: 원문은 detail에만 담긴다", () => {
  const { message, detail } = toUserMessage(dom("Unable to decode audio data", "EncodingError"), decode);
  assert.doesNotMatch(message, /unable|decode/i);
  assert.equal(detail, "EncodingError: Unable to decode audio data");
});

test("마이크 오류 세 갈래", () => {
  assert.equal(toUserMessage(dom("Permission denied", "NotAllowedError"), mic).message, ko.error.micDenied);
  assert.equal(toUserMessage(dom("Permission denied", "PermissionDeniedError"), mic).message, ko.error.micDenied);
  assert.equal(toUserMessage(dom("Requested device not found", "NotFoundError"), mic).message, ko.error.micNotFound);
  assert.equal(toUserMessage(dom("x", "OverconstrainedError"), mic).message, ko.error.micNotFound);
  assert.equal(toUserMessage(dom("Could not start audio source", "NotReadableError"), mic).message, ko.error.micBusy);
});

test("마이크 문장은 해결 방법을 담는다", () => {
  assert.match(ko.error.micDenied, /사이트 설정/);
  assert.match(ko.error.micNotFound, /입력 장치/);
  assert.match(ko.error.micBusy, /다른 프로그램/);
});

test("마이크 오류 이름은 마이크 상황에서만 풀이한다(다른 상황의 NotFoundError를 마이크로 오해하지 않는다)", () => {
  const { message } = toUserMessage(dom("A requested file or directory could not be found", "NotFoundError"), generic);
  assert.equal(message, "프로젝트 저장 실패: 예상하지 못한 문제가 생겼습니다.");
});

test("저장 공간 부족: 자동 저장이면 자동 저장 문장, 아니면 일반 문장", () => {
  assert.equal(toUserMessage(dom("quota", "QuotaExceededError"), autosave).message, ko.error.quotaAutosave);
  assert.equal(toUserMessage(dom("quota", "QuotaExceededError"), generic).message, ko.error.quota);
  assert.equal(toUserMessage({ name: "Error", code: 22, message: "x" }, autosave).message, ko.error.quotaAutosave);
});

test("이 앱이 던진 한국어 사유는 '○○ 실패: 사유'로 그대로 보이고 detail은 없다", () => {
  const result = toUserMessage(new Error("1시간 이하의 프로젝트만 WAV로 내보낼 수 있습니다."), { kind: "generic", title: "믹스 저장 실패" });
  assert.deepEqual(result, { message: "믹스 저장 실패: 1시간 이하의 프로젝트만 WAV로 내보낼 수 있습니다." });
});

test("프로젝트 파일: JSON 문법 오류와 음원 해독 오류를 풀이한다", () => {
  assert.equal(toUserMessage(new SyntaxError("Unexpected token < in JSON at position 0"), projectFile).message, ko.error.projectInvalid);
  assert.equal(toUserMessage(dom("Unable to decode audio data", "EncodingError"), projectFile).message, ko.error.projectAudio);
  // 앱이 던진 한국어 사유는 그대로
  assert.equal(
    toUserMessage(new Error("프로젝트 파일이 올바르지 않습니다."), projectFile).message,
    "프로젝트 불러오기 실패: 프로젝트 파일이 올바르지 않습니다.",
  );
});

test("알 수 없는 오류: 영어 원문을 가리고 detail에만 둔다", () => {
  const { message, detail } = toUserMessage(new RangeError("Array buffer allocation failed"), generic);
  assert.equal(message, "프로젝트 저장 실패: 예상하지 못한 문제가 생겼습니다.");
  assert.equal(detail, "RangeError: Array buffer allocation failed");
});

test("문자열·null·객체처럼 Error가 아닌 값도 깨지지 않는다", () => {
  assert.equal(toUserMessage("boom", generic).detail, "boom");
  assert.equal(toUserMessage(null, generic).message, "프로젝트 저장 실패: 예상하지 못한 문제가 생겼습니다.");
  assert.equal(toUserMessage(null, generic).detail, undefined);
  assert.equal(toUserMessage({ message: "plain object" }, generic).detail, "plain object");
});

test("사용자에게 보이는 모든 오류 문구에는 영어 단어가 없다", () => {
  const candidates = [
    ko.error.unexpected, ko.error.decode("a.mp3"), ko.error.micDenied, ko.error.micNotFound, ko.error.micBusy,
    ko.error.quota, ko.error.quotaAutosave, ko.error.projectInvalid, ko.error.projectAudio, ko.error.detailSummary,
  ];
  for (const text of candidates) {
    const english = text.replace(/\.json|mp3|wav|m4a/g, "").match(/[A-Za-z]{3,}/g);
    assert.equal(english, null, `영어 단어가 있음: ${text}`);
  }
});

test("카운트인 취소 신호는 별도 클래스로 구분한다", () => {
  assert.equal(isCountInCancelled(new CountInCancelledError()), true);
  assert.equal(isCountInCancelled(new Error("count-in cancelled")), false);
});
