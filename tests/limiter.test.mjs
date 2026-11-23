import { test } from "node:test";
import assert from "node:assert/strict";

const { LookaheadLimiter, LIMITER_CEILING, gainToDb } = await import("../src/audio/worklets/limiterCore.ts");

const SAMPLE_RATE = 48000;
const BLOCK = 128;

/**
 * 신호 함수 (채널, 샘플 번호) → 값을 limiter로 흘려 보내 출력 전체를 모은다.
 * `gains`는 블록이 끝난 뒤의 이득을 그 블록의 모든 샘플에 적어 두므로, 샘플마다의 이득이 필요하면 block = 1로 돌린다.
 */
function run(limiter, signal, frames, block = BLOCK) {
  const out = [new Float32Array(frames), new Float32Array(frames)];
  const input = [new Float32Array(block), new Float32Array(block)];
  const gains = new Float32Array(frames);
  for (let start = 0; start < frames; start += block) {
    const length = Math.min(block, frames - start);
    const inBlock = [input[0].subarray(0, length), input[1].subarray(0, length)];
    for (let i = 0; i < length; i += 1) {
      inBlock[0][i] = signal(0, start + i);
      inBlock[1][i] = signal(1, start + i);
    }
    const outBlock = [out[0].subarray(start, start + length), out[1].subarray(start, start + length)];
    limiter.process(inBlock, outBlock);
    for (let i = 0; i < length; i += 1) gains[start + i] = limiter.gain;
  }
  return { out, gains };
}

const sine = (amplitude, hz = 220) => (_ch, n) => amplitude * Math.sin((2 * Math.PI * hz * n) / SAMPLE_RATE);
const peakOf = (array, from = 0) => array.slice(from).reduce((max, value) => Math.max(max, Math.abs(value)), 0);

test("상한은 −1 dBFS(약 0.891)이고, 선읽기는 5 ms다", () => {
  assert.ok(Math.abs(LIMITER_CEILING - 0.8913) < 1e-4);
  const limiter = new LookaheadLimiter(SAMPLE_RATE);
  assert.equal(limiter.lookahead, 240, "48 kHz에서 5 ms = 240 샘플");
  assert.equal(new LookaheadLimiter(44100).lookahead, 221);
});

test("1.6 크기 사인 입력 → 출력 최대는 0.891 ± 0.01 (설계 수용 기준)", () => {
  const { out } = run(new LookaheadLimiter(SAMPLE_RATE), sine(1.6), SAMPLE_RATE);
  const peak = peakOf(out[0], SAMPLE_RATE / 2); // 첫 소리가 들어오는 순간이 아니라 자리 잡은 뒤
  assert.ok(Math.abs(peak - 0.891) <= 0.01, `최대 ${peak}`);
  assert.ok(peakOf(out[0]) <= LIMITER_CEILING * (1 + 1e-6), "처음부터 끝까지 상한을 넘지 않는다");
  assert.ok(peakOf(out[1]) <= LIMITER_CEILING * (1 + 1e-6));
});

test("상한 아래의 소리는 건드리지 않는다: 0.8 사인은 5 ms 늦게 그대로 나온다 (±0.5 dB 안, 실제로는 0)", () => {
  const limiter = new LookaheadLimiter(SAMPLE_RATE);
  const frames = SAMPLE_RATE / 2;
  const { out, gains } = run(limiter, sine(0.8), frames);
  const expected = sine(0.8);
  let worst = 0;
  for (let n = limiter.lookahead; n < frames; n += 1) worst = Math.max(worst, Math.abs(out[0][n] - expected(0, n - limiter.lookahead)));
  assert.ok(worst < 1e-6, `입력과의 차이 ${worst}`);
  assert.ok(gains.every((gain) => gain === 1), "이득은 늘 1");
  assert.equal(limiter.takeMinGain(), 1);
  assert.ok(Math.abs(gainToDb(1)) < 1e-9);
});

test("처음 5 ms는 무음이고, 그 뒤에 입력이 5 ms 늦게 나온다", () => {
  const limiter = new LookaheadLimiter(SAMPLE_RATE);
  const { out } = run(limiter, (_ch, n) => (n < 10 ? 0.3 : 0), 1000);
  for (let n = 0; n < limiter.lookahead; n += 1) assert.equal(out[0][n], 0);
  for (let n = limiter.lookahead; n < limiter.lookahead + 10; n += 1) assert.ok(Math.abs(out[0][n] - 0.3) < 1e-6);
  assert.equal(out[0][limiter.lookahead + 10], 0);
});

