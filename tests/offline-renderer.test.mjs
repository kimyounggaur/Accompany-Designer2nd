import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeOfflineContext, Source } from "./helpers/fake-audio.mjs";
import { makeClip, makeTrack, makeProject, enableEffect } from "./helpers/mix-project.mjs";

const { renderOfflineMix, COPY_CHUNK_FRAMES } = await import("../src/audio/engine/OfflineRenderer.ts");
const { planMixRender, progressMarks } = await import("../src/audio/engine/mixPlan.ts");
const { MixCancelledError } = await import("../src/audio/engine/mixErrors.ts");
const { dbToGain } = await import("../src/domain/master/volume.ts");

const options = (sampleRate = 44100, bitDepth = 16) => ({ sampleRate, bitDepth });
const buffer = (seconds = 10) => ({ duration: seconds, length: seconds * 44100, numberOfChannels: 2, sampleRate: 44100 });
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** 시험용 렌더 환경: 가짜 오프라인 컨텍스트와 가짜 리미터를 끼운다 */
function setup(project, { sampleRate = 44100, buffers = () => buffer(), limiter = "worklet", requestOptions = {} } = {}) {
  const planned = planMixRender(project, () => true, options(sampleRate));
  assert.equal(planned.ok, true, "시험 프로젝트는 내보낼 수 있어야 한다");
  const made = { contexts: [], limiters: [], impulses: 0 };
  const deps = {
    createContext: (channels, length, rate) => {
      const context = new FakeOfflineContext(channels, length, rate);
      made.contexts.push(context);
      return context;
    },
    createLimiter: async (context) => {
      if (limiter === "fail") throw new Error("워크렛을 올릴 수 없다");
      const node = context.createGain();
      const handle = { input: node, output: node, latencySeconds: 0.005, disposed: false, onReduction() {}, dispose() { handle.disposed = true; } };
      made.limiters.push(handle);
      return handle;
    },
    makeImpulse: (context) => { made.impulses += 1; return { duration: 1, length: 1, numberOfChannels: 2, sampleRate: context.sampleRate }; },
  };
  const request = { project, plan: planned.plan, getBuffer: (id) => buffers(id), ...requestOptions };
  return { request, deps, made, plan: planned.plan };
}

const quiet = async (action) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await action(); } finally { console.warn = warn; }
};

test("컨텍스트는 파일 길이 + 리미터 선읽기(221프레임)만큼 만들고, 스테레오로 만든다", async () => {
  const project = makeProject({ tracks: [makeTrack([makeClip({ startTime: 1, duration: 3 })])] });
  const { request, deps, made, plan } = setup(project);
  await renderOfflineMix(request, deps);
  assert.equal(made.contexts.length, 1);
  assert.equal(made.contexts[0].numberOfChannels, 2);
  assert.equal(made.contexts[0].length, plan.frames + 221);
  assert.equal(made.contexts[0].sampleRate, 44100);

  const studio = setup(project, { sampleRate: 48000 });
  await renderOfflineMix(studio.request, studio.deps);
  assert.equal(studio.made.contexts[0].length, studio.plan.frames + 240, "48 kHz에서는 240프레임");
  assert.equal(studio.plan.frames, 4 * 48000);
});

test("재생과 같은 소리 길: 클립마다 소리 소스 하나(시작·음원 위치·길이), 소리 낼 클립이 있는 트랙만 소리 길을 만든다", async () => {
  Source.starts = [];
  const sound = makeTrack([makeClip({ id: "a", startTime: 1, duration: 3 }), makeClip({ id: "b", startTime: 5, offset: 2, duration: 2 }), makeClip({ id: "muted", startTime: 0, muted: true }), makeClip({ id: "rec", isRecording: true })]);
  const empty = makeTrack([]);
  const project = makeProject({ tracks: [sound, empty] });
  const { request, deps, made } = setup(project);
  await renderOfflineMix(request, deps);
  const context = made.contexts[0];
  assert.deepEqual(Source.starts.map((source) => source.started), [[1, 0, 3], [5, 2, 2]], "꺼진 클립·녹음 클립은 소리 소스를 만들지 않는다");
  // 분석기: 마스터 길 1개 + 소리 길이 있는 트랙 1개
  assert.equal(context.all("analyser").length, 2);
});

test("음원 버퍼가 없으면 렌더 도중 이상한 결과 대신 오류로 끝난다", async () => {
  const project = makeProject({ tracks: [makeTrack([makeClip()])] });
  const { request, deps, made } = setup(project, { buffers: () => undefined });
  await assert.rejects(renderOfflineMix(request, deps), /음원을 찾을 수 없습니다/);
  assert.equal(made.limiters[0].disposed, true, "오류가 나도 소리 길은 정리한다");
});

