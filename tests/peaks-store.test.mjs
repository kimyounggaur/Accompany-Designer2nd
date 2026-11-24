/**
 * 파형 저장소 캐시의 순수한 부분(설계서 §P4-3): 기록 ↔ 파형 자료 변환과 검사, 키, 쓰지 않는 음원의 파형 찾기.
 * IndexedDB를 읽고 쓰는 부분은 브라우저에서(e2e) 확인한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPeakSet, PEAK_BUCKET_SIZES } from "../src/domain/waveform/peakLevels.ts";
import { hashOfPeakKey, orphanPeakKeys, peakKey, peakSetFromRecords, toPeakRecords } from "../src/services/persistence/peaksStore.ts";

function sampleSet(frames = 5000) {
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) data[i] = Math.sin(i / 17) * (i < frames / 2 ? 0.2 : 0.9);
  return createPeakSet({ sampleRate: 44100, length: frames, numberOfChannels: 1, getChannelData: () => data });
}

const HASH = "ab".repeat(32);

test("키는 `${해시}:${단계}`이고, 키에서 해시를 되찾는다", () => {
  assert.equal(peakKey(HASH, 2), `${HASH}:2`);
  assert.equal(hashOfPeakKey(peakKey(HASH, 3)), HASH);
  // 해시를 계산하지 못해 쓴 대체 키(콜론이 들어 있다)도 마지막 콜론 앞이 해시 쪽이다
  assert.equal(hashOfPeakKey("plain:p1:a1:5:0"), "plain:p1:a1:5");
});

test("파형 자료 → 기록 네 개 → 파형 자료: 같은 값으로 돌아온다", () => {
  const set = sampleSet();
  const records = toPeakRecords(set);
  assert.equal(records.length, PEAK_BUCKET_SIZES.length);
  assert.deepEqual(records.map((record) => record.samplesPerBucket), [...PEAK_BUCKET_SIZES]);
  const back = peakSetFromRecords(records);
  assert.ok(back);
  assert.equal(back.sampleRate, set.sampleRate);
  assert.equal(back.frames, set.frames);
  assert.equal(back.peak, set.peak);
  back.levels.forEach((level, index) => {
    assert.deepEqual([...level.min], [...set.levels[index].min]);
    assert.deepEqual([...level.max], [...set.levels[index].max]);
  });
});

test("읽은 기록이 하나라도 어긋나면 쓰지 않는다(다시 계산한다)", () => {
  const good = () => toPeakRecords(sampleSet());
  const reject = (mutate, why) => {
    const records = good();
    mutate(records);
    assert.equal(peakSetFromRecords(records), undefined, why);
  };
  assert.equal(peakSetFromRecords([]), undefined, "없다");
  reject((r) => r.pop(), "단계가 모자라다");
  reject((r) => { r[1] = undefined; }, "한 단계가 비었다");
  reject((r) => { r[0].version = 2; }, "다른 버전");
  reject((r) => { r[2].samplesPerBucket = 512; }, "묶음 크기가 다르다");
  reject((r) => { r[3].frames = 6000; }, "다른 때 쓴 단계가 섞였다(길이)");
  reject((r) => { r[1].sampleRate = 48000; }, "다른 때 쓴 단계가 섞였다(샘플레이트)");
  reject((r) => { r[1].peak = 0.5; }, "다른 때 쓴 단계가 섞였다(최대값)");
  reject((r) => { r[0].min = r[0].min.slice(1); }, "묶음 수가 안 맞는다");
  reject((r) => { r[0].max = new Array(r[0].max.length).fill(0); }, "Int8Array가 아니다");
  reject((r) => { r[0].frames = 0; r[1].frames = 0; r[2].frames = 0; r[3].frames = 0; }, "길이 0");
  reject((r) => { r[0].peak = Number.NaN; r[1].peak = Number.NaN; r[2].peak = Number.NaN; r[3].peak = Number.NaN; }, "최대값이 숫자가 아니다");
  reject((r) => { r[0] = null; }, "기록이 객체가 아니다");
});

test("쓰지 않는 음원의 파형 키만 골라낸다(음원 데이터를 지울 때 같이 지운다)", () => {
  const used = new Set([HASH]);
  const other = "cd".repeat(32);
  const keys = [peakKey(HASH, 0), peakKey(HASH, 1), peakKey(other, 0), peakKey(other, 3), 42];
  assert.deepEqual(orphanPeakKeys(keys, used), [peakKey(other, 0), peakKey(other, 3)]);
  assert.deepEqual(orphanPeakKeys(keys, new Set([HASH, other])), []);
  assert.deepEqual(orphanPeakKeys([], used), []);
});
