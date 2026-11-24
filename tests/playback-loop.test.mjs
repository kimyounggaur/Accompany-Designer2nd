/**
 * P5-3 재생 중 화면 갱신: 재생 위치 읽기(`app/playhead.ts`), 곡 끝 감시와 루프 켜고 끄기(`app/playbackLoop.ts`),
 * 재생선 따라가기 계산(`domain/timeline/follow.ts`), 그리고 "스토어에 재생 위치를 프레임마다 쓰지 않는다"는 구조 점검.
 * 설계서 수용 기준(단위):
 *  - 멈춰 있을 때는 화면 갱신 요청 0회, 재생·녹음 중에만 루프가 돈다
 *  - 곡 끝에 닿으면 멈추고 편집 커서가 곡 끝에 놓인다(예전 App.tsx의 루프가 하던 일)
 *  - 재생 위치는 스토어에 쓰지 않는다(`cursor`는 정지·이동 때만 바뀐다)
 * (브라우저 쪽 수치 — 재생 5초 동안 `Timeline`·상단 바·툴바 다시 그리기 0회, 재생선 이동 — 는 e2e: e2e/report-regression.spec.ts P5-3)
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { FakeContext } from "./helpers/fake-audio.mjs";

globalThis.window = { AudioContext: FakeContext };

const { audioEngine } = await import("../src/audio/currentEngine.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { useRecordingStore } = await import("../src/state/recordingStore.ts");
const { history } = await import("../src/state/history.ts");
const { readPlayhead } = await import("../src/app/playhead.ts");
const { shouldRunFrameLoop, stopAtSongEnd, installPlaybackLoop } = await import("../src/app/playbackLoop.ts");
const { frameLoop } = await import("../src/services/frameLoop.ts");
const { getProjectDuration } = await import("../src/utils/audioMath.ts");
const { followScrollLeft, FOLLOW_RIGHT_MARGIN, FOLLOW_LEAD_RATIO } = await import("../src/domain/timeline/follow.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const store = () => useDawStore.getState();
const SONG_END = 8; // 빈 프로젝트의 곡 길이(최소 8초)

// ───── 소리 쪽 시계를 손으로 정하는 가짜 ─────

const engine = { playhead: 0, end: undefined, stops: 0 };
const STUBBED = ["getCurrentPlayhead", "getPlaybackEnd", "stop"];

function stubEngine() {
  engine.playhead = 0;
  engine.end = undefined; // 정하지 않으면 곡 길이
  engine.stops = 0;
  audioEngine.getCurrentPlayhead = () => engine.playhead;
  audioEngine.getPlaybackEnd = (project) => engine.end ?? getProjectDuration(project);
  audioEngine.stop = () => { engine.stops++; };
}

function restoreEngine() {
  for (const name of STUBBED) delete audioEngine[name]; // 인스턴스에 얹은 것을 걷으면 원래 메서드가 보인다
}

/** `requestAnimationFrame` 흉내: 예약을 쌓아 두고 손으로 한 프레임씩 돌린다. */
function fakeRaf() {
  let next = 1;
  const pending = new Map();
  const calls = { request: 0, cancel: 0 };
  const original = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  globalThis.requestAnimationFrame = (callback) => {
    const handle = next++;
    pending.set(handle, callback);
    calls.request++;
    return handle;
  };
  globalThis.cancelAnimationFrame = (handle) => {
    calls.cancel++;
    pending.delete(handle);
  };
  return {
    calls,
    pending,
    step(now = 0) {
      const first = pending.entries().next().value;
      if (!first) return false;
      const [handle, callback] = first;
      pending.delete(handle);
      callback(now);
      return true;
    },
    restore() {
      globalThis.requestAnimationFrame = original.request;
      globalThis.cancelAnimationFrame = original.cancel;
    },
  };
}

let raf;
let uninstall;

beforeEach(() => {
  store().resetProject();
  history.clear();
  useDawStore.setState({ isPlaying: false, cursor: 0 });
  useRecordingStore.getState().resetForNewProject();
  stubEngine();
  raf = fakeRaf();
  uninstall = undefined;
});

afterEach(() => {
  uninstall?.();
  frameLoop.setActive(false);
  raf.restore();
  restoreEngine();
  useDawStore.setState({ isPlaying: false });
  useRecordingStore.getState().resetForNewProject();
});

