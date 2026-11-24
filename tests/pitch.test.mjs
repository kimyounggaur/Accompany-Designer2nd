/**
 * 재생 배율과 음정(domain/timeline/pitch.ts, 설계서 §P4-4, 보고서 B4):
 * 템포 맞춤은 속도를 바꾸는 만큼 음정도 바뀐다. 배율 r이면 12·log2(r)반음.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPlaybackRate, formatSemitones, rateToSemitones } from "../src/domain/timeline/pitch.ts";
import { getClipPlaybackRate } from "../src/utils/audioMath.ts";

const warped = (sourceBpm) => ({ stretchMode: "resample", sourceBpm });

test("B4 수용 기준: 배율 1.025는 +0.43반음으로 보인다(템포 123, 원본 BPM 120)", () => {
  const rate = getClipPlaybackRate(123, warped(120));
  assert.ok(Math.abs(rate - 1.025) < 1e-12);
  assert.equal(formatSemitones(rateToSemitones(rate)), "+0.43반음");
  assert.equal(formatPlaybackRate(rate), "1.025×", "배속도 1.02×로 잘못 읽히지 않게 셋째 자리까지 보인다");
});

test("옥타브: 배율 2는 +12반음, 0.5는 −12반음, 1은 0반음", () => {
  assert.equal(rateToSemitones(2), 12);
  assert.equal(rateToSemitones(0.5), -12);
  assert.equal(rateToSemitones(1), 0);
  assert.equal(formatSemitones(rateToSemitones(2)), "+12.00반음");
  assert.equal(formatSemitones(rateToSemitones(0.5)), "-12.00반음");
  assert.equal(formatSemitones(rateToSemitones(1)), "0반음");
});

test("느려지면 음정이 내려간다: 배율 0.9는 −1.82반음", () => {
  assert.equal(formatSemitones(rateToSemitones(0.9)), "-1.82반음");
});

test("배속 범위(0.25~4)의 양 끝은 ∓24반음", () => {
  assert.equal(formatSemitones(rateToSemitones(4)), "+24.00반음");
  assert.equal(formatSemitones(rateToSemitones(0.25)), "-24.00반음");
});

test("올바른 수가 아닌 배율은 음정 변화 없음(0반음)", () => {
  for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(rateToSemitones(bad), 0, String(bad));
    assert.equal(formatSemitones(rateToSemitones(bad)), "0반음", String(bad));
  }
});

test("formatSemitones: 소수 둘째 자리에서 반올림하고, 반올림하면 0이 되는 값은 0반음", () => {
  assert.equal(formatSemitones(0.004), "0반음");
  assert.equal(formatSemitones(-0.004), "0반음");
  assert.equal(formatSemitones(0.005), "+0.01반음");
  assert.equal(formatSemitones(-0.426), "-0.43반음");
  assert.equal(formatSemitones(NaN), "0반음");
});

test("formatPlaybackRate: 둘째 자리까지, 셋째 자리가 0이 아니면 셋째 자리까지", () => {
  assert.equal(formatPlaybackRate(1), "1.00×");
  assert.equal(formatPlaybackRate(1.1), "1.10×");
  assert.equal(formatPlaybackRate(0.5), "0.50×");
  assert.equal(formatPlaybackRate(1.0333), "1.033×");
  assert.equal(formatPlaybackRate(4), "4.00×");
  for (const bad of [0, -2, NaN, Infinity]) assert.equal(formatPlaybackRate(bad), "1.00×", String(bad));
});

test("템포 맞춤이 꺼져 있으면 배율은 1이라 음정도 그대로다", () => {
  const rate = getClipPlaybackRate(140, { stretchMode: "none", sourceBpm: 120 });
  assert.equal(rate, 1);
  assert.equal(formatSemitones(rateToSemitones(rate)), "0반음");
});
