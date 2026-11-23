import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClip } from "./helpers/docs.mjs";
import { Param } from "./helpers/fake-audio.mjs";

const { initialClipGain, scheduleClipEnvelope } = await import("../src/audio/engine/clipEnvelope.ts");

const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} ≠ ${expected}`);

test("initialClipGain: 페이드가 없으면 클립 음량 그대로", () => {
  const clip = makeClip("t", "c", 0, { duration: 4, gain: 0.8 });
  near(initialClipGain(clip, 0, 4), 0.8);
  near(initialClipGain(clip, 2, 4), 0.8);
});

test("initialClipGain: 페이드 인 맨 앞은 0에 가까운 값(0.0001), 페이드 인이 끝난 뒤에는 음량", () => {
  const clip = makeClip("t", "c", 0, { duration: 4, gain: 1, fadeIn: 1, fadeCurve: "linear" });
  near(initialClipGain(clip, 0, 4), 0.0001);
  near(initialClipGain(clip, 0.5, 4), 0.5, "선형 페이드 인 중간");
  near(initialClipGain(clip, 1.5, 4), 1);
});

test("initialClipGain: 페이드 아웃 구간에서 시작하면 줄어든 값, 음량 0이면 0", () => {
  const clip = makeClip("t", "c", 0, { duration: 4, gain: 1, fadeOut: 1, fadeCurve: "linear" });
  near(initialClipGain(clip, 3.5, 4), 0.5);
  near(initialClipGain(makeClip("t", "c", 0, { duration: 4, gain: 0 }), 0, 4), 0);
  near(initialClipGain(makeClip("t", "c", 0, { duration: 4, gain: -1 }), 0, 4), 0, "음수 음량은 0으로 본다");
});

test("scheduleClipEnvelope: 처음 값을 먼저 맞춘 뒤 예약의 첫 값(같은 값)을 건다", () => {
  const param = new Param();
  const clip = makeClip("t", "c", 0, { duration: 4, gain: 0.8, fadeIn: 1, fadeCurve: "linear" });
  scheduleClipEnvelope(param, clip, { when: 10, elapsed: 0, duration: 4, rate: 1, timelineDuration: 4 });
  assert.deepEqual(param.assigned, [0.0001]);
  const first = param.events.find((event) => event.type === "set");
  near(first.value, param.assigned[0], "예약의 첫 값과 처음 값이 같다");
  near(first.time, 10);
});
