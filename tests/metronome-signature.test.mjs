/**
 * P5-5 박자표와 메트로놈: 마디의 첫 박만 강박이고, 6/8은 8분음표마다 울린다.
 * 카운트인(planCountIn)·메트로놈(Metronome)·녹음 컨트롤러가 같은 박자표를 쓰는지 확인한다.
 * 박자표를 모르면(옛 호출) 4분음표 클릭에 카운트인은 첫 박만 강박인 예전 동작 그대로다(metronome.test.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Metronome, beatSeconds, clickInterval, planCountIn } from "../src/audio/Metronome.ts";
import { barSeconds } from "../src/domain/timeline/snap.ts";
import { SAMPLE_RATE, createHarness } from "./helpers/recording-harness.mjs";

const near = (actual, expected, tolerance = 1e-9, message = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} 기대 ${expected}, 실제 ${actual}`);

test("클릭 간격: 4분음표 템포를 단위음표로 나눈다(8분음표 = 절반)", () => {
  assert.equal(clickInterval(120), 0.5);
  assert.equal(clickInterval(120, 4), 0.5);
  assert.equal(clickInterval(120, 8), 0.25);
  assert.equal(clickInterval(120, 0), 0.5, "단위가 이상하면 4분음표");
  assert.equal(clickInterval(120, Number.NaN), 0.5);
  assert.equal(clickInterval(1000, 8), beatSeconds(1000) / 2, "템포 한도(300)는 그대로 따른다");
  assert.equal(clickInterval(60, 8), 0.5);
});

// ───────── 카운트인 ─────────

test("카운트인 3/4: 클릭 간격은 4분음표, 마디(3박)마다 첫 박이 강박이다", () => {
  const one = planCountIn({ now: 5, beats: 3, bpm: 120, beatsPerBar: 3, beatUnit: 4 });
  assert.deepEqual(one.clicks.map((click) => click.strong), [true, false, false]);
  assert.deepEqual(one.clicks.map((click) => click.beat), [-3, -2, -1]);
  near(one.beatSeconds, 0.5);
  near(one.startTime, one.t0 + barSeconds(120, { beats: 3, unit: 4 }));

  const two = planCountIn({ now: 5, beats: 6, bpm: 120, beatsPerBar: 3, beatUnit: 4 });
  assert.deepEqual(two.clicks.map((click) => click.strong), [true, false, false, true, false, false], "2마디: 둘째 마디도 강박으로 시작");
});

test("카운트인 6/8: 8분음표마다 한 번, 1마디(6번)가 6/8 한 마디의 길이다", () => {
  const plan = planCountIn({ now: 1, beats: 6, bpm: 120, beatsPerBar: 6, beatUnit: 8 });
  assert.equal(plan.clicks.length, 6);
  assert.deepEqual(plan.clicks.map((click) => click.strong), [true, false, false, false, false, false]);
  near(plan.beatSeconds, 0.25);
  plan.clicks.forEach((click, index) => near(click.time, plan.t0 + index * 0.25, 1e-12));
  near(plan.startTime - plan.t0, barSeconds(120, { beats: 6, unit: 8 }), 1e-12, "카운트인 길이 = 한 마디");

  const two = planCountIn({ now: 1, beats: 12, bpm: 90, beatsPerBar: 6, beatUnit: 8 });
  assert.equal(two.clicks.length, 12);
  assert.deepEqual(two.clicks.map((click) => click.strong).map(Number), [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  near(two.startTime - two.t0, 2 * barSeconds(90, { beats: 6, unit: 8 }), 1e-12);
});

test("카운트인 4/4 2마디: 둘째 마디 첫 박도 강박이다", () => {
  const plan = planCountIn({ now: 0, beats: 8, bpm: 120, beatsPerBar: 4, beatUnit: 4 });
  assert.deepEqual(plan.clicks.map((click) => click.strong).map(Number), [1, 0, 0, 0, 1, 0, 0, 0]);
});

test("카운트인 2/4: 마디가 2박이라 한 박 건너 강박이다", () => {
  const plan = planCountIn({ now: 0, beats: 4, bpm: 120, beatsPerBar: 2, beatUnit: 4 });
  assert.deepEqual(plan.clicks.map((click) => click.strong).map(Number), [1, 0, 1, 0]);
});

test("카운트인: 박자표를 주지 않으면 예전 그대로(4분음표, 첫 박만 강박)", () => {
  const plan = planCountIn({ now: 0, beats: 8, bpm: 120 });
  assert.deepEqual(plan.clicks.map((click) => click.strong).map(Number), [1, 0, 0, 0, 0, 0, 0, 0]);
  near(plan.beatSeconds, 0.5);
});

test("카운트인이 끝나는 시각 오차: 6/8·3/4도 1샘플 이내(여러 템포·샘플레이트)", () => {
  for (const [signature, count] of [[{ beats: 6, unit: 8 }, 6], [{ beats: 3, unit: 4 }, 3], [{ beats: 2, unit: 4 }, 4]]) {
    for (const sampleRate of [44100, 48000]) {
      for (const bpm of [40, 72, 97.3, 133.7, 240, 300]) {
        const plan = planCountIn({ now: 3600.000123, beats: count, bpm, beatsPerBar: signature.beats, beatUnit: signature.unit });
        const exact = plan.t0 * sampleRate + (count * (60 / bpm) * 4 * sampleRate) / signature.unit;
        assert.ok(Math.abs(Math.round(plan.startTime * sampleRate) - exact) <= 1, `${signature.beats}/${signature.unit} · ${bpm} bpm · ${sampleRate} Hz`);
      }
    }
  }
});

// ───────── 메트로놈 ─────────

/** 손으로 돌리는 시계 위에서 메트로놈을 `seconds`초 돌린다 */
function runMetronome(options, seconds) {
  let now = 0;
  const clicks = [];
  const metronome = new Metronome({ now: () => now, click: (click) => void clicks.push(click), ...options });
  while (now < seconds) {
    metronome.tick();
    now += 0.025;
  }
  return clicks;
}

