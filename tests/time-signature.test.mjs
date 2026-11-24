/**
 * P5-5 박자표·마디: 마디 길이 계산, 마디 스냅, 눈금자의 마디 번호, 카운트인 선택지.
 * 설계서 수용 기준(단위): 박자표 2/4·3/4·4/4·6/8이 눈금자 마디 번호·스냅·메트로놈 강박에 반영된다.
 * (메트로놈은 metronome-signature.test.mjs, 화면 흐름은 e2e/report-regression.spec.ts)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNT_IN_CLICKS_MAX,
  TIME_SIGNATURES,
  barSeconds,
  clickSeconds,
  clicksPerBar,
  countInOptions,
  effectiveCountIn,
  findTimeSignature,
  normalizeTimeSignature,
  quarterBeatsPerBar,
  sameTimeSignature,
  snapDivisionOf,
  timeSignatureLabel,
} from "../src/domain/timeline/snap.ts";
import { planRulerTicks } from "../src/domain/timeline/ruler.ts";
import { getSnapDivision, resolveSnap } from "../src/state/snap.ts";
import { snapTime } from "../src/utils/audioMath.ts";

const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≈ ${expected}`);
const sig = (beats, unit) => ({ beats, unit });

// ───────── 표기와 선택지 ─────────

test("고를 수 있는 박자표는 2/4·3/4·4/4·6/8이다", () => {
  assert.deepEqual(TIME_SIGNATURES.map(timeSignatureLabel), ["2/4", "3/4", "4/4", "6/8"]);
  assert.deepEqual(findTimeSignature("6/8"), { beats: 6, unit: 8 });
  assert.equal(findTimeSignature("5/4"), undefined, "선택지에 없는 표기는 없다");
  assert.equal(findTimeSignature(""), undefined);
  // 찾은 값을 고쳐도 표는 그대로다
  const found = findTimeSignature("3/4");
  found.beats = 9;
  assert.deepEqual(findTimeSignature("3/4"), { beats: 3, unit: 4 });
  assert.equal(sameTimeSignature(sig(3, 4), sig(3, 4)), true);
  assert.equal(sameTimeSignature(sig(3, 4), sig(6, 8)), false);
});

test("박자표 정리: 윗수는 1~32 정수, 아랫수는 4 또는 8, 숫자가 아니면 4/4", () => {
  assert.deepEqual(normalizeTimeSignature(sig(3, 4)), sig(3, 4));
  assert.deepEqual(normalizeTimeSignature(sig(0, 4)), sig(4, 4), "0은 숫자가 아닌 값처럼 4/4로(윗수 0은 없다)");
  assert.deepEqual(normalizeTimeSignature(sig(99, 4)), sig(32, 4));
  assert.deepEqual(normalizeTimeSignature(sig(-5, 4)), sig(1, 4));
  assert.deepEqual(normalizeTimeSignature(sig(2.6, 4)), sig(3, 4));
  assert.deepEqual(normalizeTimeSignature(sig(7, 16)), sig(7, 4), "아랫수는 4 또는 8만");
  assert.deepEqual(normalizeTimeSignature(sig(6, 8)), sig(6, 8));
  assert.deepEqual(normalizeTimeSignature(undefined), sig(4, 4));
  assert.deepEqual(normalizeTimeSignature({ beats: Number.NaN }), sig(4, 4));
});

// ───────── 마디 길이 ─────────

test("한 마디는 4분음표 몇 개인가: 4/4 = 4, 3/4 = 3, 2/4 = 2, 6/8 = 3(3/8 = 1.5, 7/8 = 3.5)", () => {
  assert.equal(quarterBeatsPerBar(sig(4, 4)), 4);
  assert.equal(quarterBeatsPerBar(sig(3, 4)), 3);
  assert.equal(quarterBeatsPerBar(sig(2, 4)), 2);
  assert.equal(quarterBeatsPerBar(sig(6, 8)), 3);
  assert.equal(quarterBeatsPerBar(sig(3, 8)), 1.5);
  assert.equal(quarterBeatsPerBar(sig(7, 8)), 3.5);
  assert.equal(quarterBeatsPerBar(), 4, "박자표를 주지 않으면 4/4");
});

test("한 마디의 길이(초)와 메트로놈 간격: 템포는 늘 4분음표 기준이다", () => {
  near(barSeconds(120, sig(4, 4)), 2);
  near(barSeconds(120, sig(3, 4)), 1.5);
  near(barSeconds(120, sig(2, 4)), 1);
  near(barSeconds(120, sig(6, 8)), 1.5, 1e-12);
  near(barSeconds(90, sig(4, 4)), (60 / 90) * 4);
  // 6/8은 8분음표마다 한 번(4분음표 템포의 절반 간격), 나머지는 4분음표마다
  near(clickSeconds(120, sig(4, 4)), 0.5);
  near(clickSeconds(120, sig(3, 4)), 0.5);
  near(clickSeconds(120, sig(6, 8)), 0.25);
  // 마디 길이 = 한 번의 간격 × 마디의 클릭 수
  for (const signature of TIME_SIGNATURES) near(clickSeconds(100, signature) * clicksPerBar(signature), barSeconds(100, signature), 1e-12);
  assert.equal(clicksPerBar(sig(6, 8)), 6);
  assert.equal(clicksPerBar(sig(3, 4)), 3);
});

// ───────── 스냅 ─────────

test("스냅 값 → 격자 분할: 마디는 박자표를 따르고 나머지는 박자표와 상관없다", () => {
  assert.equal(snapDivisionOf("bar", sig(4, 4)), 0.25);
  assert.equal(snapDivisionOf("bar", sig(2, 4)), 0.5);
  near(snapDivisionOf("bar", sig(3, 4)), 1 / 3, 1e-12);
  near(snapDivisionOf("bar", sig(6, 8)), 1 / 3, 1e-12);
  assert.equal(snapDivisionOf("bar"), 0.25, "박자표를 주지 않으면 4/4");
  for (const signature of TIME_SIGNATURES) {
    assert.equal(snapDivisionOf("beat", signature), 1);
    assert.equal(snapDivisionOf("halfBeat", signature), 2);
    assert.equal(snapDivisionOf("quarterBeat", signature), 4);
    assert.equal(snapDivisionOf("line", signature), 2);
  }
  assert.equal(getSnapDivision("bar", sig(3, 4)), snapDivisionOf("bar", sig(3, 4)));
  assert.equal(getSnapDivision("beat"), 1);
});

test("'메인' 스냅이 전체 스냅 '마디'를 따르면 마디 간격이 된다", () => {
  assert.equal(resolveSnap("main", "bar"), "bar");
  assert.equal(getSnapDivision(resolveSnap("main", "bar"), sig(2, 4)), 0.5);
});

test("마디 스냅: 가까운 마디 시작에 붙는다(4/4 2초, 3/4·6/8 1.5초, 2/4 1초 — 120 BPM)", () => {
  const snapAt = (seconds, signature) => snapTime(seconds, 120, true, snapDivisionOf("bar", signature));
  // 4/4: 한 마디 2초
  assert.equal(snapAt(0.9, sig(4, 4)), 0);
  assert.equal(snapAt(1.1, sig(4, 4)), 2);
  assert.equal(snapAt(2.9, sig(4, 4)), 2);
  assert.equal(snapAt(3.1, sig(4, 4)), 4);
  // 3/4와 6/8: 한 마디 1.5초 (가운데 2.25초가 갈림길)
  for (const signature of [sig(3, 4), sig(6, 8)]) {
    near(snapAt(2.2, signature), 1.5);
    near(snapAt(2.3, signature), 3);
    near(snapAt(0.7, signature), 0);
    near(snapAt(0.8, signature), 1.5);
    near(snapAt(30.1, signature), 30, 1e-9); // 20번째 마디: 곱해서 구하므로 오차가 쌓이지 않는다
  }
  // 2/4: 한 마디 1초
  near(snapAt(1.4, sig(2, 4)), 1);
  near(snapAt(1.6, sig(2, 4)), 2);
  // 스냅을 끄면 그대로
  assert.equal(snapTime(2.37, 120, false, snapDivisionOf("bar", sig(4, 4))), 2.37);
});

test("마디 스냅: 모든 마디 시작이 마디 길이의 정수배에 놓인다(템포·박자표를 바꿔도)", () => {
  for (const bpm of [60, 97.3, 120, 133.7, 200]) {
    for (const signature of TIME_SIGNATURES) {
      const bar = barSeconds(bpm, signature);
      for (const n of [0, 1, 2, 7, 33]) {
        near(snapTime(n * bar + bar * 0.2, bpm, true, snapDivisionOf("bar", signature)), n * bar, 1e-9);
        near(snapTime(n * bar + bar * 0.8, bpm, true, snapDivisionOf("bar", signature)), (n + 1) * bar, 1e-9);
      }
    }
  }
});

// ───────── 눈금자의 마디 번호 ─────────

/** 번호가 붙은 눈금의 [박 번호, 글자] */
const labelsOf = (plan) => plan.ticks.filter((tick) => tick.label).map((tick) => [tick.beat, tick.label]);

