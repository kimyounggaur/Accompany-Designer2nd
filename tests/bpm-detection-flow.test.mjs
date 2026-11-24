/**
 * BPM 감지 흐름(app/bpmDetection.ts + state/bpmStore.ts, 설계서 §P4-4, 보고서 B5):
 * 진행률 → 결과(×½·×2 고침, 클립/프로젝트에 적용) · 그만두기 · 다시 시작 · 클립이 지워졌을 때 결과 버리기.
 * 분석기(Worker)는 가짜로 끼우고 문서 저장소·안내·이력은 진짜를 쓴다.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";
import { makeDoc } from "./helpers/docs.mjs";

globalThis.window = {
  AudioContext: FakeContext,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};

const { useDawStore } = await import("../src/store/useDawStore.ts");
const { getDoc } = await import("../src/state/projectStore.ts");
const { history } = await import("../src/state/history.ts");
const { useBpmStore } = await import("../src/state/bpmStore.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");
const { BpmCancelledError } = await import("../src/audio/bpmAnalyzer.ts");
const { ko } = await import("../src/i18n/ko.ts");
const detection = await import("../src/app/bpmDetection.ts");

const flush = () => new Promise((resolve) => setImmediate(resolve));
const state = () => useBpmStore.getState().detection;
const asset = () => getDoc().assets.asset;
const clipOf = (id) => getDoc().tracks.flatMap((track) => track.clips).find((clip) => clip.id === id);

const BUFFER = { sampleRate: 44100, length: 44100 * 20, getChannelData: () => new Float32Array(1) };

/** 시험이 풀어 주는 가짜 분석기. 부른 기록(source·signal)과 진행률·결과를 시험이 정한다. */
function controlledAnalyzer() {
  const calls = [];
  const analyze = (source, options = {}) =>
    new Promise((resolve, reject) => {
      const call = {
        source,
        signal: options.signal,
        progress: (value) => options.onProgress?.(value),
        resolve,
        reject,
      };
      options.signal?.addEventListener("abort", () => reject(new BpmCancelledError()), { once: true });
      calls.push(call);
    });
  return { analyze, calls };
}

function depsWith(analyzer, buffer = BUFFER) {
  return { getBuffer: (id) => (id === "asset" ? buffer : undefined), analyze: analyzer.analyze };
}

beforeEach(() => {
  detection.resetBpmDetection();
  useNoticeStore.getState().reset();
  const doc = makeDoc([0, 2]);
  doc.assets = { asset: { id: "asset", fileName: "반주.wav", duration: 20, sampleRate: 44100, channels: 1, source: "upload" } };
  useDawStore.getState().importProject(doc);
  history.clear();
});

test("감지하면 진행률이 오르고 결과가 나오며, 음원에 감지값을 기록하되 실행 취소 기록에는 남기지 않는다", async () => {
  const analyzer = controlledAnalyzer();
  const started = detection.startBpmDetection("c0", depsWith(analyzer));
  await flush();

  assert.deepEqual(state(), { status: "running", clipId: "c0", progress: 0 });
  assert.equal(analyzer.calls.length, 1);
  assert.equal(analyzer.calls[0].source, BUFFER, "음원의 소리 데이터를 분석기에 준다");

  analyzer.calls[0].progress(0.3);
  assert.deepEqual(state(), { status: "running", clipId: "c0", progress: 0.3 });
  analyzer.calls[0].progress(0.8);
  assert.equal(state().progress, 0.8);

  analyzer.calls[0].resolve(123.5);
  await started;
  assert.deepEqual(state(), { status: "done", clipId: "c0", detected: 123.5, value: 123.5 });
  assert.equal(asset().detectedBpm, 123.5);
  assert.equal(history.depth().undo, 0, "감지값 기록은 실행 취소 대상이 아니다");
});

test("박자를 못 찾으면 이유를 남긴다(결과·기록 없음)", async () => {
  const analyzer = controlledAnalyzer();
  const started = detection.startBpmDetection("c0", depsWith(analyzer));
  await flush();
  analyzer.calls[0].resolve(undefined);
  await started;
  assert.deepEqual(state(), { status: "failed", clipId: "c0", message: ko.clip.bpm.unstable });
  assert.equal(asset().detectedBpm, undefined);
});