test("리미터가 5 ms 늦춘 앞부분을 잘라 낸다: 파일의 첫 샘플이 곡 0초에 해당한다", async () => {
  const project = makeProject({ tracks: [makeTrack([makeClip({ startTime: 0, duration: 2 })])] });
  const { request, deps, plan } = setup(project);
  const mix = await renderOfflineMix(request, deps);
  assert.equal(mix.frames, plan.frames);
  assert.equal(mix.trimmedFrames, 221);
  assert.equal(mix.usedFallbackLimiter, false);
  assert.equal(mix.channels.length, 2);
  assert.equal(mix.channels[0].length, plan.frames);
  // 가짜 결과는 프레임 번호로 채워져 있다: 221번째부터 가져왔다면 첫 값이 221
  assert.equal(mix.channels[0][0], 221);
  assert.equal(mix.channels[1][plan.frames - 1], 221 + plan.frames - 1, "마지막 프레임까지 빠짐없이");
});

test("결과 복사는 덩어리(1,048,576 프레임)로 나뉘어도 이음매 없이 이어진다", async () => {
  const project = makeProject({ tracks: [makeTrack([makeClip({ startTime: 0, duration: 30 })])] });
  const { request, deps, made, plan } = setup(project, { buffers: () => buffer(30) });
  const mix = await renderOfflineMix(request, deps);
  assert.ok(plan.frames > COPY_CHUNK_FRAMES, "시험 곡이 덩어리 하나보다 길다");
  const { copies } = made.contexts[0];
  assert.deepEqual(copies.map((copy) => copy.channel), [0, 0, 1, 1], "채널마다 덩어리 둘");
  assert.deepEqual(copies.map((copy) => copy.frames), [COPY_CHUNK_FRAMES, plan.frames - COPY_CHUNK_FRAMES, COPY_CHUNK_FRAMES, plan.frames - COPY_CHUNK_FRAMES]);
  assert.deepEqual(copies.map((copy) => copy.offset), [221, 221 + COPY_CHUNK_FRAMES, 221, 221 + COPY_CHUNK_FRAMES], "앞 221프레임(리미터 지연)은 건너뛴다");
  for (const channel of mix.channels) {
    assert.equal(channel.length, plan.frames);
    for (const frame of [0, COPY_CHUNK_FRAMES - 1, COPY_CHUNK_FRAMES, COPY_CHUNK_FRAMES + 1, plan.frames - 1]) {
      assert.equal(channel[frame], 221 + frame, `${frame}번째 프레임`);
    }
  }
});

test("결과를 가져오는 중에 취소하면 더 가져가지 않고 취소로 끝난다", async () => {
  const controller = new AbortController();
  const project = makeProject({ tracks: [makeTrack([makeClip({ startTime: 0, duration: 30 })])] });
  const { request, deps, made } = setup(project, { buffers: () => buffer(30), requestOptions: { signal: controller.signal } });
  const createContext = deps.createContext;
  deps.createContext = (channels, length, rate) => {
    const context = createContext(channels, length, rate);
    const startRendering = context.startRendering.bind(context);
    context.startRendering = async () => {
      const result = await startRendering();
      const copyFromChannel = result.copyFromChannel;
      result.copyFromChannel = (...args) => {
        copyFromChannel(...args);
        controller.abort(); // 첫 덩어리를 가져온 직후 취소
      };
      return result;
    };
    return context;
  };
  await assert.rejects(renderOfflineMix(request, deps), (error) => error instanceof MixCancelledError);
  assert.equal(made.contexts[0].copies.length, 1, "첫 덩어리만 가져오고 멈춘다");
});

test("워크렛 리미터를 못 올려 압축기로 대신했으면(지연 0) 앞을 자르지 않는다", async () => {
  const project = makeProject({ tracks: [makeTrack([makeClip({ duration: 2 })])] });
  const { request, deps, plan } = setup(project, { limiter: "fail" });
  const mix = await quiet(() => renderOfflineMix(request, deps));
  assert.equal(mix.usedFallbackLimiter, true);
  assert.equal(mix.trimmedFrames, 0);
  assert.equal(mix.channels[0][0], 0);
  assert.equal(mix.channels[0].length, plan.frames);
});

test("진행률: 2초 분량마다 올라가고 마지막에 1이 된다", async () => {
  const project = makeProject({ tracks: [makeTrack([makeClip({ duration: 9 })])] });
  const seen = [];
  const { request, deps, made, plan } = setup(project, { buffers: () => buffer(10), requestOptions: { onProgress: (value) => seen.push(value) } });
  await renderOfflineMix(request, deps);
  const marks = progressMarks(plan.frames + 221, 44100);
  assert.ok(marks.length >= 4);
  assert.equal(seen.length, marks.length + 1, "멈춤마다 한 번 + 끝");
  assert.deepEqual(made.contexts[0].reached, marks, "예약한 시각마다 멈췄다");
  assert.ok(seen.every((value, index) => index === 0 || value > seen[index - 1]), "늘어나기만 한다");
  assert.ok(seen[0] > 0 && seen[0] < 0.3);
  assert.equal(seen.at(-1), 1);
  assert.equal(made.contexts[0].resumes, marks.length, "멈출 때마다 다시 이어 갔다");
});

