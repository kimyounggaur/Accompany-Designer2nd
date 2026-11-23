import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext, Node } from "./helpers/fake-audio.mjs";
import {
  COUNT_IN_LEAD_SECONDS,
  Metronome,
  METRONOME_LOOKAHEAD_SECONDS,
  beatSeconds,
  beatTime,
  createClickPlayer,
  isStrongBeat,
  planCountIn,
} from "../src/audio/Metronome.ts";

const near = (actual, expected, tolerance, message = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} 기대 ${expected}, 실제 ${actual}, 차이 ${Math.abs(actual - expected)}`);

// ───────── 박 길이·계획 ─────────

test("한 박의 길이는 60 ÷ 템포이고, 템포는 20~300으로 맞춘다", () => {
  assert.equal(beatSeconds(120), 0.5);
  assert.equal(beatSeconds(60), 1);
  assert.equal(beatSeconds(10), 3); // 20으로
  assert.equal(beatSeconds(1000), 0.2); // 300으로
  assert.equal(beatSeconds(Number.NaN), 0.5); // 숫자가 아니면 120
});

test("카운트인 4박: t0 = 지금 + 0.1초, 클릭은 박마다, 첫 박만 강박, 시작은 t0 + 4박", () => {
  const plan = planCountIn({ now: 5, beats: 4, bpm: 120 });
  near(plan.t0, 5 + COUNT_IN_LEAD_SECONDS, 1e-12);
  assert.equal(COUNT_IN_LEAD_SECONDS, 0.1);
  assert.deepEqual(plan.clicks.map((click) => click.strong), [true, false, false, false]);
  assert.deepEqual(plan.clicks.map((click) => click.beat), [-4, -3, -2, -1]);
  plan.clicks.forEach((click, index) => near(click.time, plan.t0 + index * 0.5, 1e-12));
  near(plan.startTime, plan.t0 + 2, 1e-12);
  assert.equal(plan.beatSeconds, 0.5);
});

test("카운트인이 끝나는 시각(녹음·반주 시작)은 마지막 클릭 + 한 박이다: 4박 오차 1샘플 이내(여러 템포·샘플레이트)", () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const bpm of [40, 60, 72, 90, 97.3, 120, 133.7, 180, 240, 300]) {
      for (const now of [0, 0.123456789, 12.3456789, 3600.000123]) {
        const plan = planCountIn({ now, beats: 4, bpm });
        const exact = (plan.t0 * sampleRate) + (4 * 60 * sampleRate) / bpm; // 독립적으로 계산한 이상적인 프레임
        const recorderStartFrame = Math.round(plan.startTime * sampleRate);
        assert.ok(Math.abs(recorderStartFrame - exact) <= 1, `${bpm} bpm · ${sampleRate} Hz · now ${now}: 녹음 시작 프레임 ${recorderStartFrame} (이상 ${exact})`);
        const last = plan.clicks.at(-1);
        const fromClick = Math.round((last.time + plan.beatSeconds) * sampleRate);
        assert.ok(Math.abs(fromClick - recorderStartFrame) <= 1, `마지막 클릭 + 한 박 = 녹음 시작: ${fromClick} vs ${recorderStartFrame}`);
      }
    }
  }
});

test("박 수가 0이면 클릭 없이 t0(지금 + 0.1초)에 바로 시작한다", () => {
  const plan = planCountIn({ now: 2, beats: 0, bpm: 90 });
  assert.deepEqual(plan.clicks, []);
  assert.equal(plan.startTime, plan.t0);
});

test("박 수는 0~16 정수로 맞춘다", () => {
  assert.equal(planCountIn({ now: 0, beats: 99, bpm: 120 }).clicks.length, 16);
  assert.equal(planCountIn({ now: 0, beats: -3, bpm: 120 }).clicks.length, 0);
  assert.equal(planCountIn({ now: 0, beats: 2.6, bpm: 120 }).clicks.length, 3);
  assert.equal(planCountIn({ now: 0, beats: Number.NaN, bpm: 120 }).clicks.length, 0);
});

test("앞서는 시간(lead)을 바꿀 수 있다", () => {
  const plan = planCountIn({ now: 1, beats: 1, bpm: 60, lead: 0.5 });
  near(plan.t0, 1.5, 1e-12);
  near(plan.startTime, 2.5, 1e-12);
});

test("강박: 마디의 첫 박(음수 박도 마디 안에서 센다)", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 8].map((beat) => isStrongBeat(beat, 4)), [true, false, false, false, true, true]);
  assert.deepEqual([-4, -3, -1, -8].map((beat) => isStrongBeat(beat, 4)), [true, false, false, true]);
  assert.deepEqual([0, 3, 6, 7].map((beat) => isStrongBeat(beat, 3)), [true, true, true, false]);
  assert.equal(isStrongBeat(5, 0), false, "마디 길이가 이상하면 기본(4)으로");
  assert.equal(isStrongBeat(4, 0), true);
});

test("박 n의 시각은 기준 시각 + (n − 기준 박) × 박 길이다", () => {
  assert.equal(beatTime(10, 8, 9, 0.5), 10.5);
  assert.equal(beatTime(10, 8, 8, 0.5), 10);
  assert.equal(beatTime(10, 8, 6, 0.5), 9);
});

// ───────── 메트로놈 틱 ─────────

/** 손으로 돌리는 시계 위에서 메트로놈을 돌린다. `jitterMs`만큼 틱 간격이 흔들린다(결정적인 난수). */
function simulate({ bpm, seconds, anchorTime, tickMs = 25, jitterMs = 0, beatsPerBar }) {
  let now = 0;
  const clicks = [];
  const metronome = new Metronome({
    now: () => now,
    click: (click) => {
      clicks.push({ ...click, scheduledAt: now });
    },
    bpm,
    anchorTime,
    beatsPerBar,
  });
  let seed = 12345;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  while (now < seconds) {
    metronome.tick();
    now += (tickMs + (jitterMs ? (random() * 2 - 1) * jitterMs : 0)) / 1000;
  }
  return { clicks, metronome };
}

test("5분 동안 120 bpm: 박이 하나도 빠지거나 겹치지 않고, 박의 시각 오차는 1 ms 미만이다", () => {
  const anchorTime = 0.1;
  const { clicks } = simulate({ bpm: 120, seconds: 300, anchorTime });
  assert.ok(clicks.length >= 600, `박 ${clicks.length}개`);
  clicks.forEach((click, index) => {
    assert.equal(click.beat, index, "박 번호가 하나씩 이어진다");
    near(click.time, anchorTime + index / 2, 0.001, `박 ${index}`);
  });
  assert.deepEqual(clicks.slice(0, 5).map((click) => click.strong), [true, false, false, false, true]);
});

test("5분 동안 틱 간격이 ±20 ms 흔들려도 박은 이상적인 격자 위에 있다(97.3 bpm)", () => {
  const anchorTime = 0.25;
  const bpm = 97.3;
  const { clicks } = simulate({ bpm, seconds: 300, anchorTime, jitterMs: 20 });
  assert.ok(clicks.length > 480, `박 ${clicks.length}개`);
  let worst = 0;
  clicks.forEach((click, index) => {
    assert.equal(click.beat, index);
    worst = Math.max(worst, Math.abs(click.time - (anchorTime + (index * 60) / bpm)));
  });
  assert.ok(worst < 0.001, `가장 큰 오차 ${worst * 1000} ms`);
});

test("박은 소리 나기 150 ms 안쪽에서만 예약하고, 이미 지난 시각으로 예약하지 않는다", () => {
  const { clicks } = simulate({ bpm: 180, seconds: 60, anchorTime: 0.1, jitterMs: 15 });
  assert.equal(METRONOME_LOOKAHEAD_SECONDS, 0.15);
  for (const click of clicks) {
    assert.ok(click.time >= click.scheduledAt, `박 ${click.beat}: 이미 지난 시각(${click.time} < ${click.scheduledAt})`);
    assert.ok(click.time - click.scheduledAt < METRONOME_LOOKAHEAD_SECONDS, `박 ${click.beat}: 너무 일찍 예약(${click.time - click.scheduledAt})`);
  }
});

test("틱이 크게 늦어(탭이 가려졌다 돌아옴) 지나간 박은 늦게 울리지 않고 건너뛴다", () => {
  let now = 0;
  const clicks = [];
  const metronome = new Metronome({ now: () => now, click: (click) => void clicks.push(click), bpm: 120, anchorTime: 0.1 });
  metronome.tick(); // 박 0 (0.1초)
  assert.deepEqual(clicks.map((click) => click.beat), [0]);
  now = 3.05; // 3초 가까이 틱이 없었다. 박 1~5(0.6~2.6초)는 지났고, 박 6(3.1초)은 지평선(3.2초) 안이다.
  const scheduled = metronome.tick();
  assert.deepEqual(scheduled.map((click) => click.beat), [6]);
  assert.ok(scheduled.every((click) => click.time >= 3.05), "이미 지난 박은 예약하지 않는다");
  assert.equal(metronome.nextBeat, 7);
});

test("지평선 안에 박이 없으면 아무것도 예약하지 않고, 지난 박은 건너뛴 채 다음 틱에서 이어 간다", () => {
  let now = 3.2; // 박 6(3.1초)은 이미 지났고 박 7(3.6초)은 지평선(3.35초) 밖이다
  const clicks = [];
  const metronome = new Metronome({ now: () => now, click: (click) => void clicks.push(click), bpm: 120, anchorTime: 0.1 });
  metronome.tick();
  assert.deepEqual(clicks, []);
  assert.equal(metronome.nextBeat, 7, "지난 박(0~6)은 소리 없이 넘어간다");
  now = 3.5; // 지평선 3.65 → 박 7(3.6초)
  metronome.tick();
  assert.deepEqual(clicks.map((click) => click.beat), [7]);
});

test("이미 재생 중인 곡 위에서: 기준 박과 첫 박을 정해 박 번호·강박이 곡의 박을 따른다", () => {
  let now = 10;
  const clicks = [];
  const metronome = new Metronome({
    now: () => now,
    click: (click) => void clicks.push(click),
    bpm: 120,
    anchorTime: 10.05, // 박 8이 오는 오디오 시각
    anchorBeat: 8,
    firstBeat: 8,
  });
  for (let step = 0; step < 40; step += 1) {
    metronome.tick();
    now += 0.025;
  }
  assert.deepEqual(clicks.slice(0, 3).map((click) => click.beat), [8, 9, 10]);
  assert.deepEqual(clicks.slice(0, 3).map((click) => click.strong), [true, false, false], "박 8은 마디의 첫 박");
  near(clicks[0].time, 10.05, 1e-12);
  near(clicks[1].time, 10.55, 1e-12);
});

test("stop(): 아직 울리지 않은 클릭은 거두고, 이미 울린 것은 건드리지 않으며, 그 뒤 틱은 아무것도 하지 않는다", () => {
  let now = 0.4;
  const cancelled = [];
  const metronome = new Metronome({
    now: () => now,
    click: (click) => ({ cancel: () => cancelled.push(click.beat) }),
    bpm: 120,
    anchorTime: 0.5,
  });
  metronome.tick(); // 지평선 0.55 → 박 0(0.5)
  now = 0.45;
  metronome.stop();
  assert.deepEqual(cancelled, [0]);
  assert.deepEqual(metronome.tick(), []);

  // 이미 울린 클릭은 거두지 않는다.
  now = 0.4;
  const cancelledLate = [];
  const late = new Metronome({ now: () => now, click: (click) => ({ cancel: () => cancelledLate.push(click.beat) }), bpm: 120, anchorTime: 0.5 });
  late.tick();
  now = 0.6;
  late.stop();
  assert.deepEqual(cancelledLate, []);
});

// ───────── 클릭 소리 ─────────

test("클릭 소리: 강박은 높고 크게(1320 Hz), 약박은 낮고 작게(880 Hz) 짧게 울리며 모니터 길로 보낸다", () => {
  const context = new FakeContext();
  const monitor = new Node("monitor");
  const play = createClickPlayer(context, () => monitor);
  play({ time: 2, strong: true, beat: 0 });
  play({ time: 2.5, strong: false, beat: 1 });
  const [strong, weak] = context.all("oscillator");
  assert.equal(strong.type, "square");
  assert.deepEqual(strong.frequency.events, [{ type: "set", value: 1320, time: 2 }]);
  assert.deepEqual(weak.frequency.events, [{ type: "set", value: 880, time: 2.5 }]);
  assert.deepEqual(strong.started, [2]);
  assert.equal(strong.stopAt, 2.06);
  const [strongGain, weakGain] = context.all("gain");
  assert.ok(strongGain.gain.events[0].value > weakGain.gain.events[0].value, "강박이 더 크다");
  assert.deepEqual(strongGain.connections, [monitor]);
  assert.deepEqual(weakGain.connections, [monitor]);
  assert.notDeepEqual(strongGain.connections, [context.destination], "스피커로 바로 보내지 않고 모니터 길로");
});

test("모니터 길이 없으면 스피커로 보내고, cancel()은 소리를 멈추고 노드를 끊는다", () => {
  const context = new FakeContext();
  const play = createClickPlayer(context, () => undefined);
  const handle = play({ time: 1, strong: false, beat: 3 });
  const [oscillator] = context.all("oscillator");
  const [gain] = context.all("gain");
  assert.deepEqual(gain.connections, [context.destination]);
  handle.cancel();
  assert.equal(oscillator.stopped, true);
  assert.equal(oscillator.disconnected, true);
  assert.equal(gain.disconnected, true);
});
