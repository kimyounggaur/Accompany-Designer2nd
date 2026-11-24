import { test } from "node:test";
import assert from "node:assert/strict";
import { BPM_ANALYSIS_SECONDS, bpmAnalysisLength, estimateBpm, estimateBpmFromSamples } from "../src/audio/bpmDetector.ts";

/** 박마다 짧은 1kHz 딸깍 소리가 나는 시험 음원 (AudioBuffer 흉내) */
function clickTrack(bpm, seconds = 30, sampleRate = 44100) {
  const length = Math.floor(seconds * sampleRate);
  const data = new Float32Array(length);
  const beat = 60 / bpm;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    data[i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-(t % beat) * 60) * 0.8;
  }
  return { sampleRate, duration: seconds, length, numberOfChannels: 1, getChannelData: () => data };
}

// 보고서 B5에서 틀렸던 값(60 실패, 120→117, 140→70)과 아예 나올 수 없던 값(110·125·130)을 포함한다.
for (const bpm of [60, 72, 90, 100, 110, 120, 125, 128, 130, 140, 150, 174]) {
  test(`B5 ${bpm} BPM 클릭 음원을 ±1 이내로 감지한다`, () => {
    const detected = estimateBpm(clickTrack(bpm));
    assert.ok(detected !== undefined, "감지 실패");
    assert.ok(Math.abs(detected - bpm) <= 1, `감지값 ${detected}`);
  });
}

test("B5 무음은 값을 만들지 않는다", () => {
  const silent = { sampleRate: 44100, duration: 10, length: 441000, numberOfChannels: 1, getChannelData: () => new Float32Array(441000) };
  assert.equal(estimateBpm(silent), undefined);
});

// ───── P4-4: Worker에서 부르는 형태(estimateBpmFromSamples)와 진행률 ─────

test("P4-4 estimateBpmFromSamples는 estimateBpm과 같은 값을 낸다(같은 계산)", () => {
  const buffer = clickTrack(128);
  assert.equal(estimateBpmFromSamples(buffer.getChannelData(0), buffer.sampleRate), estimateBpm(buffer));
});

test("P4-4 진행률은 0~1 안에서 거꾸로 가지 않고 같은 퍼센트를 다시 알리지 않으며 1로 끝난다", () => {
  const buffer = clickTrack(100);
  const progress = [];
  const detected = estimateBpmFromSamples(buffer.getChannelData(0), buffer.sampleRate, (value) => progress.push(value));
  assert.ok(detected !== undefined && Math.abs(detected - 100) <= 1);
  assert.ok(progress.length >= 10 && progress.length <= 101, `알린 횟수 ${progress.length}`);
  assert.equal(progress[progress.length - 1], 1);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] > progress[i - 1], `${i}번째 ${progress[i - 1]} → ${progress[i]}`);
  assert.ok(progress[0] >= 0 && progress.every((value) => value <= 1));
});

test("P4-4 진행률을 받지 않아도 결과는 같다", () => {
  const buffer = clickTrack(140);
  const without = estimateBpmFromSamples(buffer.getChannelData(0), buffer.sampleRate);
  const withProgress = estimateBpmFromSamples(buffer.getChannelData(0), buffer.sampleRate, () => undefined);
  assert.equal(withProgress, without);
});

test("P4-4 앞 180초까지만 본다: 그 뒤가 무엇이든 결과가 같고, 분석 길이는 곡이 길어도 180초분이다", () => {
  const sampleRate = 8000;
  const head = clickTrack(120, BPM_ANALYSIS_SECONDS, sampleRate).getChannelData(0);
  const long = new Float32Array(head.length + sampleRate * 60);
  long.set(head);
  for (let i = head.length; i < long.length; i++) long[i] = Math.sin(i * 0.01) * 0.5; // 뒤 60초는 전혀 다른 소리
  assert.equal(estimateBpmFromSamples(long, sampleRate), estimateBpmFromSamples(head, sampleRate));
  assert.equal(bpmAnalysisLength(sampleRate * 600, sampleRate), BPM_ANALYSIS_SECONDS * sampleRate);
  assert.equal(bpmAnalysisLength(sampleRate * 10, sampleRate), sampleRate * 10, "짧은 곡은 전부");
});
