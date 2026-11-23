import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateBpm } from "../src/audio/bpmDetector.ts";

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
