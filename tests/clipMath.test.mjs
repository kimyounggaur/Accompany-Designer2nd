import { test } from "node:test";
import assert from "node:assert/strict";
import { planVoice } from "../src/domain/timeline/clipMath.ts";

// 오디오 시각 = 100 + 타임라인 위치 (시계가 100초에서 0을 시작했다고 가정)
const at = (position) => 100 + position;
const clip = (overrides = {}) => ({
  id: "c", audioBufferId: "a", name: "c", trackId: "t",
  startTime: 4, offset: 0, duration: 2, sourceBpm: 120, stretchMode: "none",
  gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
  ...overrides,
});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("planVoice ① 시작 전: 클립 시작 시각에 처음부터 예약하고 페이드 인은 필요 없다", () => {
  const plan = planVoice(clip(), 120, 1, 10, at);
  assert.ok(plan);
  near(plan.when, at(4));
  near(plan.offset, 0);
  near(plan.duration, 2);
  near(plan.elapsed, 0);
  assert.equal(plan.startsMidClip, false);
  near(plan.rate, 1);
  near(plan.timelineDuration, 2);
});

test("planVoice ② 중간: 지금 시각에 클립 안 그 위치부터 시작하고 시작 페이드가 필요하다", () => {
  const plan = planVoice(clip(), 120, 5, 10, at);
  assert.ok(plan);
  near(plan.when, at(5));
  near(plan.offset, 1);
  near(plan.duration, 1);
  near(plan.elapsed, 1);
  assert.equal(plan.startsMidClip, true);
});

test("planVoice ③ 끝 직전: 아주 조금 남아도 재생 계획이 나온다", () => {
  const plan = planVoice(clip(), 120, 5.99, 10, at);
  assert.ok(plan);
  near(plan.duration, 0.01);
  assert.equal(plan.startsMidClip, true);
});

test("planVoice ④ 끝 뒤: 끝 시각과 그 뒤에는 계획이 없다", () => {
  assert.equal(planVoice(clip(), 120, 6, 10, at), undefined);
  assert.equal(planVoice(clip(), 120, 9, 10, at), undefined);
});

test("planVoice ⑤ WARP 켬: 재생 배율만큼 음원을 더 빨리 읽고, 타임라인 길이는 그만큼 줄어든다", () => {
  // 원곡 100bpm 클립을 120bpm에 맞추면 배율 1.2. 음원 2.4초가 타임라인 2초가 된다.
  const warp = clip({ duration: 2.4, sourceBpm: 100, stretchMode: "resample", offset: 0.5 });
  const plan = planVoice(warp, 120, 5, 10, at);
  assert.ok(plan);
  near(plan.rate, 1.2);
  near(plan.timelineDuration, 2);
  near(plan.elapsed, 1);
  near(plan.offset, 0.5 + 1.2);
  near(plan.duration, 2.4 - 1.2);
  assert.equal(planVoice(warp, 120, 6.0, 10, at), undefined, "타임라인 끝(4+2)에서는 끝난다");
  // 템포가 바뀌면 같은 위치에서도 계획이 달라진다(WARP를 켠 클립만)
  assert.notEqual(planVoice(warp, 140, 5, 10, at).rate, plan.rate);
  assert.equal(planVoice(clip(), 140, 5, 10, at).rate, 1);
});

test("planVoice ⑥ 짧은 버퍼: 음원이 클립보다 짧으면 음원이 끝나는 곳까지만 재생한다", () => {
  const long = clip({ duration: 3 });
  const plan = planVoice(long, 120, 4, 1.5, at);
  assert.ok(plan);
  near(plan.duration, 1.5);
  // 음원이 이미 끝난 자리(offset ≥ 버퍼 길이)에서는 계획이 없다
  assert.equal(planVoice(long, 120, 5.6, 1.5, at), undefined);
});

test("planVoice ⑦ 오프셋 있음: 음원 안의 시작 위치는 클립 오프셋부터 센다", () => {
  const trimmed = clip({ offset: 0.5, duration: 2 });
  const start = planVoice(trimmed, 120, 4, 10, at);
  near(start.offset, 0.5);
  near(start.duration, 2);
  const middle = planVoice(trimmed, 120, 5, 10, at);
  near(middle.offset, 1.5);
  near(middle.duration, 1);
  // 버퍼가 오프셋 + 길이에 못 미치면 그만큼 줄어든다
  near(planVoice(trimmed, 120, 4, 2, at).duration, 1.5);
});

test("planVoice ⑧ 0길이: 길이가 0인 클립은 어디서도 계획이 없다", () => {
  assert.equal(planVoice(clip({ duration: 0 }), 120, 1, 10, at), undefined);
  assert.equal(planVoice(clip({ duration: 0 }), 120, 4, 10, at), undefined);
});

test("planVoice: 시작 시각은 '지금 위치'와 '클립 시작' 중 늦은 쪽의 오디오 시각이다", () => {
  assert.equal(planVoice(clip(), 120, 1, 10, at).when, at(4));
  assert.equal(planVoice(clip(), 120, 5, 10, at).when, at(5));
  // 시계가 어떻게 바뀌어도 그대로 따른다
  assert.equal(planVoice(clip(), 120, 5, 10, (p) => 7 + p * 2).when, 17);
});
