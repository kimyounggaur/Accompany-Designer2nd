import test from "node:test";
import assert from "node:assert/strict";
import { PEAK_BUCKET_SIZES, PeakBuilder, createPeakSet, peakSetBytes } from "../src/domain/waveform/peakLevels.ts";
import { needsRawSamples, pickLevelIndex, samplesPerPixel, waveformColumns } from "../src/domain/waveform/columns.ts";

const RATE = 44100;
const source = (channels, sampleRate = RATE) => ({
  sampleRate,
  length: channels[0].length,
  numberOfChannels: channels.length,
  getChannelData: (channel) => channels[channel],
});
const sine = (seconds, hz, amplitude, rate = RATE) => {
  const data = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < data.length; i += 1) data[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return data;
};
/** 값이 한 점도 겹치지 않는 결정적 난수(시험 재현용) */
function noise(length, seed = 1) {
  const data = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = (state / 0xffffffff) * 2 - 1;
  }
  return data;
}

test("단계는 네 개이고 묶음 수가 4배씩 줄어든다", () => {
  const set = createPeakSet(source([noise(10_000)]));
  assert.deepEqual(set.levels.map((level) => level.samplesPerBucket), [256, 1024, 4096, 16384]);
  assert.deepEqual(set.levels.map((level) => level.min.length), [Math.ceil(10_000 / 256), Math.ceil(10_000 / 1024), Math.ceil(10_000 / 4096), 1]);
  for (const level of set.levels) assert.equal(level.min.length, level.max.length);
  assert.equal(set.frames, 10_000);
  assert.equal(set.sampleRate, RATE);
});

test("값은 가장 큰 소리를 127로 맞춘 정수이고, 최소는 0 이하·최대는 0 이상으로 모양이 맞다", () => {
  const data = new Float32Array(1000);
  data[10] = 0.4; // 첫 묶음의 최대
  data[20] = -0.2; // 첫 묶음의 최소
  data[300] = 0.8; // 둘째 묶음(256~511)의 최대 = 음원 전체의 최대
  data[600] = -0.8; // 셋째 묶음(512~767)의 최소
  const set = createPeakSet(source([data]));
  assert.equal(Math.round(set.peak * 1000) / 1000, 0.8);
  const [level] = set.levels;
  assert.equal(level.max[0], Math.round((0.4 / 0.8) * 127));
  assert.equal(level.min[0], Math.round((-0.2 / 0.8) * 127));
  assert.equal(level.max[1], 127);
  assert.equal(level.min[2], -127);
  for (let i = 0; i < level.min.length; i += 1) assert.ok(level.min[i] <= level.max[i] || (level.min[i] === 0 && level.max[i] === 0));
  assert.ok(Math.max(...level.max) <= 127 && Math.min(...level.min) >= -127);
});

test("굵은 단계는 가는 단계의 묶음 4개를 합친 값과 정확히 같다(원본을 바로 줄인 값과도 같다)", () => {
  const data = noise(50_000, 7);
  const set = createPeakSet(source([data]));
  const scale = 127 / set.peak;
  const q = (value) => Math.max(-127, Math.min(127, Math.round(value * scale)));
  for (const level of set.levels) {
    const size = level.samplesPerBucket;
    for (let bucket = 0; bucket < level.min.length; bucket += 1) {
      const slice = data.subarray(bucket * size, Math.min(data.length, (bucket + 1) * size));
      assert.equal(level.min[bucket], q(Math.min(...slice)), `단계 ${size} 묶음 ${bucket} 최소`);
      assert.equal(level.max[bucket], q(Math.max(...slice)), `단계 ${size} 묶음 ${bucket} 최대`);
    }
  }
});

test("덩어리로 나눠 받아도(경계가 256의 배수가 아니어도) 한 번에 받은 것과 같다", () => {
  const data = noise(40_000, 3);
  const whole = createPeakSet(source([data]));
  for (const chunk of [1, 100, 255, 256, 257, 1000, 4097, 40_000]) {
    const builder = new PeakBuilder(RATE, data.length);
    for (let offset = 0; offset < data.length; offset += chunk) builder.addChunk(data.slice(offset, offset + chunk), offset);
    const piece = builder.finish();
    assert.equal(piece.peak, whole.peak, `덩어리 ${chunk}`);
    piece.levels.forEach((level, index) => {
      assert.deepEqual([...level.min], [...whole.levels[index].min], `덩어리 ${chunk} 단계 ${index} 최소`);
      assert.deepEqual([...level.max], [...whole.levels[index].max], `덩어리 ${chunk} 단계 ${index} 최대`);
    });
  }
});

