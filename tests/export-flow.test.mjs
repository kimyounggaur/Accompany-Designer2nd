/**
 * 믹스 내보내기 흐름(app/exporting.ts)과 상태(state/exportStore.ts): 렌더·인코딩·내려받기는 가짜로 끼우고,
 * 진짜 저장소·안내·옵션 기억을 이어 본다.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";
import { makeClip, makeTrack, makeProject } from "./helpers/mix-project.mjs";

const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
  removeItem: (key) => { storage.delete(key); },
};
globalThis.window = { AudioContext: FakeContext, localStorage };

const exporting = await import("../src/app/exporting.ts");
const { useExportStore, isExportOpen } = await import("../src/state/exportStore.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");
const { useRecordingStore, DEFAULT_RECORDING_SETTINGS } = await import("../src/state/recordingStore.ts");
const { MixCancelledError } = await import("../src/audio/engine/mixErrors.ts");
const { EXPORT_OPTIONS_STORAGE_KEY, readExportOptions, writeExportOptions } = await import("../src/services/exportSettings.ts");

const flush = () => new Promise((resolve) => setImmediate(resolve));
const notices = () => useNoticeStore.getState().notices;
/** 가장 최근 안내 문구(상태 줄). 알림(toast)이 아닌 info 안내도 여기에는 남는다. */
const lastMessage = () => useNoticeStore.getState().statusMessage;

/** 렌더·인코딩·내려받기를 기록하는 가짜 부품 */
function fakeDeps(project = makeProject({ name: "내 곡 / 1" }), overrides = {}) {
  const log = { renders: [], encodes: [], downloads: [] };
  const deps = {
    snapshot: () => project,
    hasAudio: () => true,
    getBuffer: () => ({ duration: 10 }),
    render: async (request) => {
      log.renders.push(request);
      request.onProgress?.(0.5);
      request.onProgress?.(1);
      return { sampleRate: request.plan.options.sampleRate, frames: request.plan.frames, channels: [new Float32Array(4), new Float32Array(4)], trimmedFrames: 221, usedFallbackLimiter: false };
    },
    encode: async (channels, sampleRate, bitDepth) => {
      log.encodes.push({ channels, sampleRate, bitDepth });
      return new Blob(["wav"], { type: "audio/wav" });
    },
    download: (blob, fileName) => { log.downloads.push({ blob, fileName }); },
    ...overrides,
  };
  return { deps, log };
}

beforeEach(() => {
  exporting.resetExport();
  storage.clear();
  useNoticeStore.getState().reset();
  useRecordingStore.setState({ ...DEFAULT_RECORDING_SETTINGS });
  useRecordingStore.getState().resetForNewProject();
});

test("내려받는 파일 이름: 프로젝트 이름에서 파일에 못 쓰는 글자와 공백은 -로, 이름이 비면 project", () => {
  assert.equal(exporting.mixFileName("내 곡 / 1"), "내-곡-1-mix.wav");
  assert.equal(exporting.mixFileName('a:b*c?"d'), "a-b-c-d-mix.wav");
  assert.equal(exporting.mixFileName(""), "project-mix.wav");
});

test("옵션 기억: 처음엔 프로젝트 샘플레이트(48 kHz면 48 kHz)·16비트, 저장하면 그 값, 깨진 값은 처음 값", () => {
  assert.deepEqual(readExportOptions(44100), { sampleRate: 44100, bitDepth: 16 });
  assert.deepEqual(readExportOptions(48000), { sampleRate: 48000, bitDepth: 16 });
  writeExportOptions({ sampleRate: 48000, bitDepth: 24 });
  assert.deepEqual(readExportOptions(44100), { sampleRate: 48000, bitDepth: 24 });
  storage.set(EXPORT_OPTIONS_STORAGE_KEY, "{깨진 json");
  assert.deepEqual(readExportOptions(44100), { sampleRate: 44100, bitDepth: 16 });
  storage.set(EXPORT_OPTIONS_STORAGE_KEY, JSON.stringify({ sampleRate: 96000, bitDepth: 32 }));
  assert.deepEqual(readExportOptions(48000), { sampleRate: 48000, bitDepth: 16 }, "허용되지 않은 값은 처음 값");
});

test("열기: 내보낼 수 있으면 옵션 대화상자가 열리고, 기억한 옵션이 들어 있다", () => {
  writeExportOptions({ sampleRate: 48000, bitDepth: 24 });
  const { deps } = fakeDeps();
  exporting.openExportDialog(deps);
  assert.equal(useExportStore.getState().stage, "options");
  assert.deepEqual(useExportStore.getState().options, { sampleRate: 48000, bitDepth: 24 });
  assert.equal(isExportOpen(), true);
  assert.equal(notices().length, 0);
});