test("메트로놈 6/8: 8분음표마다 울리고 6번째마다 강박이다", () => {
  const clicks = runMetronome({ bpm: 120, anchorTime: 0.1, beatsPerBar: 6, beatUnit: 8 }, 3.3);
  assert.ok(clicks.length >= 12);
  clicks.forEach((click, index) => {
    assert.equal(click.beat, index);
    near(click.time, 0.1 + index * 0.25, 1e-9, `박 ${index}`); // 곱해서 구하므로 오차가 쌓이지 않는다
    assert.equal(click.strong, index % 6 === 0, `박 ${index}`);
  });
});

test("메트로놈 3/4: 3박마다 강박, 박자표를 주지 않으면 4박마다 강박", () => {
  const threeFour = runMetronome({ bpm: 120, anchorTime: 0.1, beatsPerBar: 3, beatUnit: 4 }, 4.2);
  assert.deepEqual(threeFour.map((click) => click.strong).slice(0, 7), [true, false, false, true, false, false, true]);
  near(threeFour[1].time - threeFour[0].time, 0.5);

  const plain = runMetronome({ bpm: 120, anchorTime: 0.1 }, 4.2);
  assert.deepEqual(plain.map((click) => click.strong).slice(0, 9), [true, false, false, false, true, false, false, false, true]);
});

test("메트로놈: 박 번호가 음수여도(카운트인) 마디 안에서 센다", () => {
  const clicks = runMetronome({ bpm: 120, anchorTime: 5, anchorBeat: 0, firstBeat: -6, beatsPerBar: 3, beatUnit: 4 }, 5.5);
  assert.deepEqual(clicks.slice(0, 7).map((click) => [click.beat, click.strong]), [[-6, true], [-5, false], [-4, false], [-3, true], [-2, false], [-1, false], [0, true]]);
  near(clicks[0].time, 2, 1e-9);
});

// ───────── 녹음 컨트롤러 ─────────

test("녹음 3/4, 카운트인 1마디: 클릭 3번(강·약·약), 시작은 t0 + 1.5초, 메트로놈도 3박마다 강박", async () => {
  const h = createHarness({ now: 1, bpm: 120, timeSignature: { beats: 3, unit: 4 }, settings: { countInBeats: 3, metronomeEnabled: true } });
  await h.controller.start();
  assert.equal(h.clicks.length, 3);
  assert.deepEqual(h.clicks.map((entry) => entry.click.strong), [true, false, false]);
  near(h.calls.play[0].atContextTime, 1.1 + 1.5, 1e-9, "반주 시작");
  assert.equal(h.recorder.beganAt, Math.round((1.1 + 1.5) * SAMPLE_RATE));

  h.run(1.025, 6);
  const metronome = h.clicks.slice(3).map((entry) => entry.click);
  assert.deepEqual(metronome.slice(0, 7).map((click) => click.strong), [true, false, false, true, false, false, true]);
  near(metronome[0].time, 2.6, 1e-9, "첫 박은 녹음이 시작하는 시각");
  near(metronome[1].time - metronome[0].time, 0.5, 1e-9);
});

test("녹음 6/8, 카운트인 1마디: 클릭 6번을 8분음표 간격으로, 시작은 t0 + 1.5초, 메트로놈은 6번마다 강박", async () => {
  const h = createHarness({ now: 1, bpm: 120, timeSignature: { beats: 6, unit: 8 }, settings: { countInBeats: 6, metronomeEnabled: true } });
  await h.controller.start();
  assert.equal(h.clicks.length, 6);
  assert.deepEqual(h.clicks.map((entry) => entry.click.strong), [true, false, false, false, false, false]);
  h.clicks.forEach((entry, index) => near(entry.click.time, 1.1 + index * 0.25, 1e-9, `클릭 ${index}`));
  near(h.calls.play[0].atContextTime, 1.1 + 1.5, 1e-9);

  h.run(1.025, 6.5);
  const metronome = h.clicks.slice(6).map((entry) => entry.click);
  assert.deepEqual(metronome.slice(0, 13).map((click) => click.strong).map(Number), [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  near(metronome[1].time - metronome[0].time, 0.25, 1e-9);
});

test("녹음 4/4(기본): 예전과 같이 카운트인 4박이 강약약약", async () => {
  const h = createHarness({ now: 1, bpm: 120, settings: { countInBeats: 4 } });
  await h.controller.start();
  assert.deepEqual(h.clicks.map((entry) => entry.click.strong), [true, false, false, false]);
  near(h.calls.play[0].atContextTime, 3.1, 1e-9);
});

test("녹음은 시작할 때의 박자표를 쓴다: 녹음 중에 문서의 박자표가 바뀌어도 이미 정한 간격이 유지된다", async () => {
  const h = createHarness({ now: 1, bpm: 120, timeSignature: { beats: 3, unit: 4 }, settings: { countInBeats: 3, metronomeEnabled: true } });
  await h.controller.start();
  h.config.timeSignature = { beats: 6, unit: 8 }; // 시작한 뒤에 바뀜
  h.run(1.025, 4);
  const metronome = h.clicks.slice(3).map((entry) => entry.click);
  near(metronome[1].time - metronome[0].time, 0.5, 1e-9);
  assert.deepEqual(metronome.slice(0, 4).map((click) => click.strong), [true, false, false, true]);
});