const clipOn = (trackId, id, startTime, duration = 2) => ({
  id, audioBufferId: "asset", name: id, trackId, startTime, offset: 0, duration, sourceBpm: 120,
  stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
});

// ───── 지금 재생 위치 ─────

test("readPlayhead: 멈춰 있으면 편집 커서이고, 소리 쪽 시계는 묻지 않는다", () => {
  let asked = 0;
  audioEngine.getCurrentPlayhead = () => { asked++; return 99; };
  store().setCursor(3.5);
  assert.equal(readPlayhead(), 3.5);
  assert.equal(asked, 0);
});

test("readPlayhead: 재생 중이면 소리 쪽 시계를 읽고, 스토어의 커서는 건드리지 않는다", () => {
  store().setCursor(2);
  store().setIsPlaying(true);
  engine.playhead = 4.25;
  assert.equal(readPlayhead(), 4.25);
  engine.playhead = 5.5;
  assert.equal(readPlayhead(), 5.5);
  assert.equal(store().cursor, 2, "재생 중에도 편집 커서(=재생을 시작한 자리)는 그대로다");
});

test("readPlayhead: 곡 끝 너머(이펙트 꼬리가 남은 동안)는 곡 끝에서 멈춘 것으로 본다", () => {
  store().setIsPlaying(true);
  engine.playhead = SONG_END + 4;
  assert.equal(readPlayhead(), SONG_END);
});

test("readPlayhead: 녹음 중에는 곡 끝을 넘어도 그대로 흐른다", () => {
  store().setIsPlaying(true);
  useRecordingStore.setState({ status: "recording" });
  engine.playhead = SONG_END + 4;
  assert.equal(readPlayhead(), SONG_END + 4);
});

test("readPlayhead: 곡이 길어지거나 템포가 바뀌면 곡 끝도 따라 바뀐다(곡 길이를 기억해 두되 낡지 않는다)", () => {
  store().setIsPlaying(true);
  engine.playhead = 12;
  assert.equal(readPlayhead(), SONG_END, "빈 곡은 8초에서 막힌다");
  const trackId = store().tracks[0].id;
  store().addClip(trackId, clipOn(trackId, "긴 클립", 10, 4));
  const longer = getProjectDuration(store());
  assert.ok(longer > 12, "클립 뒤로 곡이 늘어난다");
  assert.equal(readPlayhead(), 12, "늘어난 곡 안이라 막히지 않는다");
  engine.playhead = longer + 5;
  assert.equal(readPlayhead(), longer);
  store().setBpm(60); // 박이 길어져 여백(8박)이 늘어난다
  const slower = getProjectDuration(store());
  assert.ok(slower > longer);
  assert.equal(readPlayhead(), Math.min(longer + 5, slower));
});

// ───── 곡 끝 감시 ─────

test("stopAtSongEnd: 재생 중이 아니면 아무것도 하지 않는다", () => {
  engine.playhead = SONG_END + 1;
  stopAtSongEnd();
  assert.equal(engine.stops, 0);
  assert.equal(store().cursor, 0);
});

test("stopAtSongEnd: 아직 끝에 닿지 않았으면 그대로 재생한다", () => {
  store().setIsPlaying(true);
  engine.playhead = SONG_END - 0.01;
  stopAtSongEnd();
  assert.equal(engine.stops, 0);
  assert.equal(store().isPlaying, true);
});

test("stopAtSongEnd: 곡 끝에 닿으면 소리를 멈추고, 편집 커서를 곡 끝에 두고, 재생 표시를 끈다", () => {
  store().setCursor(1);
  store().setIsPlaying(true);
  engine.playhead = SONG_END;
  stopAtSongEnd();
  assert.equal(engine.stops, 1);
  assert.equal(store().isPlaying, false);
  assert.equal(store().cursor, SONG_END);
});

test("stopAtSongEnd: 이펙트 꼬리가 남아 있는 동안(getPlaybackEnd가 더 늦다)에는 계속 재생한다", () => {
  store().setIsPlaying(true);
  engine.end = SONG_END + 2;
  engine.playhead = SONG_END + 1;
  stopAtSongEnd();
  assert.equal(engine.stops, 0);
  assert.equal(store().isPlaying, true);
  assert.equal(readPlayhead(), SONG_END, "화면의 재생선은 곡 끝에서 멈춘다");
  engine.playhead = SONG_END + 2;
  stopAtSongEnd();
  assert.equal(engine.stops, 1);
  assert.equal(store().isPlaying, false);
});