test("열기: 클립이 없으면 대화상자를 열지 않고 이유를 알린다", () => {
  const { deps } = fakeDeps(makeProject({ tracks: [makeTrack([])] }));
  exporting.openExportDialog(deps);
  assert.equal(isExportOpen(), false);
  assert.match(lastMessage(), /내보낼 클립이 없습니다/);
  assert.equal(notices().at(-1).level, "warning");
});

test("열기: 음원을 찾을 수 없으면 개수를 알리고, 1시간을 넘으면 알리며 열지 않는다", () => {
  const missing = fakeDeps(makeProject({ tracks: [makeTrack([makeClip({ audioBufferId: "a" }), makeClip({ audioBufferId: "b", startTime: 2 })])] }));
  exporting.openExportDialog({ ...missing.deps, hasAudio: () => false });
  assert.equal(isExportOpen(), false);
  assert.match(lastMessage(), /음원 2개/);
  assert.equal(notices().at(-1).level, "error");

  useNoticeStore.getState().reset();
  const long = fakeDeps(makeProject({ tracks: [makeTrack([makeClip({ startTime: 4000 })])] }));
  exporting.openExportDialog(long.deps);
  assert.equal(isExportOpen(), false);
  assert.match(lastMessage(), /1시간/);
});

test("열기: 녹음 중이면 열지 않고 알린다", () => {
  useRecordingStore.setState({ status: "recording" });
  exporting.openExportDialog(fakeDeps().deps);
  assert.equal(isExportOpen(), false);
  assert.match(lastMessage(), /녹음 중에는 믹스를 내보낼 수 없습니다/);
  assert.equal(notices().length, 0, "info 안내는 상태 줄에만 나온다");
});

test("옵션 바꾸기: 옵션 단계에서만 바뀌고, 이미 열려 있으면 다시 열어도 그대로", () => {
  const { deps } = fakeDeps();
  exporting.openExportDialog(deps);
  exporting.setExportOptions({ sampleRate: 48000, bitDepth: 24 });
  assert.deepEqual(useExportStore.getState().options, { sampleRate: 48000, bitDepth: 24 });
  exporting.openExportDialog(deps);
  assert.deepEqual(useExportStore.getState().options, { sampleRate: 48000, bitDepth: 24 }, "열린 대화상자를 건드리지 않는다");
  const planned = exporting.planCurrentExport({ sampleRate: 48000, bitDepth: 24 }, deps);
  assert.equal(planned.ok, true);
  assert.equal(planned.plan.frames, 48000 * 1, "1초짜리 클립 하나");
});

test("내보내기: 렌더 → 인코딩 → 내려받기 → 성공 안내 → 대화상자 닫힘, 고른 옵션을 기억한다", async () => {
  const { deps, log } = fakeDeps();
  exporting.openExportDialog(deps);
  exporting.setExportOptions({ sampleRate: 48000, bitDepth: 24 });
  const stages = [];
  const unsubscribe = useExportStore.subscribe((state) => stages.push(state.stage));
  await exporting.startExport(deps);
  unsubscribe();

  assert.equal(log.renders.length, 1);
  assert.equal(log.renders[0].plan.options.sampleRate, 48000);
  assert.equal(log.renders[0].plan.frames, 48000);
  assert.deepEqual(log.encodes.map(({ sampleRate, bitDepth }) => [sampleRate, bitDepth]), [[48000, 24]]);
  assert.deepEqual(log.downloads.map(({ fileName }) => fileName), ["내-곡-1-mix.wav"]);
  assert.equal(log.downloads[0].blob.type, "audio/wav");
  assert.match(lastMessage(), /저장했습니다/);
  assert.equal(notices().at(-1).level, "success");
  assert.equal(isExportOpen(), false);
  assert.ok(stages.includes("rendering") && stages.includes("encoding"), `단계: ${stages}`);
  assert.ok(stages.indexOf("rendering") < stages.indexOf("encoding"));
  assert.deepEqual(readExportOptions(44100), { sampleRate: 48000, bitDepth: 24 });
});

test("진행률: 렌더가 알린 값이 저장소에 쌓인다(0~1 안으로 자른다)", async () => {
  const seen = [];
  const { deps } = fakeDeps(undefined, {
    render: async (request) => {
      for (const value of [0.25, 1.4, -0.2]) {
        request.onProgress(value);
        seen.push(useExportStore.getState().progress);
      }
      return { sampleRate: 44100, frames: 1, channels: [new Float32Array(1), new Float32Array(1)], trimmedFrames: 0, usedFallbackLimiter: false };
    },
  });
  exporting.openExportDialog(deps);
  await exporting.startExport(deps);
  assert.deepEqual(seen, [0.25, 1, 0]);
  assert.equal(useExportStore.getState().progress, 0, "닫히면 처음으로");
});