test("어떤 입력도 상한을 넘지 않는다: 큰 잡음, 단발 큰 소리, 직류 계단", () => {
  const noise = (() => { let seed = 12345; return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; }; })();
  const cases = {
    "잡음 ×4": () => 4 * noise(),
    "단발 8.0": (_ch, n) => (n === 5000 ? 8 : 0),
    "직류 계단 3.0": (_ch, n) => (n > 2000 ? 3 : 0.1),
    "한쪽 채널만 큼": (ch, n) => (ch === 0 ? 2.5 * Math.sin(n / 7) : 0.05 * Math.sin(n / 11)),
  };
  for (const [name, signal] of Object.entries(cases)) {
    const { out } = run(new LookaheadLimiter(SAMPLE_RATE), signal, SAMPLE_RATE);
    const worst = Math.max(peakOf(out[0]), peakOf(out[1]));
    assert.ok(worst <= LIMITER_CEILING * (1 + 1e-6), `${name}: 최대 ${worst}`);
  }
});

test("선읽기: 큰 소리가 출력에 닿기 전부터 이득이 5 ms에 걸쳐 미리 내려온다", () => {
  const limiter = new LookaheadLimiter(SAMPLE_RATE);
  const at = 4000;
  const { out, gains } = run(limiter, (_ch, n) => (n === at ? 4 : 0.01), 8000, 1);
  const arrival = at + limiter.lookahead; // 이 소리가 출력에 닿는 샘플 번호
  assert.ok(Math.abs(out[0][arrival]) <= LIMITER_CEILING * (1 + 1e-6), "닿는 순간 상한 이하");
  assert.ok(Math.abs(out[0][arrival]) > LIMITER_CEILING * 0.99, "그렇다고 더 눌리지도 않는다");
  assert.ok(gains[at - 1] === 1, "소리가 들어오기 전까지는 1");
  assert.ok(gains[arrival - 1] > gains[arrival], "닿기 직전까지도 아직 내려가는 중");
  for (let n = at; n < arrival; n += 1) assert.ok(gains[n + 1] <= gains[n] + 1e-12, "내려가는 동안 올라가지 않는다");
  const mid = at + limiter.lookahead / 2;
  assert.ok(gains[mid] > gains[arrival] && gains[mid] < 1, "5 ms에 걸쳐 완만하게");
});

test("회복: 눌린 이득은 80 ms 시상수 곡선으로 천천히 1로 돌아간다 (올라갈 때만 느리다)", () => {
  const limiter = new LookaheadLimiter(SAMPLE_RATE);
  const at = 2000;
  const frames = SAMPLE_RATE * 2;
  const { gains } = run(limiter, (_ch, n) => (n === at ? 4 : 0), frames, 1);
  const lowest = LIMITER_CEILING / 4;
  const release = at + limiter.lookahead; // 이득이 가장 낮은 곳에서 이득이 오르기 시작하는 샘플
  assert.ok(Math.abs(Math.min(...gains) - lowest) < 1e-6, `가장 낮은 이득 ${Math.min(...gains)}`);
  const after = (ms) => gains[release + Math.round((ms / 1000) * SAMPLE_RATE)];
  const expected = (ms) => 1 - (1 - lowest) * Math.exp(-ms / 80);
  for (const ms of [40, 80, 160, 320]) assert.ok(Math.abs(after(ms) - expected(ms)) < 0.03, `${ms} ms 뒤 이득 ${after(ms)} ≠ ${expected(ms)}`);
  for (let n = release; n < frames - 1; n += 1) assert.ok(gains[n + 1] >= gains[n] - 1e-12, "회복 중에는 내려가지 않는다");
  assert.ok(gains[frames - 1] > 0.999, "1초 넘게 지나면 거의 1");
});

test("스테레오 연결: 한쪽 채널이 커도 두 채널에 같은 이득이 걸려 좌우 크기 비율이 그대로다", () => {
  const limiter = new LookaheadLimiter(SAMPLE_RATE);
  const left = sine(2.0, 300);
  const right = sine(0.2, 300);
  const frames = SAMPLE_RATE / 2;
  const { out } = run(limiter, (ch, n) => (ch === 0 ? left(0, n) : right(0, n)), frames);
  for (let n = limiter.lookahead + 100; n < frames; n += 1) {
    const l = left(0, n - limiter.lookahead);
    if (Math.abs(l) < 0.5) continue;
    const gainLeft = out[0][n] / l;
    const gainRight = out[1][n] / right(0, n - limiter.lookahead);
    assert.ok(Math.abs(gainLeft - gainRight) < 1e-4, `${n}: ${gainLeft} ≠ ${gainRight}`);
  }
});

