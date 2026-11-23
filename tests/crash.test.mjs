import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { buildCrashReport } from "../src/app/crashReport.ts";
import { installGlobalErrorHandlers, isIgnorableWindowError } from "../src/app/globalErrors.ts";
import { consumeSkipRecover, markSkipRecoverOnce } from "../src/app/recoverFlag.ts";
import { useNoticeStore } from "../src/state/noticeStore.ts";

const base = {
  buildCommit: "abc1234",
  buildTime: "2026-11-23T02:00:00.000Z",
  now: new Date("2026-11-23T03:00:00.000Z"),
  userAgent: "TestBrowser/1.0",
  page: "https://example.test/",
};

test("오류 내용에 빌드·시각·주소·브라우저·오류 이름과 문장·호출 순서가 들어간다", () => {
  const error = new TypeError("값이 없습니다");
  error.stack = "TypeError: 값이 없습니다\n    at render (app.js:1:1)";
  const report = buildCrashReport({ ...base, error, componentStack: "\n    at Timeline\n    at App\n" });
  assert.match(report, /^반주 디자이너 2 오류 내용\n빌드: abc1234 \(2026-11-23T02:00:00.000Z\)\n시각: 2026-11-23T03:00:00.000Z\n주소: https:\/\/example.test\/\n브라우저: TestBrowser\/1.0/);
  assert.match(report, /오류: TypeError: 값이 없습니다/);
  assert.match(report, /호출 순서:\nTypeError: 값이 없습니다\n    at render/);
  assert.match(report, /화면 부품 위치:\nat Timeline\n    at App$/);
});

test("Error가 아닌 값이 던져져도 깨지지 않고, 아주 긴 호출 순서는 잘라 낸다", () => {
  assert.match(buildCrashReport({ ...base, error: "문자열 오류" }), /오류: Error: 문자열 오류/);
  assert.match(buildCrashReport({ ...base, error: null }), /오류: Error: null/);
  assert.match(buildCrashReport({ ...base, error: { name: "CustomError", message: "객체 오류" } }), /오류: CustomError: 객체 오류/);
  const long = new Error("긴 스택");
  long.stack = "x".repeat(10_000);
  const report = buildCrashReport({ ...base, error: long });
  assert.ok(report.length < 5000, `길이 ${report.length}`);
  assert.match(report, /\(이하 생략\)/);
});

test("보고서에 프로젝트 내용이나 주소의 쿼리는 들어가지 않는다", () => {
  const report = buildCrashReport({ ...base, error: new Error("x"), page: "https://example.test/" });
  assert.doesNotMatch(report, /\?/);
});

test("확장 프로그램·다른 출처의 'Script error.'와 ResizeObserver 경고는 알리지 않고, 진짜 오류는 알린다", () => {
  assert.equal(isIgnorableWindowError("Script error.", null, ""), true);
  assert.equal(isIgnorableWindowError("ResizeObserver loop completed with undelivered notifications.", null, ""), true);
  assert.equal(isIgnorableWindowError("ResizeObserver loop limit exceeded", new Error("x"), "app.js"), true);
  assert.equal(isIgnorableWindowError("Uncaught TypeError: x is undefined", new TypeError("x is undefined"), "app.js"), false);
  assert.equal(isIgnorableWindowError("Uncaught Error", undefined, "https://example.test/assets/app.js"), false);
});

function fakeWindow() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type, handler) => handlers.get(type) === handler && handlers.delete(type),
  };
}

beforeEach(() => useNoticeStore.getState().reset());

test("잡히지 않은 오류와 처리되지 않은 약속 거절이 오류 안내로 간다(원문은 자세히 보기에만)", () => {
  const target = fakeWindow();
  const off = installGlobalErrorHandlers(target);
  target.handlers.get("error")({ message: "Uncaught Error: boom", error: new Error("boom"), filename: "app.js" });
  const [first] = useNoticeStore.getState().notices;
  assert.equal(first.level, "error");
  assert.equal(first.message, "동작 실패: 예상하지 못한 문제가 생겼습니다.");
  assert.equal(first.detail, "boom");
  target.handlers.get("unhandledrejection")({ reason: new Error("rejected") });
  const [merged] = useNoticeStore.getState().notices;
  assert.equal(merged.count, 2); // 같은 문장이 연달아 오면 ×2
  assert.equal(merged.detail, "rejected"); // 자세히 보기에는 가장 최근 원문
  assert.equal(useNoticeStore.getState().notices.length, 1);
  off();
  assert.equal(target.handlers.size, 0);
});

test("무시할 오류는 안내를 만들지 않는다", () => {
  const target = fakeWindow();
  installGlobalErrorHandlers(target);
  target.handlers.get("error")({ message: "ResizeObserver loop completed with undelivered notifications.", error: null, filename: "" });
  assert.equal(useNoticeStore.getState().notices.length, 0);
});

function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
}

test("복구 건너뛰기 표시는 한 번만 쓰이고, 표시가 없으면 건너뛰지 않는다", () => {
  const storage = fakeStorage();
  assert.equal(consumeSkipRecover(storage), false);
  markSkipRecoverOnce(storage);
  assert.equal(consumeSkipRecover(storage), true);
  assert.equal(consumeSkipRecover(storage), false);
  assert.equal(storage.data.size, 0);
});

test("저장소를 쓸 수 없어도 오류 없이 '건너뛰지 않음'으로 처리한다", () => {
  const broken = { getItem: () => { throw new Error("차단됨"); }, setItem: () => { throw new Error("차단됨"); }, removeItem: () => {} };
  assert.doesNotThrow(() => markSkipRecoverOnce(broken));
  assert.equal(consumeSkipRecover(broken), false);
  assert.equal(consumeSkipRecover(undefined), false);
});
