import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNT_IN_BEATS_MAX,
  DEFAULT_RECORDING_SETTINGS,
  IDLE_PROGRESS,
  isCapturing,
  isRecordingBusy,
  useRecordingStore,
} from "../src/state/recordingStore.ts";
import { LATENCY_OFFSET_STORAGE_KEY, readLatencyOffsetMs, writeLatencyOffsetMs } from "../src/services/recordingSettings.ts";

const store = () => useRecordingStore.getState();

beforeEach(() => {
  useRecordingStore.setState({ ...DEFAULT_RECORDING_SETTINGS });
  store().resetForNewProject();
});

test("처음 상태: 쉬는 중이고, 녹음 대기 트랙·모니터·메트로놈·카운트인·지연 보정은 모두 꺼짐(0)이다", () => {
  assert.equal(store().status, "idle");
  assert.equal(store().armedTrackId, undefined);
  assert.equal(store().monitoringEnabled, false);
  assert.equal(store().metronomeEnabled, false);
  assert.equal(store().countInBeats, 0);
  assert.equal(store().latencyOffsetMs, 0);
  assert.equal(store().elapsed, 0);
  assert.deepEqual(store().waveformPeaks, []);
});

test("녹음 대기: 같은 트랙을 또 누르면 풀리고, 다른 트랙을 누르면 옮겨 간다", () => {
  assert.deepEqual(store().toggleArm("a"), { ok: true, armed: true });
  assert.equal(store().armedTrackId, "a");
  assert.deepEqual(store().toggleArm("b"), { ok: true, armed: true });
  assert.equal(store().armedTrackId, "b");
  assert.deepEqual(store().toggleArm("b"), { ok: true, armed: false });
  assert.equal(store().armedTrackId, undefined);
});

test("녹음 흐름이 진행 중이면(준비·카운트인·녹음·저장) 녹음 대기를 바꿀 수 없다", () => {
  store().toggleArm("a");
  for (const status of ["preparing", "counting-in", "recording", "stopping"]) {
    store().setProgress({ status });
    const result = store().toggleArm("b");
    assert.equal(result.ok, false, status);
    assert.equal(result.reason, "recording", status);
    assert.equal(store().armedTrackId, "a", `${status}: 그대로`);
  }
});

test("disarmTrack: 지운 트랙이 녹음 대기 중이었을 때만 푼다", () => {
  store().toggleArm("a");
  store().disarmTrack("other");
  assert.equal(store().armedTrackId, "a");
  store().disarmTrack("a");
  assert.equal(store().armedTrackId, undefined);
});

test("진행 값은 일부만 바꾸고, resetProgress는 설정을 건드리지 않고 처음으로 돌린다", () => {
  store().setCountIn(4);
  store().setMetronome(true);
  store().toggleArm("a");
  store().setProgress({ status: "recording", trackId: "a", startedAtProjectTime: 2, elapsed: 1.5, waveformPeaks: [0.2, 0.4] });
  assert.equal(store().status, "recording");
  assert.equal(store().trackId, "a");
  assert.deepEqual(store().waveformPeaks, [0.2, 0.4]);
  store().setProgress({ elapsed: 2 });
  assert.equal(store().status, "recording", "다른 값은 그대로");

  store().resetProgress();
  assert.deepEqual(
    { status: store().status, trackId: store().trackId, at: store().startedAtProjectTime, elapsed: store().elapsed, peaks: store().waveformPeaks, remaining: store().countInRemaining },
    { status: "idle", trackId: undefined, at: 0, elapsed: 0, peaks: [], remaining: 0 },
  );
  assert.equal(store().countInBeats, 4);
  assert.equal(store().metronomeEnabled, true);
  assert.equal(store().armedTrackId, "a");
});

test("resetProgress가 돌려주는 빈 파형은 매번 새 배열이다(공유하지 않는다)", () => {
  store().resetProgress();
  const first = store().waveformPeaks;
  store().resetProgress();
  assert.notEqual(store().waveformPeaks, first);
  assert.notEqual(store().waveformPeaks, IDLE_PROGRESS.waveformPeaks);
});

test("새 프로젝트를 열면 녹음 대기만 풀고 진행을 처음으로 돌린다. 장치·모니터·메트로놈·카운트인·보정은 이 브라우저의 설정이라 남긴다", () => {
  store().toggleArm("a");
  store().setInputDevice("mic-1");
  store().setMonitoring(true);
  store().setMetronome(true);
  store().setCountIn(2);
  store().setLatencyOffsetMs(35);
  store().setProgress({ status: "recording", trackId: "a", elapsed: 3 });
  store().resetForNewProject();
  assert.equal(store().armedTrackId, undefined);
  assert.equal(store().status, "idle");
  assert.equal(store().elapsed, 0);
  assert.equal(store().inputDeviceId, "mic-1");
  assert.equal(store().monitoringEnabled, true);
  assert.equal(store().metronomeEnabled, true);
  assert.equal(store().countInBeats, 2);
  assert.equal(store().latencyOffsetMs, 35);
});

