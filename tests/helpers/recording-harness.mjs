/**
 * 녹음 컨트롤러 시험용 가짜 부품 모음.
 * 소리 엔진·녹음기·타이머·클릭 소리는 가짜이고, 오디오 시계(`context.currentTime`)는 시험이 손으로 돌린다.
 * `host`(스토어·문서 쪽)는 기본이 가짜이고, `options.host`로 진짜를 끼울 수 있다(녹음 흐름 시험).
 */
import { createManualTimer } from "./fake-audio.mjs";
import { RecordingController } from "../../src/audio/recording/RecordingController.ts";

export const SAMPLE_RATE = 48000;

/** 마이크로태스크·콜백 큐가 한 바퀴 돌 때까지 기다린다. */
export const flush = () => new Promise((resolve) => setImmediate(resolve));

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 워크렛이 보내는 것과 같은 모양의 조각을 만든다. */
export function makeChunk(frames, firstFrame, { peak = 0.5, peaks } = {}) {
  return {
    samples: new Float32Array(frames),
    peaks: peaks ? Float32Array.from(peaks) : new Float32Array(Math.ceil(frames / 256)).fill(peak),
    firstFrame,
  };
}

export function createHarness(options = {}) {
  const config = {
    now: 1,
    bpm: 120,
    /** 편집 커서 */
    playhead: 3,
    alreadyPlaying: false,
    /** 이미 재생 중일 때 곡 시계가 가리키는 자리 */
    playingFrom: 5,
    outputLatency: 0,
    baseLatency: 0,
    inputLatency: 0,
    assetDuration: 10,
    settings: {},
    chosen: { trackId: "track-1", created: false },
    ...options,
  };
  const context = { currentTime: config.now, sampleRate: SAMPLE_RATE };
  const calls = { play: [], stop: 0, decode: [], ensure: 0 };
  const engineState = {
    playing: config.alreadyPlaying,
    from: config.alreadyPlaying ? config.playingFrom : config.playhead,
    startedAt: config.now,
    stoppedAt: config.playhead,
  };

  const engine = {
    async ensureContext() {
      calls.ensure += 1;
      if (config.ensureGate) await config.ensureGate;
      if (config.ensureError) throw config.ensureError;
      return context;
    },
    async play(from, playOptions = {}) {
      calls.play.push({ from, atContextTime: playOptions.atContextTime });
      if (config.playError) throw config.playError;
      engineState.playing = true;
      engineState.from = from;
      engineState.startedAt = playOptions.atContextTime ?? context.currentTime;
    },
    stop() {
      calls.stop += 1;
      engineState.stoppedAt = engine.getCurrentPlayhead();
      engineState.playing = false;
    },
    isPlaying: () => engineState.playing,
    getCurrentPlayhead: () =>
      engineState.playing
        ? Math.max(engineState.from, engineState.from + context.currentTime - engineState.startedAt)
        : engineState.stoppedAt,
    positionAt: (contextTime) => engineState.from + (contextTime - engineState.startedAt),
    getOutputLatency: () => config.outputLatency,
    getBaseLatency: () => config.baseLatency,
    getMonitorInput: () => undefined,
    async decode(blob, fileName, assetId) {
      calls.decode.push({ fileName, assetId, size: blob.size });
      if (config.decodeGate) await config.decodeGate;
      if (config.decodeError) throw config.decodeError;
      return {
        id: assetId,
        fileName,
        duration: config.assetDuration,
        sampleRate: SAMPLE_RATE,
        channels: 1,
        waveformPeaks: [0.1, 0.2],
        sourceType: "recording",
      };
    },
  };

  const recorders = [];
  class FakeRecorder {
    onChunk = undefined;
    openCalls = [];
    beganAt = undefined;
    finishCalls = 0;
    cancelCalls = 0;
    frames = 0;
    firstFrame = -1;
    nextFrame = undefined;
    async open(_context, openOptions) {
      this.openCalls.push(openOptions);
      if (config.openGate) await config.openGate;
      if (config.openError) throw config.openError;
      return { inputLatency: config.inputLatency };
    }
    begin(frame) {
      this.beganAt = frame;
    }
    async finish() {
      this.finishCalls += 1;
      if (config.finishGate) await config.finishGate;
      if (config.finishError) throw config.finishError;
      const frames = config.finishFrames ?? this.frames;
      return {
        blob: new Blob([new Uint8Array(Math.min(frames, 16))]),
        duration: frames / SAMPLE_RATE,
        sampleRate: SAMPLE_RATE,
        firstFrame: this.firstFrame,
        frames,
      };
    }
    cancel() {
      this.cancelCalls += 1;
    }
    /** 워크렛이 조각을 보내는 것을 흉내 낸다. 첫 프레임을 주지 않으면 앞 조각에 이어 붙인다. */
    emit(frames = 4096, chunkOptions = {}) {
      const first = chunkOptions.firstFrame ?? this.nextFrame ?? this.beganAt;
      this.nextFrame = first + frames;
      if (this.firstFrame < 0) this.firstFrame = first;
      this.frames += frames;
      this.onChunk?.(makeChunk(frames, first, chunkOptions));
    }
  }

  const log = {
    updates: [],
    events: [],
    failures: [],
    commits: [],
    remembered: [],
    discarded: [],
    playing: [],
    playheads: [],
    resets: 0,
    chooseCalls: 0,
  };
  const fakeHost = {
    settings: () => ({
      armedTrackId: undefined,
      inputDeviceId: undefined,
      monitoringEnabled: false,
      metronomeEnabled: false,
      countInBeats: 0,
      latencyOffsetMs: 0,
      ...config.settings,
    }),
    bpm: () => config.bpm,
    playhead: () => config.playhead,
    update: (patch) => log.updates.push(patch),
    reset: () => {
      log.resets += 1;
    },
    setPlaying: (playing) => log.playing.push(playing),
    setPlayhead: (position) => log.playheads.push(position),
    chooseTrack: () => {
      log.chooseCalls += 1;
      return config.chosen;
    },
    discardTrack: (trackId) => log.discarded.push(trackId),
    nextFileName: () => "녹음 001.wav",
    newId: (prefix) => `${prefix}-1`,
    commit: (recording) => log.commits.push(recording),
    remember: (assetId, blob) => log.remembered.push({ assetId, size: blob.size }),
    event: (event) => log.events.push(event),
    fail: (error, stage) => log.failures.push({ error, stage }),
  };

  const timers = [];
  const clicks = [];
  let clockMs = 0;
  const controller = new RecordingController({
    engine,
    host: config.host ?? fakeHost,
    createRecorder: () => {
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      return recorder;
    },
    createTimer: () => {
      const timer = createManualTimer();
      timers.push(timer);
      return timer;
    },
    createClickPlayer: () => (click) => {
      const handle = {
        click,
        cancelled: false,
        cancel() {
          handle.cancelled = true;
        },
      };
      clicks.push(handle);
      return handle;
    },
    nowMs: () => clockMs,
  });

  return {
    config,
    context,
    controller,
    engine,
    engineState,
    calls,
    log,
    clicks,
    recorders,
    timers,
    get recorder() {
      return recorders.at(-1);
    },
    get timer() {
      return timers.at(-1);
    },
    /** 오디오 시계를 그 시각으로 옮기고 타이머를 한 번 깨운다. */
    tickAt(time) {
      context.currentTime = time;
      timers.at(-1).fire();
    },
    /** 타이머를 `fromTime`부터 `toTime`까지 25 ms 간격으로 깨운다. */
    run(fromTime, toTime, stepSeconds = 0.025) {
      for (let time = fromTime; time <= toTime + 1e-9; time += stepSeconds) {
        context.currentTime = time;
        timers.at(-1).fire();
      }
    },
    setNowMs(ms) {
      clockMs = ms;
    },
    /** 시작 이후 화면 갱신 중 경과 시간을 담은 것 */
    elapsedUpdates() {
      return log.updates.filter((patch) => "elapsed" in patch && patch.status === undefined);
    },
    statuses: () => log.updates.map((patch) => patch.status).filter(Boolean),
    eventTypes: () => log.events.map((event) => event.type),
  };
}