test("stopAtSongEnd: 녹음 중에는 곡 끝을 넘어도 멈추지 않는다", () => {
  store().setIsPlaying(true);
  useRecordingStore.setState({ status: "recording" });
  engine.playhead = SONG_END + 10;
  stopAtSongEnd();
  assert.equal(engine.stops, 0);
  assert.equal(store().isPlaying, true);
});

// ───── 루프 켜고 끄기 ─────

test("shouldRunFrameLoop: 재생 중이거나 녹음 중일 때만 참이다", () => {
  assert.equal(shouldRunFrameLoop(), false);
  store().setIsPlaying(true);
  assert.equal(shouldRunFrameLoop(), true);
  store().setIsPlaying(false);
  assert.equal(shouldRunFrameLoop(), false);
  for (const status of ["preparing", "counting-in", "stopping"]) {
    useRecordingStore.setState({ status });
    assert.equal(shouldRunFrameLoop(), false, `${status}: 아직(또는 이제) 흐르는 것이 없다`);
  }
  useRecordingStore.setState({ status: "recording" });
  assert.equal(shouldRunFrameLoop(), true);
});

test("installPlaybackLoop: 설치해도 멈춰 있으면 화면 갱신 요청은 0회다", () => {
  uninstall = installPlaybackLoop();
  assert.equal(raf.calls.request, 0);
  assert.equal(frameLoop.running(), false);
  assert.equal(frameLoop.size(), 1, "구독자는 곡 끝 감시 하나");
});

test("installPlaybackLoop: 재생을 시작하면 루프가 켜지고 프레임마다 요청은 1번이다", () => {
  uninstall = installPlaybackLoop();
  store().setIsPlaying(true);
  assert.equal(raf.calls.request, 1);
  assert.equal(frameLoop.running(), true);
  const FRAMES = 30;
  for (let index = 0; index < FRAMES; index++) {
    engine.playhead = index * 0.1;
    assert.equal(raf.step(index * 16.7), true);
  }
  assert.equal(raf.calls.request, FRAMES + 1);
  assert.equal(raf.pending.size, 1);
  assert.equal(store().isPlaying, true);
  assert.equal(store().cursor, 0, "재생 중에는 스토어에 위치를 쓰지 않는다");
});

test("installPlaybackLoop: 재생을 멈추면 루프가 꺼지고 예약이 거두어진다. 다시 켜도 예약은 겹치지 않는다", () => {
  uninstall = installPlaybackLoop();
  store().setIsPlaying(true);
  store().setIsPlaying(false);
  assert.equal(frameLoop.running(), false);
  assert.equal(raf.pending.size, 0);
  assert.equal(raf.step(), false);
  store().setIsPlaying(true);
  store().setIsPlaying(false);
  store().setIsPlaying(true);
  assert.equal(raf.pending.size, 1);
});

test("installPlaybackLoop: 곡 끝에 닿은 프레임에서 멈추고, 그다음 프레임은 요청하지 않는다", () => {
  uninstall = installPlaybackLoop();
  store().setCursor(0);
  store().setIsPlaying(true);
  engine.playhead = SONG_END;
  assert.equal(raf.step(), true);
  assert.equal(engine.stops, 1);
  assert.equal(store().isPlaying, false);
  assert.equal(store().cursor, SONG_END);
  assert.equal(frameLoop.running(), false);
  assert.equal(raf.pending.size, 0);
  assert.equal(raf.calls.request, 1, "곡이 끝난 뒤로 화면 갱신 요청은 더 없다");
});

test("installPlaybackLoop: 녹음 중이면 재생 표시가 꺼져 있어도 루프가 돌고, 끝나면 멈춘다", () => {
  uninstall = installPlaybackLoop();
  useRecordingStore.setState({ status: "recording" });
  assert.equal(frameLoop.running(), true);
  raf.step();
  assert.equal(frameLoop.running(), true);
  useRecordingStore.setState({ status: "idle" });
  assert.equal(frameLoop.running(), false);
  assert.equal(raf.pending.size, 0);
});