test("카운트인 박 수는 0~16 정수로 맞춘다(6/8의 2마디 = 8분음표 12번까지 담는다)", () => {
  assert.equal(COUNT_IN_BEATS_MAX, 16);
  store().setCountIn(4);
  assert.equal(store().countInBeats, 4);
  store().setCountIn(12);
  assert.equal(store().countInBeats, 12);
  store().setCountIn(99);
  assert.equal(store().countInBeats, 16);
  store().setCountIn(-2);
  assert.equal(store().countInBeats, 0);
  store().setCountIn(2.6);
  assert.equal(store().countInBeats, 3);
  store().setCountIn(Number.NaN);
  assert.equal(store().countInBeats, 0);
});

test("지연 보정은 −200~+200 ms 정수로 맞춘다", () => {
  store().setLatencyOffsetMs(35.4);
  assert.equal(store().latencyOffsetMs, 35);
  store().setLatencyOffsetMs(900);
  assert.equal(store().latencyOffsetMs, 200);
  store().setLatencyOffsetMs(-900);
  assert.equal(store().latencyOffsetMs, -200);
  store().setLatencyOffsetMs(Number.NaN);
  assert.equal(store().latencyOffsetMs, 0);
});

test("입력 장치·모니터·메트로놈 설정", () => {
  store().setInputDevice("usb-mic");
  store().setMonitoring(true);
  store().setMetronome(true);
  assert.equal(store().inputDeviceId, "usb-mic");
  assert.equal(store().monitoringEnabled, true);
  assert.equal(store().metronomeEnabled, true);
  store().setInputDevice(undefined);
  assert.equal(store().inputDeviceId, undefined);
});

test("isRecordingBusy는 쉬는 중이 아닌 모든 단계에서 참이고, isCapturing은 녹음 중에만 참이다", () => {
  assert.equal(isRecordingBusy(), false);
  for (const status of ["preparing", "counting-in", "recording", "stopping"]) {
    assert.equal(isRecordingBusy(status), true, status);
    store().setProgress({ status });
    assert.equal(isRecordingBusy(), true, `${status}(저장소)`);
  }
  assert.deepEqual(["idle", "preparing", "counting-in", "recording", "stopping"].map(isCapturing), [false, false, false, true, false]);
});

// ───────── 지연 보정값 기억(localStorage) ─────────

function withStorage(initial, run) {
  const previous = globalThis.window;
  const data = new Map(Object.entries(initial));
  globalThis.window = {
    localStorage: {
      getItem: (key) => (data.has(key) ? data.get(key) : null),
      setItem: (key, value) => void data.set(key, String(value)),
    },
  };
  try {
    return run(data);
  } finally {
    globalThis.window = previous;
  }
}

test("기억한 지연 보정값이 없거나 이상하면 0이다", () => {
  assert.equal(LATENCY_OFFSET_STORAGE_KEY, "ad.latencyOffsetMs");
  withStorage({}, () => assert.equal(readLatencyOffsetMs(), 0));
  withStorage({ [LATENCY_OFFSET_STORAGE_KEY]: "abc" }, () => assert.equal(readLatencyOffsetMs(), 0));
  withStorage({ [LATENCY_OFFSET_STORAGE_KEY]: "" }, () => assert.equal(readLatencyOffsetMs(), 0));
});

test("기억한 지연 보정값은 범위 안으로 넣어 읽는다", () => {
  withStorage({ [LATENCY_OFFSET_STORAGE_KEY]: "35" }, () => assert.equal(readLatencyOffsetMs(), 35));
  withStorage({ [LATENCY_OFFSET_STORAGE_KEY]: "-120" }, () => assert.equal(readLatencyOffsetMs(), -120));
  withStorage({ [LATENCY_OFFSET_STORAGE_KEY]: "9999" }, () => assert.equal(readLatencyOffsetMs(), 200));
});

test("지연 보정값을 쓰면 범위 안의 정수로 기억한다", () => {
  withStorage({}, (data) => {
    writeLatencyOffsetMs(42.4);
    assert.equal(data.get(LATENCY_OFFSET_STORAGE_KEY), "42");
    writeLatencyOffsetMs(-999);
    assert.equal(data.get(LATENCY_OFFSET_STORAGE_KEY), "-200");
  });
});

test("저장소를 쓸 수 없는 환경(개인정보 보호 모드 등)에서도 오류 없이 기본값으로 동작한다", () => {
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    },
  };
  try {
    assert.equal(readLatencyOffsetMs(), 0);
    assert.doesNotThrow(() => writeLatencyOffsetMs(10));
  } finally {
    globalThis.window = previous;
  }
});