test("채널은 겹쳐 합친다: 어느 채널이든 더 벌어진 값이 남는다", () => {
  const left = new Float32Array(512);
  const right = new Float32Array(512);
  left[5] = 0.5;
  right[6] = -1;
  const set = createPeakSet(source([left, right]));
  assert.equal(set.peak, 1);
  assert.equal(set.levels[0].max[0], Math.round(0.5 * 127));
  assert.equal(set.levels[0].min[0], -127);
  const flipped = createPeakSet(source([right, left]));
  assert.deepEqual([...flipped.levels[0].min], [...set.levels[0].min]);
  assert.deepEqual([...flipped.levels[0].max], [...set.levels[0].max]);
});

test("무음은 크기 1에 모두 0이고, 숫자가 아닌 값(NaN)이 섞여도 계산이 망가지지 않는다", () => {
  const silent = createPeakSet(source([new Float32Array(3000)]));
  assert.equal(silent.peak, 1);
  assert.ok(silent.levels.every((level) => level.min.every((v) => v === 0) && level.max.every((v) => v === 0)));

  const broken = new Float32Array(1000);
  broken[3] = Number.NaN;
  broken[4] = 0.5;
  broken[5] = Number.POSITIVE_INFINITY; // 무한대는 크기로 치지 않는다(깨진 디코드 결과)
  const set = createPeakSet(source([broken]));
  assert.ok(Number.isFinite(set.peak));
  assert.ok(set.levels[0].max.every((v) => v >= -127 && v <= 127));
});

test("받지 못한 구간은 0으로 두고 음원 길이를 넘는 샘플은 버린다", () => {
  const builder = new PeakBuilder(RATE, 1000);
  builder.addChunk(new Float32Array(300).fill(0.5), 0); // 0~299만 받음
  builder.addChunk(new Float32Array(500).fill(1), 900); // 900~999 + 길이를 넘는 400개
  const set = builder.finish();
  assert.equal(set.levels[0].max[0], 64); // 0.5 / 1 * 127 = 63.5 → 64
  assert.equal(set.levels[0].max[2], 0, "받지 못한 구간(512~767)");
  assert.equal(set.levels[0].max[3], 127);
  assert.equal(set.levels[0].max.length, 4);
});

test("4분 스테레오 곡의 파형 자료는 합쳐서 약 110KB다(설계서)", () => {
  const frames = 4 * 60 * RATE;
  const builder = new PeakBuilder(RATE, frames);
  builder.addChunk(new Float32Array(frames).fill(0.1), 0);
  const bytes = peakSetBytes(builder.finish());
  assert.ok(bytes > 100_000 && bytes < 120_000, `파형 자료 ${bytes}바이트`);
});

test("픽셀당 샘플 수에 맞는 단계: 그보다 작거나 같은 가장 큰 단계, 256보다 작으면 원본 샘플", () => {
  assert.equal(pickLevelIndex(44), 0);
  assert.equal(pickLevelIndex(255.9), 0);
  assert.equal(pickLevelIndex(256), 0);
  assert.equal(pickLevelIndex(1023), 0);
  assert.equal(pickLevelIndex(1024), 1);
  assert.equal(pickLevelIndex(4095), 1);
  assert.equal(pickLevelIndex(4096), 2);
  assert.equal(pickLevelIndex(16383), 2);
  assert.equal(pickLevelIndex(16384), 3);
  assert.equal(pickLevelIndex(1e9), 3);
  assert.equal(needsRawSamples(255), true);
  assert.equal(needsRawSamples(256), false);
  // 96px/초에서 클립 길이 = 너비 ÷ 배율 → 샘플레이트 ÷ 배율
  assert.equal(samplesPerPixel({ sampleRate: 44100 }, 10, 960), 459.375);
  assert.equal(samplesPerPixel({ sampleRate: 44100 }, 10, 10_000), 44.1);
});

/** 원본 계산: 칸이 차지하는 샘플 구간의 최소·최대(음원의 가장 큰 소리가 1) */
function reference(channels, set, range) {
  const min = new Float32Array(range.count);
  const max = new Float32Array(range.count);
  const secondsPerPixel = range.duration / range.widthPx;
  const perPixel = secondsPerPixel * set.sampleRate;
  for (let x = 0; x < range.count; x += 1) {
    const from = (range.offset + (range.fromPx + x) * secondsPerPixel) * set.sampleRate;
    const first = Math.max(0, Math.floor(from));
    const last = Math.min(set.frames, Math.max(first + 1, Math.ceil(from + perPixel)));
    let lo = Infinity;
    let hi = -Infinity;
    for (const data of channels) {
      for (let i = first; i < last; i += 1) {
        if (data[i] < lo) lo = data[i];
        if (data[i] > hi) hi = data[i];
      }
    }
    if (lo === Infinity) continue;
    min[x] = lo / set.peak;
    max[x] = hi / set.peak;
  }
  return { min, max };
}

