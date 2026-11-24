/**
 * 노브의 값 계산(P5-0, 설계서 §P5-0). 끌기·키보드·더블클릭이 모두 `knobMath`에서 값을 얻으므로,
 * 노브 모양이 달라도 같은 약속으로 움직이는지를 순수한 함수로 확인한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  KNOB_DRAG_PX,
  KNOB_FINE_FACTOR,
  KNOB_PAGE_STEPS,
  clampValue,
  toNormalized,
  fromNormalized,
  decimalPlaces,
  roundTo,
  snapToStep,
  dragValue,
  keyboardValue,
} = await import("../src/ui/controls/knobMath.ts");

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} ≠ ${expected}`);

test("약속의 숫자: 위로 180px, 미세 조정 1/10, PageUp은 10칸", () => {
  assert.equal(KNOB_DRAG_PX, 180);
  assert.equal(KNOB_FINE_FACTOR, 0.1);
  assert.equal(KNOB_PAGE_STEPS, 10);
});

test("위치와 값: 직선은 비례, 범위 밖은 끝으로", () => {
  near(toNormalized(0, -12, 12), 0.5);
  near(toNormalized(-12, -12, 12), 0);
  near(toNormalized(12, -12, 12), 1);
  near(toNormalized(99, -12, 12), 1);
  near(toNormalized(-99, -12, 12), 0);
  near(fromNormalized(0.5, -12, 12), 0);
  near(fromNormalized(2, -12, 12), 12);
  near(fromNormalized(-1, -12, 12), -12);
  assert.equal(toNormalized(5, 3, 3), 0, "범위가 없으면 0");
  assert.equal(fromNormalized(0.5, 3, 3), 3);
  assert.equal(fromNormalized(Number.NaN, 0, 10), 0, "숫자가 아닌 위치는 처음");
});

test("로그 눈금: 20~2000Hz의 가운데는 200Hz, 왕복해도 같은 값", () => {
  near(fromNormalized(0.5, 20, 2000, "log"), 200);
  near(toNormalized(200, 20, 2000, "log"), 0.5);
  for (const hz of [20, 55, 440, 1234, 2000]) near(fromNormalized(toNormalized(hz, 20, 2000, "log"), 20, 2000, "log"), hz);
});

test("로그 눈금이라도 최솟값이 0 이하면 직선으로 본다", () => {
  near(fromNormalized(0.5, 0, 100, "log"), 50);
  near(toNormalized(25, -10, 90, "log"), 0.35);
});

test("값 맞추기: 0을 기준으로 step의 배수, 범위 안, 부동소수 찌꺼기 없음", () => {
  assert.equal(snapToStep(0.26, 0.5, -12, 12), 0.5);
  assert.equal(snapToStep(0.24, 0.5, -12, 12), 0);
  assert.equal(snapToStep(0.07, 0.01, 0, 1), 0.07);
  assert.equal(snapToStep(0.30000000000000004, 0.1, 0, 1), 0.3);
  assert.equal(snapToStep(12345, 100, 1000, 20000), 12300);
  assert.equal(snapToStep(0.0004, 0.01, 0.001, 1), 0.001, "최솟값에 못 미치면 최솟값(0 기준 격자라 0.001은 격자 밖이어도 끝으로 허용)");
  assert.equal(snapToStep(30, 1, 0, 20), 20);
  assert.equal(snapToStep(3.14159, undefined, 0, 10), 3.14159, "step이 없으면 범위만 맞춘다");
  assert.equal(snapToStep(Number.NaN, 0.5, -12, 12), -12);
});

test("소수 자리 수와 둥글리기", () => {
  assert.equal(decimalPlaces(0.5), 1);
  assert.equal(decimalPlaces(0.01), 2);
  assert.equal(decimalPlaces(0.001), 3);
  assert.equal(decimalPlaces(100), 0);
  assert.equal(decimalPlaces(1e-7), 7);
  assert.equal(decimalPlaces(0), 0);
  assert.equal(roundTo(0.1 + 0.2, 2), 0.3);
  assert.equal(roundTo(1 / 3, 3), 0.333);
});

test("끌기: 위로 180px이면 전체 범위, 아래로 끌면 내려간다", () => {
  const range = { min: -12, max: 12 };
  near(dragValue({ ...range, startNorm: 0.5, deltaPx: 0 }), 0);
  near(dragValue({ ...range, startNorm: 0, deltaPx: 180 }), 12);
  near(dragValue({ ...range, startNorm: 0, deltaPx: 90 }), 0);
  near(dragValue({ ...range, startNorm: 1, deltaPx: -180 }), -12);
  near(dragValue({ ...range, startNorm: 0.5, deltaPx: 9999 }), 12, "끝을 넘어도 끝");
  near(dragValue({ ...range, startNorm: 0.5, deltaPx: -9999 }), -12);
});

test("끌기: Shift는 1/10만 움직이고, step 배수로 맞춘다", () => {
  const range = { min: 0, max: 100 };
  near(dragValue({ ...range, startNorm: 0, deltaPx: 90 }), 50);
  near(dragValue({ ...range, startNorm: 0, deltaPx: 90, fine: true }), 5);
  near(dragValue({ min: -12, max: 12, step: 0.5, startNorm: 0.5, deltaPx: 10 }), 1.5, "10px = 1.333dB → 1.5");
});

test("끌기: 누른 자리에서 계산하므로 같은 거리면 몇 번을 나눠 움직여도 같은 값", () => {
  const args = { min: 0, max: 1, step: 0.01, startNorm: 0.25 };
  const direct = dragValue({ ...args, deltaPx: 63 });
  let last = 0;
  for (let px = 1; px <= 63; px += 1) last = dragValue({ ...args, deltaPx: px });
  assert.equal(last, direct);
});

test("끌기: 로그 눈금은 같은 거리가 같은 배율", () => {
  const args = { min: 20, max: 2000, curve: "log" };
  near(dragValue({ ...args, startNorm: 0, deltaPx: 90 }), 200);
  near(dragValue({ ...args, startNorm: 0, deltaPx: 180 }), 2000);
});

test("키보드: ←↓ 한 칸 내림, →↑ 한 칸 올림(이퀄라이저 0.5dB)", () => {
  const range = { min: -12, max: 12, step: 0.5 };
  assert.equal(keyboardValue({ ...range, key: "ArrowUp", value: 0 }), 0.5);
  assert.equal(keyboardValue({ ...range, key: "ArrowRight", value: 0 }), 0.5);
  assert.equal(keyboardValue({ ...range, key: "ArrowDown", value: 0 }), -0.5);
  assert.equal(keyboardValue({ ...range, key: "ArrowLeft", value: 0 }), -0.5);
  // 보고서 C12·D6: 노브를 키보드로 3번 올리면 3단계 오른다
  let value = 0;
  for (let i = 0; i < 3; i += 1) value = keyboardValue({ ...range, key: "ArrowUp", value });
  assert.equal(value, 1.5);
});

test("키보드: PageUp·PageDown은 10칸, Home·End는 최소·최대", () => {
  const range = { min: -12, max: 12, step: 0.5 };
  assert.equal(keyboardValue({ ...range, key: "PageUp", value: 0 }), 5);
  assert.equal(keyboardValue({ ...range, key: "PageDown", value: 0 }), -5);
  assert.equal(keyboardValue({ ...range, key: "Home", value: 3 }), -12);
  assert.equal(keyboardValue({ ...range, key: "End", value: 3 }), 12);
});

test("키보드: 끝에서는 더 가지 않고, step이 없으면 범위의 1/100", () => {
  const range = { min: 0, max: 1 };
  assert.equal(keyboardValue({ ...range, key: "ArrowUp", value: 1 }), 1);
  assert.equal(keyboardValue({ ...range, key: "ArrowDown", value: 0 }), 0);
  near(keyboardValue({ ...range, key: "ArrowUp", value: 0.5 }), 0.51);
  near(keyboardValue({ min: -60, max: 0, key: "ArrowDown", value: -30 }), -30.6);
  near(keyboardValue({ ...range, key: "PageUp", value: 0.5 }), 0.6);
});

test("키보드: 노브가 쓰지 않는 키는 undefined", () => {
  for (const key of ["a", "Enter", "Tab", "Escape", " ", "Shift"]) assert.equal(keyboardValue({ min: 0, max: 1, key, value: 0.5 }), undefined, key);
});

test("키보드: 로그 눈금은 위치를 1/100씩, 성긴 격자에 걸려도 멈추지 않는다", () => {
  const range = { min: 20, max: 2000, step: 10, curve: "log" };
  // 20Hz에서 위치 1/100은 약 20.9Hz → 10Hz 격자로 20Hz가 되어 그대로 → 한 칸(10Hz)을 옮긴다
  assert.equal(keyboardValue({ ...range, key: "ArrowUp", value: 20 }), 30);
  // 높은 쪽에서는 위치 1/100이 격자보다 넓어 그대로 로그 걸음
  const high = keyboardValue({ ...range, key: "ArrowUp", value: 1000 });
  assert.ok(high > 1040 && high < 1060, String(high));
  // 끝에서는 그대로
  assert.equal(keyboardValue({ ...range, key: "ArrowUp", value: 2000 }), 2000);
  assert.equal(keyboardValue({ ...range, key: "ArrowDown", value: 20 }), 20);
});

test("값이 범위 밖이어도 키보드는 범위 안의 값을 준다", () => {
  assert.equal(keyboardValue({ min: 0, max: 10, step: 1, key: "ArrowUp", value: 50 }), 10);
  assert.equal(clampValue(Number.POSITIVE_INFINITY, 0, 10), 0, "무한대는 쓸 수 없는 값이라 처음으로");
});
