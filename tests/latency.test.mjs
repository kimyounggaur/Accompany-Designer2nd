import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LATENCY_OFFSET_DEFAULT_MS,
  LATENCY_OFFSET_MAX_MS,
  LATENCY_OFFSET_MIN_MS,
  clampLatencyOffsetMs,
  placeRecording,
  totalLatencySeconds,
} from "../src/domain/recording/latency.ts";

const near = (actual, expected, message, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} 기대 ${expected}, 실제 ${actual}`);

/**
 * 가짜 곡 시계: 오디오 시각 `startedAt`에 곡의 `from` 초에서 재생을 시작했다면
 * 오디오 시각 t에 곡 시계가 가리키는 자리는 from + (t − startedAt).
 */
const fakeClock = (from, startedAt) => (contextTime) => from + (contextTime - startedAt);

test("지연 보정 범위는 −200 ~ +200 ms, 기본값은 0이다", () => {
  assert.equal(LATENCY_OFFSET_MIN_MS, -200);
  assert.equal(LATENCY_OFFSET_MAX_MS, 200);
  assert.equal(LATENCY_OFFSET_DEFAULT_MS, 0);
});

test("보정값은 정수로 반올림하고 범위 안으로 넣으며, 숫자가 아니면 0이다", () => {
  assert.equal(clampLatencyOffsetMs(12.6), 13);
  assert.equal(clampLatencyOffsetMs(-12.4), -12);
  assert.equal(clampLatencyOffsetMs(250), 200);
  assert.equal(clampLatencyOffsetMs(-999), -200);
  assert.equal(clampLatencyOffsetMs(Number.NaN), 0);
  assert.equal(clampLatencyOffsetMs(Number.POSITIVE_INFINITY), 0, "무한대는 쓸 수 없는 값이라 기본값으로");
  assert.equal(clampLatencyOffsetMs("abc"), 0);
  assert.ok(Object.is(clampLatencyOffsetMs(-0.2), 0), "−0은 0으로");
});

test("총 지연 = 출력 + 기본 + 입력 + 사용자 보정", () => {
  const total = totalLatencySeconds({ outputLatency: 0.02, baseLatency: 0.01, inputLatency: 0.005, userOffsetMs: 10 });
  near(total, 0.045);
});

test("브라우저가 알려 주지 않았거나 이상한 지연(없음·음수·NaN)은 0으로 친다", () => {
  assert.equal(totalLatencySeconds({}), 0);
  assert.equal(totalLatencySeconds({ outputLatency: -1, baseLatency: Number.NaN, inputLatency: undefined }), 0);
  near(totalLatencySeconds({ outputLatency: 0.03, baseLatency: -0.5 }), 0.03);
});

test("사용자 보정은 음수일 수 있고(클립을 뒤로 미룬다), 범위를 넘으면 ±200 ms로 잘린다", () => {
  near(totalLatencySeconds({ userOffsetMs: -50 }), -0.05);
  near(totalLatencySeconds({ userOffsetMs: 1000 }), 0.2);
  near(totalLatencySeconds({ userOffsetMs: -1000 }), -0.2);
});

test("공식: 시작 위치 = positionAt(첫 샘플 시각) − 총 지연 (가짜 시계)", () => {
  // 오디오 시각 10.0초에 곡의 2.0초에서 재생을 시작했다. 첫 샘플은 오디오 시각 10.5초(곡 2.5초)에 받았다.
  const positionAt = fakeClock(2, 10);
  const firstSampleTime = 10.5;
  const inputs = { outputLatency: 0.02, baseLatency: 0.01, inputLatency: 0.005, userOffsetMs: 10 };
  const placement = placeRecording(positionAt(firstSampleTime), inputs);
  near(placement.startTime, 2.5 - 0.045);
  assert.equal(placement.trim, 0);
});

test("지연이 없고 보정도 0이면 첫 샘플이 곡 시계가 가리키던 자리에 그대로 놓인다", () => {
  const positionAt = fakeClock(0, 4);
  const placement = placeRecording(positionAt(4.25), {});
  assert.deepEqual(placement, { startTime: 0.25, trim: 0 });
});

test("사용자 보정 +100 ms는 클립을 0.1초 앞으로 당긴다(같은 조건에서 보정 0과의 차이)", () => {
  const positionAt = fakeClock(1, 0);
  const base = placeRecording(positionAt(3), { outputLatency: 0.04, baseLatency: 0.01 });
  const shifted = placeRecording(positionAt(3), { outputLatency: 0.04, baseLatency: 0.01, userOffsetMs: 100 });
  near(base.startTime - shifted.startTime, 0.1);
});

test("사용자 보정 −50 ms는 클립을 0.05초 뒤로 미룬다", () => {
  const placement = placeRecording(1, { userOffsetMs: -50 });
  near(placement.startTime, 1.05);
  assert.equal(placement.trim, 0);
});

test("곡의 시작(0초)보다 앞으로 가야 하면 0초에 놓고 그만큼은 녹음 앞쪽에서 잘라 낸다", () => {
  const placement = placeRecording(0.01, { outputLatency: 0.05 });
  assert.equal(placement.startTime, 0);
  near(placement.trim, 0.04);
});

test("정확히 0초에 떨어지면 자를 것이 없다", () => {
  assert.deepEqual(placeRecording(0.5, { userOffsetMs: 200 }), { startTime: 0.3, trim: 0 });
  assert.deepEqual(placeRecording(0.2, { userOffsetMs: 200 }), { startTime: 0, trim: 0 });
});

test("첫 샘플 위치가 숫자가 아니면 0초로 본다", () => {
  assert.deepEqual(placeRecording(Number.NaN, {}), { startTime: 0, trim: 0 });
  near(placeRecording(Number.NaN, { outputLatency: 0.02 }).trim, 0.02);
});

test("블루투스처럼 지연이 큰 장치(출력 180 ms)도 자동값 + 사용자 보정으로 맞출 수 있다", () => {
  const positionAt = fakeClock(0, 1);
  const firstSample = positionAt(2); // 곡 1초
  const automatic = placeRecording(firstSample, { outputLatency: 0.18, baseLatency: 0.01 });
  near(automatic.startTime, 1 - 0.19);
  // 실제로는 20 ms 더 늦다고 느끼면 +20을 넣는다.
  const tuned = placeRecording(firstSample, { outputLatency: 0.18, baseLatency: 0.01, userOffsetMs: 20 });
  near(tuned.startTime, 1 - 0.21);
});