test("취소: 렌더 중 취소하면 파일이 생기지 않고 '취소했습니다'만 알린다", async () => {
  let release;
  const { deps, log } = fakeDeps(undefined, {
    render: (request) => new Promise((_, reject) => {
      release = () => reject(new MixCancelledError());
      request.signal.addEventListener("abort", release, { once: true });
    }),
  });
  exporting.openExportDialog(deps);
  const done = exporting.startExport(deps);
  await flush();
  assert.equal(useExportStore.getState().stage, "rendering");
  exporting.cancelExport();
  assert.equal(useExportStore.getState().cancelling, true, "취소하는 중 표시");
  await done;
  assert.equal(log.downloads.length, 0);
  assert.equal(log.encodes.length, 0);
  assert.match(lastMessage(), /취소했습니다/);
  assert.equal(notices().length, 0, "취소는 상태 줄에만 알린다(오류 알림이 아니다)");
  assert.equal(isExportOpen(), false);
});

test("취소: 인코딩 중에 취소해도 파일이 생기지 않는다", async () => {
  const { deps, log } = fakeDeps(undefined, {
    encode: (channels, sampleRate, bitDepth, signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new MixCancelledError()), { once: true });
    }),
  });
  exporting.openExportDialog(deps);
  const done = exporting.startExport(deps);
  await flush();
  assert.equal(useExportStore.getState().stage, "encoding");
  exporting.cancelExport();
  await done;
  assert.equal(log.downloads.length, 0);
  assert.match(lastMessage(), /취소했습니다/);
});

test("취소: 인코딩이 이미 끝난 뒤 신호가 와도 내려받지 않는다", async () => {
  let controller;
  const { deps, log } = fakeDeps(undefined, {
    encode: async (channels, sampleRate, bitDepth, signal) => {
      controller = signal;
      exporting.cancelExport();
      return new Blob(["wav"]);
    },
  });
  exporting.openExportDialog(deps);
  await exporting.startExport(deps);
  assert.equal(controller.aborted, true);
  assert.equal(log.downloads.length, 0);
  assert.match(lastMessage(), /취소했습니다/);
});

test("취소: 옵션을 고르는 중이면 그냥 닫는다(아무것도 렌더하지 않았다)", () => {
  const { deps, log } = fakeDeps();
  exporting.openExportDialog(deps);
  exporting.cancelExport();
  assert.equal(isExportOpen(), false);
  assert.equal(log.renders.length, 0);
  assert.equal(notices().length, 0);
});

test("실패: 렌더가 던지면 오류로 알리고 대화상자를 닫는다", async () => {
  const { deps, log } = fakeDeps(undefined, { render: async () => { throw new Error("믹스를 담을 메모리를 확보하지 못했습니다."); } });
  exporting.openExportDialog(deps);
  await exporting.startExport(deps);
  assert.equal(log.downloads.length, 0);
  assert.equal(notices().at(-1).level, "error");
  assert.match(lastMessage(), /믹스 저장 실패/);
  assert.match(lastMessage(), /메모리/);
  assert.equal(isExportOpen(), false);
});

test("실패: 시작하는 순간 문서가 내보낼 수 없는 상태가 되었으면(음원 사라짐) 렌더 없이 알리고 닫는다", async () => {
  let available = true;
  const { deps, log } = fakeDeps(undefined, { hasAudio: () => available });
  exporting.openExportDialog(deps);
  available = false;
  await exporting.startExport(deps);
  assert.equal(log.renders.length, 0);
  assert.match(lastMessage(), /음원 1개/);
  assert.equal(isExportOpen(), false);
});

test("시작은 한 번만: 옵션 단계가 아니거나 이미 진행 중이면 무시한다", async () => {
  const { deps, log } = fakeDeps();
  await exporting.startExport(deps);
  assert.equal(log.renders.length, 0, "열지 않았으면 아무 일도 없다");

  let release;
  const pending = fakeDeps(undefined, { render: (request) => new Promise((resolve) => { release = () => resolve({ sampleRate: 44100, frames: 1, channels: [new Float32Array(1), new Float32Array(1)], trimmedFrames: 0, usedFallbackLimiter: false }); }) });
  exporting.openExportDialog(pending.deps);
  const first = exporting.startExport(pending.deps);
  await flush();
  await exporting.startExport(pending.deps);
  release();
  await first;
  assert.equal(pending.log.downloads.length, 1, "내려받기는 한 번");
});

test("화면 정리(resetExport): 진행 중인 내보내기를 멈추고 대화상자를 닫는다", async () => {
  const { deps } = fakeDeps(undefined, {
    render: (request) => new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new MixCancelledError()), { once: true })),
  });
  exporting.openExportDialog(deps);
  const done = exporting.startExport(deps);
  await flush();
  exporting.resetExport();
  await done;
  assert.equal(isExportOpen(), false);
});
