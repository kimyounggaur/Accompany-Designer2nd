/**
 * P5-3 화면 갱신 루프(`services/frameLoop.ts`): 가짜 예약기로 프레임을 손으로 돌린다.
 * 설계서 수용 기준(단위 부분):
 *  - 아무것도 안 할 때 화면 갱신 요청 0회(켜지 않았거나 구독자가 없으면 요청하지 않는다)
 *  - 구독자가 몇이든 한 프레임에 요청 1회(예전: 재생선·미터·분석기가 각자 돌려 초당 약 180회)
 * (브라우저 쪽 수치 — 재생 중 초당 요청, `Timeline` 다시 그리기 0회 — 는 e2e: e2e/report-regression.spec.ts C10·P5-3)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { createFrameLoop } = await import("../src/services/frameLoop.ts");

/** `requestAnimationFrame` 흉내: 예약만 쌓아 두고 `step`으로 한 프레임씩 돌린다. */
function fakeScheduler() {
  let next = 1;
  const pending = new Map();
  const calls = { request: 0, cancel: 0 };
  return {
    pending,
    calls,
    request(callback) {
      const handle = next++;
      pending.set(handle, callback);
      calls.request++;
      return handle;
    },
    cancel(handle) {
      calls.cancel++;
      pending.delete(handle);
    },
    /** 예약된 프레임 하나를 `now` 시각으로 돌린다. 예약이 없으면 false. */
    step(now = 0) {
      const first = pending.entries().next().value;
      if (!first) return false;
      const [handle, callback] = first;
      pending.delete(handle);
      callback(now);
      return true;
    },
  };
}

/** `console.error`를 잠시 가로채 호출을 모은다. */
function captureErrors() {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  return { logged, restore: () => { console.error = original; } };
}

test("켜기 전에는 구독자가 있어도 화면 갱신을 요청하지 않는다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  let frames = 0;
  loop.onFrame(() => { frames++; });
  assert.equal(scheduler.calls.request, 0);
  assert.equal(loop.running(), false);
  assert.equal(scheduler.step(), false);
  assert.equal(frames, 0);
});

test("켜도 구독자가 없으면 요청하지 않는다. 첫 구독자가 생기면 그때 시작한다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  loop.setActive(true);
  assert.equal(scheduler.calls.request, 0);
  assert.equal(loop.running(), false);
  let frames = 0;
  loop.onFrame(() => { frames++; });
  assert.equal(scheduler.calls.request, 1);
  assert.equal(loop.running(), true);
  scheduler.step(16);
  assert.equal(frames, 1);
});

test("구독자가 셋이어도 한 프레임에 요청은 1번이고, 모두 같은 시각을 받는다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  const seen = { a: [], b: [], c: [] };
  loop.onFrame((now) => seen.a.push(now));
  loop.onFrame((now) => seen.b.push(now));
  loop.onFrame((now) => seen.c.push(now));
  loop.setActive(true);
  assert.equal(loop.size(), 3);
  const FRAMES = 60;
  for (let index = 0; index < FRAMES; index++) assert.equal(scheduler.step(index * 16.7), true);
  // 요청 = 돌린 프레임 수 + 다음 프레임 예약 1개. 구독자 수와 무관하다.
  assert.equal(scheduler.calls.request, FRAMES + 1);
  assert.equal(scheduler.pending.size, 1);
  assert.deepEqual(seen.a, seen.b);
  assert.deepEqual(seen.b, seen.c);
  assert.equal(seen.a.length, FRAMES);
  assert.equal(seen.a[3], 3 * 16.7);
});

test("구독자는 등록한 순서대로 프레임마다 한 번씩 불린다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  const order = [];
  loop.onFrame(() => order.push("첫째"));
  loop.onFrame(() => order.push("둘째"));
  loop.setActive(true);
  scheduler.step();
  scheduler.step();
  assert.deepEqual(order, ["첫째", "둘째", "첫째", "둘째"]);
});

test("마지막 구독자가 그만두면 예약해 둔 프레임을 거두고, 다시 구독하면 다시 시작한다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  loop.setActive(true);
  const offA = loop.onFrame(() => {});
  const offB = loop.onFrame(() => {});
  assert.equal(scheduler.pending.size, 1);
  offA();
  assert.equal(loop.size(), 1);
  assert.equal(loop.running(), true, "아직 구독자가 남아 있다");
  assert.equal(scheduler.calls.cancel, 0);
  offB();
  assert.equal(loop.size(), 0);
  assert.equal(loop.running(), false);
  assert.equal(scheduler.calls.cancel, 1);
  assert.equal(scheduler.pending.size, 0);
  loop.onFrame(() => {});
  assert.equal(loop.running(), true);
  assert.equal(scheduler.pending.size, 1);
});

test("그만두는 함수를 두 번 불러도 괜찮다(다른 구독자는 그대로)", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  loop.setActive(true);
  let kept = 0;
  const off = loop.onFrame(() => {});
  loop.onFrame(() => { kept++; });
  off();
  off();
  assert.equal(loop.size(), 1);
  scheduler.step();
  assert.equal(kept, 1);
});