test("그리기 함수: 사인파의 칸별 최소·최대가 원본 계산과 1% 이내(배율 1~1,000px/초, 모든 단계와 원본 샘플)", () => {
  for (const hz of [220, 1000]) {
    const channels = [sine(30, hz, 0.8)];
    const set = createPeakSet(source(channels));
    const raw = source(channels);
    for (const zoom of [1, 5, 20, 96, 172, 300, 700, 1000]) {
      const range = { offset: 3.25, duration: 20, widthPx: Math.round(20 * zoom), fromPx: 0, count: Math.min(1400, Math.round(20 * zoom)) };
      const got = waveformColumns(set, range, raw);
      const want = reference(channels, set, range);
      let worst = 0;
      for (let x = 0; x < range.count; x += 1) worst = Math.max(worst, Math.abs(got.min[x] - want.min[x]), Math.abs(got.max[x] - want.max[x]));
      assert.ok(worst <= 0.01, `${hz}Hz ${zoom}px/초: 최대 차이 ${worst}`);
    }
  }
});

test("그리기 함수: 원본 샘플이 없으면(음원이 비어 있음) 가장 촘촘한 단계로 그린다", () => {
  const channels = [sine(5, 440, 0.5)];
  const set = createPeakSet(source(channels));
  const range = { offset: 0, duration: 1, widthPx: 1000, fromPx: 0, count: 200 }; // 픽셀당 44샘플
  const got = waveformColumns(set, range, undefined);
  assert.ok(got.max.every((value) => value > 0.9), "단계 0은 한 묶음이 256샘플이라 440Hz(약 100샘플)의 마루가 모두 잡힌다");
});

test("B1: 앞 4초 작고(0.05) 뒤 4초 큰(0.8) 음원을 4초에서 자르면 왼쪽 조각의 높이가 오른쪽의 1/8 이하", () => {
  const quiet = sine(4, 220, 0.05);
  const loud = sine(4, 220, 0.8);
  const data = new Float32Array(quiet.length + loud.length);
  data.set(quiet, 0);
  data.set(loud, quiet.length);
  const set = createPeakSet(source([data]));
  const raw = source([data]);
  const height = (columns) => {
    let top = 0;
    for (let x = 0; x < columns.max.length; x += 1) top = Math.max(top, columns.max[x], -columns.min[x]);
    return top;
  };
  for (const zoom of [20, 96, 400]) {
    const width = Math.round(4 * zoom);
    const left = waveformColumns(set, { offset: 0, duration: 4, widthPx: width, fromPx: 0, count: width }, raw);
    const right = waveformColumns(set, { offset: 4, duration: 4, widthPx: width, fromPx: 0, count: width }, raw);
    assert.ok(height(left) <= height(right) / 8, `${zoom}px/초: 왼쪽 ${height(left)} 오른쪽 ${height(right)}`);
    assert.ok(height(right) > 0.95, "큰 쪽은 음원의 가장 큰 소리(1)에 닿는다");
  }
});

test("클립이 음원보다 길어 음원 밖에 걸친 칸은 0으로 둔다", () => {
  const data = sine(2, 440, 0.5);
  const set = createPeakSet(source([data]));
  const columns = waveformColumns(set, { offset: 1, duration: 3, widthPx: 300, fromPx: 0, count: 300 }, source([data]));
  assert.ok(columns.max[10] > 0.5, "음원 안(1~2초)");
  assert.equal(columns.max[200], 0, "음원 끝(2초) 밖");
  assert.equal(columns.min[299], 0);
});

test("긴 곡을 전체 보기로 그려도 칸마다 읽는 묶음 수가 작다(1시간 곡 1,440칸이 한 번에 계산된다)", () => {
  const frames = 3600 * 8000; // 8kHz 1시간(계산 시간만 보려고 샘플레이트를 낮춤)
  const builder = new PeakBuilder(8000, frames);
  const chunk = new Float32Array(1 << 20);
  for (let i = 0; i < chunk.length; i += 1) chunk[i] = Math.sin(i / 20) * 0.5;
  for (let offset = 0; offset < frames; offset += chunk.length) builder.addChunk(chunk.subarray(0, Math.min(chunk.length, frames - offset)), offset);
  const set = builder.finish();
  assert.equal(set.frames, frames);
  const started = performance.now();
  const columns = waveformColumns(set, { offset: 0, duration: 3600, widthPx: 1440, fromPx: 0, count: 1440 });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 50, `1,440칸 계산 ${elapsed.toFixed(1)} ms`);
  assert.ok(columns.max.every((value) => value > 0.9));
});