test("분석기가 실패하면 실패 이유를 남기고 다시 시작할 수 있다", async () => {
  const analyzer = controlledAnalyzer();
  const started = detection.startBpmDetection("c0", depsWith(analyzer));
  await flush();
  analyzer.calls[0].reject(new Error("worker crashed"));
  await started;
  assert.deepEqual(state(), { status: "failed", clipId: "c0", message: ko.clip.bpm.failed });

  const again = detection.startBpmDetection("c0", depsWith(analyzer));
  await flush();
  assert.equal(state().status, "running");
  analyzer.calls[1].resolve(90);
  await again;
  assert.equal(state().status, "done");
});

test("소리 데이터가 없는 클립은 분석기를 부르지 않고 이유를 남긴다", async () => {
  const analyzer = controlledAnalyzer();
  await detection.startBpmDetection("c0", { getBuffer: () => undefined, analyze: analyzer.analyze });
  assert.deepEqual(state(), { status: "failed", clipId: "c0", message: ko.clip.bpm.noBuffer });
  assert.equal(analyzer.calls.length, 0);
});

test("없는 클립이면 아무것도 하지 않는다", async () => {
  const analyzer = controlledAnalyzer();
  await detection.startBpmDetection("없는 클립", depsWith(analyzer));
  assert.deepEqual(state(), { status: "idle" });
  assert.equal(analyzer.calls.length, 0);
});

test("그만두기: 분석기의 signal이 끊기고 상태는 '취소됨'이며, 그 뒤 도착한 진행률·결과는 무시한다", async () => {
  const analyzer = controlledAnalyzer();
  const started = detection.startBpmDetection("c0", depsWith(analyzer));
  await flush();
  analyzer.calls[0].progress(0.4);

  detection.cancelBpmDetection();
  assert.equal(analyzer.calls[0].signal.aborted, true);
  assert.deepEqual(state(), { status: "cancelled", clipId: "c0" });
  analyzer.calls[0].progress(0.9);
  analyzer.calls[0].resolve(100);
  await started;
  assert.deepEqual(state(), { status: "cancelled", clipId: "c0" });
  assert.equal(asset().detectedBpm, undefined, "그만둔 뒤에는 감지값을 기록하지 않는다");
});

test("돌고 있는 것이 없을 때 그만두기는 아무것도 바꾸지 않는다", () => {
  detection.cancelBpmDetection();
  assert.deepEqual(state(), { status: "idle" });
});

test("다시 시작하면 돌던 감지를 그만두고 새 감지의 결과만 쓴다", async () => {
  const analyzer = controlledAnalyzer();
  const first = detection.startBpmDetection("c0", depsWith(analyzer));
  await flush();
  const second = detection.startBpmDetection("c1", depsWith(analyzer));
  await flush();

  assert.equal(analyzer.calls[0].signal.aborted, true, "먼저 돌던 것은 그만둔다");
  assert.deepEqual(state(), { status: "running", clipId: "c1", progress: 0 });
  analyzer.calls[0].progress(0.9);
  assert.equal(state().progress, 0, "먼저 돌던 것의 진행률은 무시한다");

  analyzer.calls[1].resolve(101);
  await Promise.all([first, second]);
  assert.deepEqual(state(), { status: "done", clipId: "c1", detected: 101, value: 101 });
});

test("분석하는 사이 클립이 지워지면 결과를 버린다(기록도 표시도 없음)", async () => {
  const analyzer = controlledAnalyzer();
  const started = detection.startBpmDetection("c0", depsWith(analyzer));
  await flush();
  useDawStore.getState().deleteClip("c0");
  analyzer.calls[0].resolve(120);
  await started;
  assert.deepEqual(state(), { status: "idle" });
  assert.equal(asset().detectedBpm, undefined);
});

test("프로젝트를 새로 열면(resetBpmDetection) 돌던 감지를 그만두고 표시를 지운다", async () => {
  const analyzer = controlledAnalyzer();
  const started = detection.startBpmDetection("c0", depsWith(analyzer));
  await flush();
  detection.resetBpmDetection();
  assert.equal(analyzer.calls[0].signal.aborted, true);
  assert.deepEqual(state(), { status: "idle" });
  analyzer.calls[0].resolve(110);
  await started;
  assert.deepEqual(state(), { status: "idle" });
});

// ───── ×½ · ×2 빠른 고침 ─────