test("같은 함수를 두 번 구독하면 두 번 불리고, 각자의 해지 함수로 따로 그만둔다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  loop.setActive(true);
  let count = 0;
  const fn = () => { count++; };
  const offFirst = loop.onFrame(fn);
  loop.onFrame(fn);
  scheduler.step();
  assert.equal(count, 2);
  offFirst();
  scheduler.step();
  assert.equal(count, 3);
});

test("끄면 예약해 둔 프레임을 거두고 구독자를 부르지 않으며, 다시 켜면 이어서 돈다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  let frames = 0;
  loop.onFrame(() => { frames++; });
  loop.setActive(true);
  scheduler.step();
  assert.equal(frames, 1);
  loop.setActive(false);
  assert.equal(loop.running(), false);
  assert.equal(scheduler.pending.size, 0);
  assert.equal(scheduler.step(), false);
  assert.equal(frames, 1);
  const requestsWhileOff = scheduler.calls.request;
  loop.setActive(false); // 두 번 꺼도 아무 일 없다
  assert.equal(scheduler.calls.request, requestsWhileOff);
  loop.setActive(true);
  assert.equal(loop.running(), true);
  scheduler.step();
  assert.equal(frames, 2);
});

test("켜는 것을 두 번 해도 예약은 하나뿐이다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  loop.onFrame(() => {});
  loop.setActive(true);
  loop.setActive(true);
  assert.equal(scheduler.calls.request, 1);
  assert.equal(scheduler.pending.size, 1);
});

test("프레임 도중 구독자가 루프를 끄면 다음 프레임은 요청하지 않는다(곡 끝에서 멈추는 경우)", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  const ran = [];
  loop.onFrame(() => { ran.push("끝 감시"); loop.setActive(false); });
  loop.onFrame(() => ran.push("그리기"));
  loop.setActive(true);
  scheduler.step();
  // 이번 프레임의 나머지 구독자는 마저 부르되, 다음 프레임은 예약하지 않는다.
  assert.deepEqual(ran, ["끝 감시", "그리기"]);
  assert.equal(loop.running(), false);
  assert.equal(scheduler.pending.size, 0);
  assert.equal(scheduler.step(), false);
});

test("프레임 도중 그만둔 구독자는 그 프레임에 더 불리지 않고, 새로 구독한 것은 다음 프레임부터 불린다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  loop.setActive(true);
  const ran = [];
  let offLate;
  loop.onFrame(() => {
    ran.push("앞");
    offLate();
    loop.onFrame(() => ran.push("새것"));
  });
  offLate = loop.onFrame(() => ran.push("뒤"));
  scheduler.step();
  assert.deepEqual(ran, ["앞"], "그만둔 '뒤'는 이 프레임에 불리지 않고, '새것'은 아직이다");
  scheduler.step();
  assert.deepEqual(ran.slice(1), ["앞", "새것"], "다음 프레임에는 앞(새것을 또 구독한다)과 새것");
});

test("구독자 하나가 오류를 내도 다른 구독자와 루프는 계속 돌고, 오류는 구독자마다 한 번만 남긴다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  loop.setActive(true);
  let healthy = 0;
  let brokenCalls = 0;
  loop.onFrame(() => { brokenCalls++; throw new Error("그리기 오류"); });
  loop.onFrame(() => { healthy++; });
  const errors = captureErrors();
  try {
    for (let index = 0; index < 5; index++) scheduler.step();
  } finally {
    errors.restore();
  }
  assert.equal(healthy, 5);
  assert.equal(brokenCalls, 5, "오류가 난 구독자도 계속 부른다");
  assert.equal(errors.logged.length, 1, "같은 구독자의 오류는 처음 한 번만 남긴다");
  assert.equal(loop.running(), true);
});

test("서로 다른 구독자의 오류는 각각 한 번씩 남긴다", () => {
  const scheduler = fakeScheduler();
  const loop = createFrameLoop(scheduler);
  loop.setActive(true);
  loop.onFrame(() => { throw new Error("하나"); });
  loop.onFrame(() => { throw new Error("둘"); });
  const errors = captureErrors();
  try {
    scheduler.step();
    scheduler.step();
  } finally {
    errors.restore();
  }
  assert.equal(errors.logged.length, 2);
});

test("앱 전체가 쓰는 루프는 브라우저의 requestAnimationFrame을 부를 때마다 전역에서 읽는다", async () => {
  const { onFrame, setLoopActive, frameLoop } = await import("../src/services/frameLoop.ts");
  const original = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  const calls = { request: 0, cancel: 0 };
  let pendingCallback;
  globalThis.requestAnimationFrame = (callback) => { calls.request++; pendingCallback = callback; return calls.request; };
  globalThis.cancelAnimationFrame = () => { calls.cancel++; pendingCallback = undefined; };
  try {
    let frames = 0;
    const off = onFrame(() => { frames++; });
    assert.equal(calls.request, 0, "켜기 전에는 요청이 없다");
    setLoopActive(true);
    assert.equal(calls.request, 1);
    pendingCallback(16);
    assert.equal(frames, 1);
    assert.equal(calls.request, 2);
    off();
    assert.equal(calls.cancel, 1);
    assert.equal(frameLoop.running(), false);
  } finally {
    setLoopActive(false);
    globalThis.requestAnimationFrame = original.request;
    globalThis.cancelAnimationFrame = original.cancel;
  }
});