test("취소하면 곧바로 취소로 끝나고, 더 알리지 않고, 파일 데이터를 만들지 않는다", async () => {
  const project = makeProject({ tracks: [makeTrack([makeClip({ duration: 9 })])] });
  const controller = new AbortController();
  const seen = [];
  const { request, deps, made } = setup(project, {
    buffers: () => buffer(10),
    requestOptions: { signal: controller.signal, onProgress: (value) => { seen.push(value); if (seen.length === 1) controller.abort(); } },
  });
  await assert.rejects(renderOfflineMix(request, deps), (error) => error instanceof MixCancelledError);
  await flush();
  await flush();
  assert.equal(seen.length, 1, "취소한 뒤에는 진행을 알리지 않는다");
  assert.equal(made.limiters[0].disposed, true, "소리 길을 끊는다");
  const context = made.contexts[0];
  assert.deepEqual(context.copies, [], "결과를 가져가지 않는다");
  assert.equal(context.completed, true, "남은 구간은 빈 그래프로 끝까지 돌려 자원이 돌아온다");
});

test("시작하기 전에 이미 취소됐으면 컨텍스트도 만들지 않는다", async () => {
  const controller = new AbortController();
  controller.abort();
  const { request, deps, made } = setup(makeProject(), { requestOptions: { signal: controller.signal } });
  await assert.rejects(renderOfflineMix(request, deps), (error) => error instanceof MixCancelledError);
  assert.equal(made.contexts.length, 0);
});

test("소리 길을 만드는 동안(리미터를 기다리는 사이) 취소해도 정리하고 취소로 끝난다", async () => {
  const controller = new AbortController();
  const project = makeProject();
  const { request, deps, made } = setup(project, { requestOptions: { signal: controller.signal } });
  const createLimiter = deps.createLimiter;
  deps.createLimiter = async (context) => {
    const handle = await createLimiter(context);
    controller.abort();
    return handle;
  };
  await assert.rejects(renderOfflineMix(request, deps), (error) => error instanceof MixCancelledError);
  assert.equal(made.limiters[0].disposed, true);
  assert.equal(made.contexts[0].marks.length, 0, "렌더는 시작하지도 않았다");
});

test("끝나면 리미터와 소리 길을 정리한다", async () => {
  const { request, deps, made } = setup(makeProject());
  await renderOfflineMix(request, deps);
  assert.equal(made.limiters[0].disposed, true);
});

test("마스터 볼륨은 문서 값을 그대로 쓴다(없으면 0 dB)", async () => {
  const quieter = setup(makeProject({ master: { volumeDb: -6 } }));
  await renderOfflineMix(quieter.request, quieter.deps);
  const gains = (made) => made.contexts[0].all("gain").flatMap((node) => node.gain.assigned);
  assert.ok(gains(quieter.made).some((value) => Math.abs(value - dbToGain(-6)) < 1e-12), "−6 dB 게인");

  const plain = setup(makeProject());
  await renderOfflineMix(plain.request, plain.deps);
  assert.ok(!gains(plain.made).some((value) => Math.abs(value - dbToGain(-6)) < 1e-12));
});

test("솔로가 있으면 솔로가 아닌 트랙은 소리 크기 0으로 시작한다(재생과 같은 규칙)", async () => {
  const loud = makeTrack([makeClip({ startTime: 0 })], (track) => { track.volume = 0.7; track.solo = true; });
  const other = makeTrack([makeClip({ startTime: 0 })], (track) => { track.volume = 0.3; });
  const withSolo = setup(makeProject({ tracks: [loud, other] }));
  await renderOfflineMix(withSolo.request, withSolo.deps);
  const levels = (made) => made.contexts[0].all("gain").map((node) => node.gain.assigned).filter((assigned) => assigned.length === 1).map(([value]) => value);
  assert.ok(levels(withSolo.made).includes(0.7), "솔로 트랙은 자기 볼륨");
  assert.ok(!levels(withSolo.made).includes(0.3), "솔로가 아닌 트랙은 0으로 눌린다");

  const unsoloed = makeTrack([makeClip({ startTime: 0 })], (track) => { track.volume = 0.7; });
  const noSolo = setup(makeProject({ tracks: [unsoloed, other] }));
  await renderOfflineMix(noSolo.request, noSolo.deps);
  assert.ok(levels(noSolo.made).includes(0.7) && levels(noSolo.made).includes(0.3), "솔로가 없으면 둘 다 자기 볼륨");
});

test("리버브가 켜진 트랙은 잔향을 만들어 오프라인 컨텍스트에 붙인다", async () => {
  const wet = makeTrack([makeClip({ duration: 1 })], (track) => { enableEffect(track, "reverb"); track.reverb.decay = 1; });
  const { request, deps, made, plan } = setup(makeProject({ tracks: [wet] }));
  await renderOfflineMix(request, deps);
  assert.equal(made.impulses, 1);
  assert.equal(made.contexts[0].all("convolver").length, 1);
  assert.ok(plan.tailSeconds > 1, "꼬리가 길이에 들어 있다");
  assert.equal(made.contexts[0].length, plan.frames + 221);
});