test("installPlaybackLoop: 녹음 중 재생은 곡 끝을 넘어도 이어지고, 녹음이 끝나면 곡 끝 감시가 다시 일한다", () => {
  uninstall = installPlaybackLoop();
  store().setIsPlaying(true);
  useRecordingStore.setState({ status: "recording" });
  engine.playhead = SONG_END + 3;
  raf.step();
  assert.equal(store().isPlaying, true);
  assert.equal(engine.stops, 0);
  useRecordingStore.setState({ status: "idle" });
  assert.equal(frameLoop.running(), true, "아직 재생 중이라 루프는 계속 돈다");
  raf.step();
  assert.equal(engine.stops, 1, "녹음이 끝났고 곡 끝을 지났으니 멈춘다");
  assert.equal(store().isPlaying, false);
});

test("installPlaybackLoop: 돌려주는 함수를 부르면 구독·루프가 모두 거두어진다", () => {
  const off = installPlaybackLoop();
  store().setIsPlaying(true);
  assert.equal(frameLoop.running(), true);
  off();
  assert.equal(frameLoop.size(), 0);
  assert.equal(frameLoop.running(), false);
  assert.equal(raf.pending.size, 0);
  // 거둔 뒤에는 재생 상태가 바뀌어도 루프가 다시 켜지지 않는다.
  store().setIsPlaying(false);
  store().setIsPlaying(true);
  assert.equal(frameLoop.running(), false);
  assert.equal(raf.calls.request, 1, "처음 한 번뿐");
});

// ───── 재생선 따라가기 계산 ─────

test("followScrollLeft: 재생선이 보이는 구간 안이면 스크롤을 옮기지 않는다(경계 포함)", () => {
  assert.equal(followScrollLeft(500, 0, 1000), undefined);
  assert.equal(followScrollLeft(0, 0, 1000), undefined, "왼쪽 끝");
  assert.equal(followScrollLeft(1000 - FOLLOW_RIGHT_MARGIN, 0, 1000), undefined, "오른쪽 끝에서 여백만큼 안쪽");
  assert.equal(followScrollLeft(1200, 400, 1000), undefined);
  assert.equal(followScrollLeft(400, 400, 1000), undefined);
});

test("followScrollLeft: 오른쪽 여백 안이나 밖으로 나가면 재생선을 왼쪽에서 20% 자리에 놓는다", () => {
  const width = 1000;
  const x = width - FOLLOW_RIGHT_MARGIN + 1;
  assert.equal(followScrollLeft(x, 0, width), x - width * FOLLOW_LEAD_RATIO);
  assert.equal(followScrollLeft(3000, 0, width), 3000 - 200);
  assert.equal(FOLLOW_LEAD_RATIO, 0.2);
  assert.equal(FOLLOW_RIGHT_MARGIN, 30);
});

test("followScrollLeft: 재생선이 왼쪽으로 벗어났으면(되감기) 그 자리로 따라가고, 0 아래로는 가지 않는다", () => {
  assert.equal(followScrollLeft(100, 500, 1000), 0, "100 − 200 < 0 → 0");
  assert.equal(followScrollLeft(900, 1500, 1000), 700);
  assert.equal(followScrollLeft(-5, 20, 1000), 0);
});

// ───── 구조: 재생 위치는 스토어에 프레임마다 쓰지 않는다 ─────

function sourceFiles(directory, found = []) {
  for (const name of readdirSync(new URL(`../${directory}`, import.meta.url))) {
    const path = `${directory}/${name}`;
    if (statSync(new URL(`../${path}`, import.meta.url)).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(name)) found.push(path);
  }
  return found;
}

/** 줄 주석·블록 주석을 걷어 코드만 남긴다(주석에 적어 둔 옛 이름 때문에 걸리지 않도록). */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("구조: 스토어에는 재생 위치(playhead) 대신 편집 커서(cursor)가 있고, 위치를 쓰는 동작은 setCursor 하나다", () => {
  const source = code("src/store/useDawStore.ts");
  assert.match(source, /\bcursor: number;/);
  assert.match(source, /setCursor: \(cursor: number\) => void;/);
  assert.doesNotMatch(source, /\bplayhead\b/, "스토어에 playhead 필드·동작이 남아 있지 않다");
  assert.doesNotMatch(source, /setPlayhead/);
});