async function detected(value, clipId = "c0") {
  const analyzer = controlledAnalyzer();
  const started = detection.startBpmDetection(clipId, depsWith(analyzer));
  await flush();
  analyzer.calls[0].resolve(value);
  await started;
}

test("×½: 두 배로 잘못 감지된 값을 절반으로 고친다(음원의 감지값도 같이)", async () => {
  await detected(240);
  detection.scaleBpmSuggestion(0.5);
  assert.deepEqual(state(), { status: "done", clipId: "c0", detected: 240, value: 120 });
  assert.equal(asset().detectedBpm, 120);
});

test("×2: 절반으로 잘못 감지된 값을 두 배로 고친다", async () => {
  await detected(61.5);
  detection.scaleBpmSuggestion(2);
  assert.equal(state().value, 123);
  assert.equal(asset().detectedBpm, 123);
});

test("×½와 ×2를 거듭 눌러도 소수 첫째 자리로 맞춘다", async () => {
  await detected(87.3);
  detection.scaleBpmSuggestion(2);
  assert.equal(state().value, 174.6);
  detection.scaleBpmSuggestion(0.5);
  assert.equal(state().value, 87.3);
  assert.equal(state().detected, 87.3, "처음 감지한 값은 그대로 남는다");
});

test("고친 결과가 BPM 범위(20~300)를 벗어나면 누르지 못하고 눌러도 아무것도 하지 않는다", async () => {
  assert.equal(detection.canScaleBpmSuggestion(150, 2), true, "300까지는 된다");
  assert.equal(detection.canScaleBpmSuggestion(150.1, 2), false);
  assert.equal(detection.canScaleBpmSuggestion(40, 0.5), true, "20까지는 된다");
  assert.equal(detection.canScaleBpmSuggestion(39.9, 0.5), true, "19.95는 소수 첫째 자리로 맞추면 20");
  assert.equal(detection.canScaleBpmSuggestion(39.8, 0.5), false);

  await detected(200);
  detection.scaleBpmSuggestion(2);
  assert.equal(state().value, 200, "400은 범위 밖이라 그대로");
  assert.equal(asset().detectedBpm, 200);
});

test("결과가 없을 때(감지 전·실패·취소) ×½·×2는 아무것도 하지 않는다", () => {
  detection.scaleBpmSuggestion(2);
  assert.deepEqual(state(), { status: "idle" });
});

// ───── 적용 ─────

test("[클립 원본 BPM에 적용]: 화면에 보이는 값(고친 값)을 그 클립의 원본 BPM으로 쓰고 상태 줄에 알린다", async () => {
  await detected(240);
  detection.scaleBpmSuggestion(0.5);
  detection.applyBpmToClip();
  assert.equal(clipOf("c0").sourceBpm, 120);
  assert.equal(clipOf("c1").sourceBpm, 120, "다른 클립은 건드리지 않는다(둘 다 원래 120이라 값만 확인)");
  assert.equal(useNoticeStore.getState().statusMessage, ko.clip.bpm.appliedToClip(120));
});

test("[클립 원본 BPM에 적용]: 값이 다르면 그 클립만 바뀐다", async () => {
  await detected(97.5);
  detection.applyBpmToClip();
  assert.equal(clipOf("c0").sourceBpm, 97.5);
  assert.equal(clipOf("c1").sourceBpm, 120);
  assert.equal(history.depth().undo, 1, "적용은 사용자가 한 편집이라 실행 취소로 되돌릴 수 있다");
  useDawStore.getState().undo();
  assert.equal(clipOf("c0").sourceBpm, 120);
});

test("[프로젝트 템포에 적용]: 프로젝트 템포를 바꾸고 상태 줄에 알린다", async () => {
  await detected(96);
  detection.applyBpmToProject();
  assert.equal(getDoc().bpm, 96);
  assert.equal(useNoticeStore.getState().statusMessage, ko.clip.bpm.appliedToProject(96));
});

test("결과가 없으면 적용은 아무것도 하지 않고, 분석하는 사이 지워진 클립에는 적용하지 않는다", async () => {
  detection.applyBpmToClip();
  detection.applyBpmToProject();
  assert.equal(getDoc().bpm, 120);
  assert.equal(history.depth().undo, 0);

  await detected(100);
  useDawStore.getState().deleteClip("c0");
  history.clear();
  detection.applyBpmToClip();
  assert.equal(history.depth().undo, 0, "지워진 클립이면 아무 편집도 하지 않는다");
});