test("블록 크기와 상관없이 같은 출력이다 (128 / 1 / 37 샘플씩)", () => {
  const noise = () => { let seed = 99; return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 3 - 1.5; }; };
  const make = () => { const next = noise(); const samples = Array.from({ length: 6000 }, () => next()); return (ch, n) => samples[n] * (ch ? 0.6 : 1); };
  const a = run(new LookaheadLimiter(SAMPLE_RATE), make(), 6000, 128).out;
  const b = run(new LookaheadLimiter(SAMPLE_RATE), make(), 6000, 1).out;
  const c = run(new LookaheadLimiter(SAMPLE_RATE), make(), 6000, 37).out;
  assert.deepEqual(Array.from(a[0]), Array.from(b[0]));
  assert.deepEqual(Array.from(a[1]), Array.from(c[1]));
});

test("입력이 끊겨도(빈 입력) 지연 버퍼에 남은 소리가 끝까지 나간다", () => {
  const limiter = new LookaheadLimiter(SAMPLE_RATE);
  const out = [new Float32Array(128), new Float32Array(128)];
  const block = [new Float32Array(128).fill(0.5), new Float32Array(128).fill(0.5)];
  limiter.process(block, out); // 0.5가 128샘플 들어가 아직 지연 안에 있다
  assert.equal(peakOf(out[0]), 0, "아직 아무것도 나오지 않았다");
  let heard = 0;
  for (let i = 0; i < 5; i += 1) {
    limiter.process([], out); // 입력 없음
    heard += out[0].reduce((sum, value) => sum + (value === 0.5 ? 1 : 0), 0);
  }
  assert.equal(heard, 128, "들어간 128샘플이 모두 나왔다");
});

test("가장 낮은 이득을 읽어 가면 다시 지금 이득부터 센다 (화면 표시용)", () => {
  const limiter = new LookaheadLimiter(SAMPLE_RATE);
  run(limiter, (_ch, n) => (n === 1000 ? 4 : 0), 4000);
  const lowest = limiter.takeMinGain();
  assert.ok(Math.abs(lowest - LIMITER_CEILING / 4) < 1e-6);
  assert.ok(Math.abs(gainToDb(lowest) - 20 * Math.log10(LIMITER_CEILING / 4)) < 1e-9);
  assert.ok(limiter.takeMinGain() >= lowest, "읽은 뒤에는 그 뒤의 값부터");
  run(limiter, () => 0, SAMPLE_RATE * 2);
  limiter.takeMinGain(); // 회복하는 동안의 낮은 값은 여기서 비운다
  run(limiter, () => 0, SAMPLE_RATE / 10);
  assert.ok(limiter.takeMinGain() > 0.99, "회복한 뒤에는 거의 1");
  assert.equal(gainToDb(0), -120);
});

test("오래 돌려도(이동 평균 합을 다시 더하는 시점 지나서) 값이 어긋나지 않는다", () => {
  const limiter = new LookaheadLimiter(SAMPLE_RATE);
  const frames = 70000; // 65,536번째 샘플을 지난다
  const { out, gains } = run(limiter, sine(1.6), frames);
  assert.ok(peakOf(out[0], 5000) <= LIMITER_CEILING * (1 + 1e-6));
  assert.ok(peakOf(out[0], 5000) > LIMITER_CEILING * 0.99);
  const settled = gains.slice(5000);
  assert.ok(Math.max(...settled) - Math.min(...settled) < 0.01, "이득이 흔들리지 않는다");
});

test("채널 하나만 들어와도 처리한다(모자란 채널은 무음)", () => {
  const limiter = new LookaheadLimiter(SAMPLE_RATE, 2);
  const out = [new Float32Array(2000), new Float32Array(2000)];
  const mono = [Float32Array.from({ length: 2000 }, (_, n) => 2 * Math.sin(n / 20))];
  limiter.process(mono, out);
  assert.ok(peakOf(out[0]) <= LIMITER_CEILING * (1 + 1e-6));
  assert.equal(peakOf(out[1]), 0);
});