test("구조: 반복해서 도는 화면 갱신 루프는 services/frameLoop.ts 하나다(다른 곳의 requestAnimationFrame은 한 번짜리)", () => {
  const users = sourceFiles("src").filter((path) => /requestAnimationFrame\(/.test(code(path))).sort();
  assert.deepEqual(users, ["src/components/Timeline.tsx", "src/services/frameLoop.ts"]);
  // Timeline의 두 곳은 사건 하나에 한 번 부르는 것이다(줌 뒤 스크롤 맞춤 등). 스스로를 다시 예약하는 재귀 호출이 없어야 한다.
  assert.doesNotMatch(code("src/components/Timeline.tsx"), /requestAnimationFrame\(\s*(?:\(\)\s*=>\s*)?(?:tick|loop|frame|step|draw)\b/);
  assert.doesNotMatch(code("src/App.tsx"), /requestAnimationFrame|cancelAnimationFrame/);
  for (const path of ["src/components/LevelMeter.tsx", "src/components/SpectrumAnalyzer.tsx"]) {
    const source = code(path);
    assert.match(source, /\bonFrame\(/, `${path}는 공용 루프에 구독한다`);
    assert.doesNotMatch(source, /requestAnimationFrame|cancelAnimationFrame/, `${path}는 자기 루프를 돌리지 않는다`);
  }
});

test("구조: 재생 중 다시 그려지면 안 되는 큰 부품은 편집 커서·재생 여부를 구독하지 않고, 그린 횟수를 센다", () => {
  const watched = {
    "src/components/Timeline.tsx": "Timeline",
    "src/components/PlaylistToolbar.tsx": "PlaylistToolbar",
    "src/ui/transport/TransportControls.tsx": "TransportControls",
    "src/ui/transport/TopBar.tsx": "TopBar",
  };
  for (const [path, name] of Object.entries(watched)) {
    const source = code(path);
    assert.doesNotMatch(source, /useDawStore\(\(state\) => state\.cursor\)/, `${path}가 편집 커서를 구독한다(커서가 바뀔 때마다 다시 그려진다)`);
    assert.match(source, new RegExp(`countRender\\("${name}"\\)`), `${path}에 다시 그리기 계수가 없다`);
  }
  // App은 재생 위치·재생 여부를 구독하지 않는다(재생이 시작·끝날 때도 App 전체가 다시 그려지지 않는다). 사건 때 한 번 `getState()`로 부르는 것은 괜찮다.
  assert.doesNotMatch(code("src/App.tsx"), /useDawStore\(\(state\) => state\.(?:cursor|isPlaying|setCursor|setIsPlaying)\)/);
});

test("구조: 재생선과 시간 표시는 자기 요소만 고친다(React 상태를 프레임마다 바꾸지 않는다)", () => {
  for (const path of ["src/ui/timeline/PlayheadOverlay.tsx", "src/ui/transport/TimeDisplay.tsx"]) {
    const source = code(path);
    assert.match(source, /\bonFrame\(/, `${path}는 공용 루프에 구독한다`);
    assert.match(source, /\breadPlayhead\(\)/, `${path}는 지금 위치를 readPlayhead로 읽는다`);
    assert.doesNotMatch(source, /\buseState\b/, `${path}에 프레임마다 바뀌는 React 상태가 있다`);
    assert.doesNotMatch(source, /requestAnimationFrame/);
  }
  assert.match(code("src/ui/timeline/PlayheadOverlay.tsx"), /style\.transform\s*=/, "재생선은 transform으로 옮긴다(left를 바꾸면 배치를 다시 계산한다)");
  assert.match(code("src/ui/transport/TimeDisplay.tsx"), /textContent\s*=/, "시간 표시는 글자만 바꾼다");
});

test("구조: 앱이 켜질 때 재생 루프를 설치하고 꺼질 때 거둔다", () => {
  const source = code("src/app/bootstrap.ts");
  assert.match(source, /installPlaybackLoop\(\)/);
  assert.match(source, /offPlaybackLoop\(\)/);
});

test("구조: 재생선 위치를 읽는 곳(붙여넣기·가져오기·표시 추가)은 스토어 값이 아니라 readPlayhead를 쓴다", () => {
  assert.match(code("src/app/actions.ts"), /readPlayhead\(\)/);
  assert.match(code("src/app/importing.ts"), /readPlayhead\(\)/);
  assert.match(code("src/components/PlaylistToolbar.tsx"), /addTimeMarker\(readPlayhead\(\)\)/);
});