test("눈금자 마디 번호: 4/4는 4박마다, 3/4·6/8은 3박마다, 2/4는 2박마다 번호가 붙는다", () => {
  const plan = (bar) => planRulerTicks(0.5, 96, 7, undefined, bar); // 한 박 48px, 14박
  assert.deepEqual(labelsOf(plan(4)), [[0, "1"], [4, "2"], [8, "3"], [12, "4"]]);
  assert.deepEqual(labelsOf(plan(3)), [[0, "1"], [3, "2"], [6, "3"], [9, "4"], [12, "5"]]);
  assert.deepEqual(labelsOf(plan(2)), [[0, "1"], [2, "2"], [4, "3"], [6, "4"], [8, "5"], [10, "6"], [12, "7"], [14, "8"]]);
  // 6/8의 한 마디는 4분음표 3개: 3/4와 같은 자리
  assert.deepEqual(labelsOf(plan(quarterBeatsPerBar(sig(6, 8)))), labelsOf(plan(3)));
  // 눈금 자체는 언제나 박(4분음표)마다 있다
  assert.deepEqual(plan(3).ticks.map((tick) => tick.beat), Array.from({ length: 15 }, (_, i) => i));
});

test("눈금자: 마디 길이를 주지 않으면 4/4(예전 출력과 같다)", () => {
  assert.deepEqual(planRulerTicks(0.5, 96, 30), planRulerTicks(0.5, 96, 30, undefined, 4));
  assert.deepEqual(planRulerTicks(0.5, 12, 600), planRulerTicks(0.5, 12, 600, undefined, 4));
});

