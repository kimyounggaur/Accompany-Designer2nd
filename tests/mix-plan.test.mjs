import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClip, makeTrack, makeProject, enableEffect } from "./helpers/mix-project.mjs";

const { mixClips, planMixRender, progressMarks, RENDER_QUANTUM, EXPORT_CHANNELS } = await import("../src/audio/engine/mixPlan.ts");
const { wavByteLength, WAV_HEADER_BYTES } = await import("../src/utils/wavEncoder.ts");
const { limiterLookaheadFrames, LookaheadLimiter } = await import("../src/audio/worklets/limiterCore.ts");
const { DEFAULT_EXPORT_OPTIONS, defaultSampleRateFor, normalizeExportOptions, MAX_EXPORT_SECONDS } = await import("../src/domain/export/exportOptions.ts");
const { formatDuration, formatBytes } = await import("../src/domain/export/exportFormat.ts");

const everything = () => true;
const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} ≠ ${expected}`);
const options = (sampleRate = 44100, bitDepth = 16) => ({ sampleRate, bitDepth });

test("믹스에 들어가는 클립: 꺼진 클립과 녹음 중인 클립은 뺀다(재생과 같은 조건)", () => {
  const audible = makeClip({ id: "a" });
  const project = makeProject({
    tracks: [makeTrack([audible, makeClip({ id: "m", muted: true }), makeClip({ id: "r", isRecording: true })])],
  });
  assert.deepEqual(mixClips(project).map(({ clip }) => clip.id), ["a"]);
  assert.equal(mixClips(project)[0].track, project.tracks[0]);
});

test("내보낼 수 없는 경우: 클립이 없거나 모두 꺼져 있으면 no-clips", () => {
  assert.deepEqual(planMixRender(makeProject({ tracks: [makeTrack([])] }), everything, options()), { ok: false, reason: "no-clips" });
  const allMuted = makeProject({ tracks: [makeTrack([makeClip({ muted: true })])] });
  assert.deepEqual(planMixRender(allMuted, everything, options()), { ok: false, reason: "no-clips" });
});

test("내보낼 수 없는 경우: 음원이 없으면 찾을 수 없는 음원의 수(같은 음원은 한 번)를 알려 준다", () => {
  const project = makeProject({
    tracks: [makeTrack([
      makeClip({ audioBufferId: "gone" }), makeClip({ audioBufferId: "gone", startTime: 2 }),
      makeClip({ audioBufferId: "also-gone", startTime: 4 }), makeClip({ audioBufferId: "here", startTime: 6 }),
    ])],
  });
  const result = planMixRender(project, (id) => id === "here", options());
  assert.deepEqual(result, { ok: false, reason: "missing-audio", missing: 2 });
});

test("내보낼 수 없는 경우: 1시간을 넘으면 too-long (꼬리까지 더한 길이로 본다)", () => {
  const long = makeProject({ tracks: [makeTrack([makeClip({ startTime: MAX_EXPORT_SECONDS, duration: 1 })])] });
  const result = planMixRender(long, everything, options());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too-long");
  near(result.durationSeconds, MAX_EXPORT_SECONDS + 1);
  const exact = makeProject({ tracks: [makeTrack([makeClip({ startTime: MAX_EXPORT_SECONDS - 1, duration: 1 })])] });
  assert.equal(planMixRender(exact, everything, options()).ok, true, "딱 1시간은 내보낼 수 있다");
});

test("길이 = 마지막 클립 끝 + 꼬리: 프레임 수는 올림하고, 파일 크기는 머리말 + 프레임 × 2채널 × 바이트", () => {
  const project = makeProject({ tracks: [makeTrack([makeClip({ startTime: 1, duration: 3 }), makeClip({ startTime: 0, duration: 2 })])] });
  const cd = planMixRender(project, everything, options(44100, 16));
  assert.equal(cd.ok, true);
  assert.equal(cd.plan.clipCount, 2);
  near(cd.plan.endSeconds, 4);
  near(cd.plan.tailSeconds, 0, "EQ만 켜져 있으면 꼬리가 없다");
  assert.equal(cd.plan.frames, 4 * 44100);
  near(cd.plan.durationSeconds, 4);
  assert.equal(cd.plan.bytes, WAV_HEADER_BYTES + 4 * 44100 * 2 * 2);
  assert.equal(cd.plan.bytes, wavByteLength(4 * 44100, 16, EXPORT_CHANNELS));

  const studio = planMixRender(project, everything, options(48000, 24));
  assert.equal(studio.plan.frames, 4 * 48000);
  assert.equal(studio.plan.bytes, WAV_HEADER_BYTES + 4 * 48000 * 2 * 3);

  const odd = planMixRender(makeProject({ tracks: [makeTrack([makeClip({ duration: 1.00001 })])] }), everything, options());
  assert.equal(odd.plan.frames, Math.ceil(1.00001 * 44100), "모자라게 자르지 않고 올린다");
});

test("WARP(resample) 클립은 템포에 맞춰 늘어난 타임라인 길이로 끝을 계산한다", () => {
  // 원곡 60 bpm, 프로젝트 120 bpm → 2배속 → 4초 음원이 타임라인에서 2초
  const warped = makeClip({ stretchMode: "resample", sourceBpm: 60, duration: 4, startTime: 1 });
  const result = planMixRender(makeProject({ bpm: 120, tracks: [makeTrack([warped])] }), everything, options());
  near(result.plan.endSeconds, 3);
});

test("꼬리: 켜진 리버브·딜레이의 가장 긴 꼬리가 더해지고, 꺼진 이펙트는 더하지 않는다", () => {
  const clip = makeClip({ duration: 2 });
  const withReverb = makeProject({ tracks: [makeTrack([clip], (track) => { enableEffect(track, "reverb"); track.reverb.decay = 3; track.reverb.preDelayMs = 100; })] });
  const result = planMixRender(withReverb, everything, options());
  near(result.plan.tailSeconds, 3.1);
  assert.equal(result.plan.frames, Math.ceil(5.1 * 44100));

  const reverbOff = makeProject({ tracks: [makeTrack([clip], (track) => { track.reverb.decay = 3; })] });
  near(planMixRender(reverbOff, everything, options()).plan.tailSeconds, 0);
});

test("진행 알림 시각: 2초마다, 렌더 퀀텀(128프레임) 단위, 끝에는 닿지 않는다", () => {
  const sampleRate = 44100;
  const marks = progressMarks(10 * sampleRate, sampleRate);
  assert.equal(marks.length, 4, "2·4·6·8초");
  for (const mark of marks) {
    const frame = mark * sampleRate;
    assert.equal(frame % RENDER_QUANTUM, 0, `${mark}초가 퀀텀 경계`);
  }
  near(marks[0], 88192 / sampleRate, "2초에 가장 가까운 퀀텀 경계(88200 → 88192)");
  assert.ok(marks.every((mark, index) => index === 0 || mark > marks[index - 1]));
  assert.deepEqual(progressMarks(1.5 * sampleRate, sampleRate), [], "2초보다 짧으면 알림 없음");
  assert.deepEqual(progressMarks(2 * sampleRate, sampleRate), [], "길이 끝에 닿는 시각은 거절되므로 넣지 않는다");
  const last = progressMarks(600 * sampleRate, sampleRate).at(-1);
  assert.ok(last * sampleRate + RENDER_QUANTUM < 600 * sampleRate);
});

test("리미터 선읽기 프레임: 44.1 kHz에서 221, 48 kHz에서 240, 리미터 계산부와 같은 값", () => {
  assert.equal(limiterLookaheadFrames(44100), 221);
  assert.equal(limiterLookaheadFrames(48000), 240);
  for (const rate of [44100, 48000, 22050, 96000]) {
    assert.equal(new LookaheadLimiter(rate).lookahead, limiterLookaheadFrames(rate), `${rate} Hz`);
  }
  assert.equal(limiterLookaheadFrames(100), 1, "아무리 낮아도 1프레임");
});

test("내보내기 옵션: 허용된 값만 남기고, 모르는 값은 기본값을 쓴다", () => {
  assert.deepEqual(DEFAULT_EXPORT_OPTIONS, { sampleRate: 44100, bitDepth: 16 });
  assert.deepEqual(normalizeExportOptions({ sampleRate: 48000, bitDepth: 24 }), { sampleRate: 48000, bitDepth: 24 });
  assert.deepEqual(normalizeExportOptions({ sampleRate: 96000, bitDepth: 32 }), DEFAULT_EXPORT_OPTIONS);
  assert.deepEqual(normalizeExportOptions("깨진 값"), DEFAULT_EXPORT_OPTIONS);
  assert.deepEqual(normalizeExportOptions(null, { sampleRate: 48000, bitDepth: 16 }), { sampleRate: 48000, bitDepth: 16 });
  assert.deepEqual(normalizeExportOptions({ bitDepth: 24 }, { sampleRate: 48000, bitDepth: 16 }), { sampleRate: 48000, bitDepth: 24 }, "한쪽만 있어도 나머지는 기본값");
  assert.equal(defaultSampleRateFor(48000), 48000);
  assert.equal(defaultSampleRateFor(44100), 44100);
  assert.equal(defaultSampleRateFor(22050), 44100);
  assert.equal(defaultSampleRateFor(undefined), 44100);
});

test("길이·크기 글자", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65.4), "1:05");
  assert.equal(formatDuration(185), "3:05");
  assert.equal(formatDuration(3601), "1:00:01");
  assert.equal(formatDuration(-3), "0:00");
  assert.equal(formatBytes(512), "1 KB");
  assert.equal(formatBytes(812 * 1024), "812 KB");
  assert.equal(formatBytes(31.8 * 1024 * 1024), "31.8 MB");
  assert.equal(formatBytes(1.5 * 1024 ** 3), "1.50 GB");
});