test("눈금자: 멀리서 봐도 마디 번호 사이가 32px 이상이고, 번호는 마디 번호다", () => {
  for (const bar of [2, 3, 4]) {
    const plan = planRulerTicks(0.5, 8, 200, undefined, bar); // 한 박 4px
    const labeled = plan.ticks.filter((tick) => tick.label);
    assert.ok(labeled.length >= 2);
    for (let i = 1; i < labeled.length; i += 1) assert.ok(labeled[i].left - labeled[i - 1].left >= 32, `${bar}박 마디: 번호 간격 ${labeled[i].left - labeled[i - 1].left}px`);
    for (const tick of labeled) assert.equal(tick.label, String(Math.round(tick.beat / bar) + 1));
    assert.equal(plan.labelEvery % bar, 0, "번호 사이는 마디의 정수배");
  }
});

test("눈금자: 3/8처럼 마디 시작이 박 위에 놓이지 않는 박자표도 마디 시작마다 번호가 붙는다", () => {
  const plan = planRulerTicks(0.5, 96, 10, undefined, 1.5); // 한 마디 1.5박 = 72px
  const labeled = labelsOf(plan);
  assert.deepEqual(labeled.slice(0, 5), [[0, "1"], [1.5, "2"], [3, "3"], [4.5, "4"], [6, "5"]]);
  for (const [beat] of labeled) assert.ok(beat <= 20 + 1e-9);
  assert.deepEqual(plan.ticks.map((tick) => tick.beat), [...plan.ticks.map((tick) => tick.beat)].sort((a, b) => a - b), "박 번호 순서");
  // 번호가 없는 눈금은 정수 박이다(박마다 있다)
  for (const tick of plan.ticks) if (!tick.label) assert.ok(Number.isInteger(tick.beat));
  assert.equal(new Set(plan.ticks.map((tick) => tick.beat)).size, plan.ticks.length, "같은 자리에 눈금이 겹치지 않는다");
});

test("눈금자: 범위를 주면 그 범위의 눈금만, 위치와 번호는 범위 없이 만든 것과 같다(마디 길이 3·1.5도)", () => {
  for (const bar of [3, 1.5]) {
    const full = planRulerTicks(0.5, 96, 200, undefined, bar);
    const range = { fromPx: 1000, toPx: 1800 };
    const part = planRulerTicks(0.5, 96, 200, range, bar);
    const expected = full.ticks.filter((tick) => tick.beat >= range.fromPx / 48 && tick.beat <= Math.floor(range.toPx / 48));
    assert.deepEqual(part.ticks, expected, `마디 ${bar}박`);
  }
});

// ───────── 카운트인 ─────────

test("카운트인 선택지: 없음·1박·2박·1마디·2마디, 마디의 박 수는 박자표를 따른다", () => {
  const view = (signature) => countInOptions(signature).map((option) => [option.value, option.unit, option.count]);
  assert.deepEqual(view(sig(4, 4)), [[0, "none", 0], [1, "beat", 1], [2, "beat", 2], [4, "bar", 1], [8, "bar", 2]]);
  assert.deepEqual(view(sig(3, 4)), [[0, "none", 0], [1, "beat", 1], [2, "beat", 2], [3, "bar", 1], [6, "bar", 2]]);
  assert.deepEqual(view(sig(6, 8)), [[0, "none", 0], [1, "beat", 1], [2, "beat", 2], [6, "bar", 1], [12, "bar", 2]]);
  // 2/4는 2박이 곧 1마디: 한 줄로 합치고 "마디"로 부른다
  assert.deepEqual(view(sig(2, 4)), [[0, "none", 0], [1, "beat", 1], [2, "bar", 1], [4, "bar", 2]]);
  assert.deepEqual(countInOptions().map((option) => option.value), [0, 1, 2, 4, 8], "박자표를 주지 않으면 4/4");
});

test("카운트인 선택지: 클릭 수가 한도(16)를 넘는 것은 뺀다", () => {
  assert.equal(COUNT_IN_CLICKS_MAX, 16);
  assert.deepEqual(countInOptions(sig(9, 4)).map((option) => option.value), [0, 1, 2, 9], "2마디(18)는 넘는다");
  assert.deepEqual(countInOptions(sig(17, 4)).map((option) => option.value), [0, 1, 2], "1마디(17)도 넘는다");
  for (const signature of [...TIME_SIGNATURES, sig(5, 4), sig(12, 8), sig(32, 4)]) {
    for (const option of countInOptions(signature)) assert.ok(option.value >= 0 && option.value <= COUNT_IN_CLICKS_MAX);
  }
});

test("카운트인 값 고르기: 선택지에 있으면 그대로, 없으면 가장 가까운 것(같은 거리면 긴 쪽)", () => {
  // 4/4에서 "1마디"(4)·"2마디"(8)를 골라 둔 채 박자표를 바꾼다
  assert.equal(effectiveCountIn(4, sig(3, 4)), 3);
  assert.equal(effectiveCountIn(8, sig(3, 4)), 6);
  assert.equal(effectiveCountIn(4, sig(6, 8)), 6, "2와 6이 같은 거리 → 긴 쪽");
  assert.equal(effectiveCountIn(8, sig(6, 8)), 6, "6(1마디)과 12(2마디) 중 가까운 6");
  assert.equal(effectiveCountIn(4, sig(2, 4)), 4);
  assert.equal(effectiveCountIn(8, sig(2, 4)), 4);
  // 반대로: 3/4의 "1마디"(3)를 골라 둔 채 4/4로
  assert.equal(effectiveCountIn(3, sig(4, 4)), 4, "2와 4가 같은 거리 → 긴 쪽");
  assert.equal(effectiveCountIn(6, sig(4, 4)), 8, "4와 8이 같은 거리 → 긴 쪽");
  // 선택지에 있는 값은 그대로
  for (const value of [0, 1, 2, 4, 8]) assert.equal(effectiveCountIn(value, sig(4, 4)), value);
  for (const value of [0, 1, 2]) for (const signature of TIME_SIGNATURES) assert.equal(effectiveCountIn(value, signature), value);
  // 이상한 값
  assert.equal(effectiveCountIn(-3, sig(4, 4)), 0);
  assert.equal(effectiveCountIn(Number.NaN, sig(4, 4)), 0);
  assert.equal(effectiveCountIn(99, sig(6, 8)), 12);
  assert.equal(effectiveCountIn(5), 4, "박자표를 주지 않으면 4/4");
});
