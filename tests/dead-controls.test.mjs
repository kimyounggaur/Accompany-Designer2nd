/**
 * P5-6 동작하지 않는 조작부 정리(보고서 C7).
 *  - 컴프레서 바늘: 기준 음량 노브가 아니라 실제 압축량(dB)을 따른다. −20 dB가 끝이다.
 *  - 스냅 선택지: 마디 · 박 · 1/2박 · 1/4박 · 없음 다섯 개이고 간격이 모두 다르다. "메인"·"라인"과 로컬·글로벌 구분은 없다.
 * (재생 중 바늘이 실제로 움직이는지는 e2e/report-regression.spec.ts)
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FakeContext } from "./helpers/fake-audio.mjs";

const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
  removeItem: (key) => { storage.delete(key); },
};
globalThis.window = { AudioContext: FakeContext, localStorage };

const {
  NEEDLE_FULL_DB,
  NEEDLE_MAX_ANGLE,
  NEEDLE_MIN_ANGLE,
  NEEDLE_SCALE_DB,
  displayReduction,
  needleAngle,
} = await import("../src/domain/compressor/needle.ts");
const { DEFAULT_SNAP, PLAYLIST_SNAPS, snapDivisionOf, snapSettings } = await import("../src/domain/timeline/snap.ts");
const { getBeatSeconds, snapTime } = await import("../src/utils/audioMath.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { history } = await import("../src/state/history.ts");
const { createEmptyDoc } = await import("../src/domain/project/defaults.ts");

const read = (path) => readFileSync(path, "utf8");
/** 설명 글(주석)을 뺀 코드. 옛 이름을 설명하는 주석은 남아도 되지만 코드와 화면 글자에는 없어야 한다. */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const near = (actual, expected, message = "", epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message} ${actual} ≈ ${expected}`);
const store = () => useDawStore.getState();

/** `src` 아래 모든 .ts·.tsx 파일 경로 */
function sourceFiles(dir = "src") {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

beforeEach(() => {
  store().resetProject();
  history.clear();
});

// ───────── 컴프레서 바늘: 각도 계산 ─────────

test("바늘: 줄이는 것이 없으면 오른쪽 끝(0)에 서고, 20 dB가 끝(왼쪽)이다", () => {
  assert.equal(needleAngle(0), NEEDLE_MAX_ANGLE);
  assert.equal(needleAngle(-NEEDLE_FULL_DB), NEEDLE_MIN_ANGLE);
  assert.equal(NEEDLE_FULL_DB, 20, "설계서: −20dB = 끝");
  assert.equal(NEEDLE_MIN_ANGLE, -80);
  assert.equal(NEEDLE_MAX_ANGLE, 80);
});

test("바늘: 범위를 넘는 값·이상한 값은 가까운 끝에 선다", () => {
  assert.equal(needleAngle(-35), NEEDLE_MIN_ANGLE, "20 dB보다 많이 줄여도 끝에서 멈춘다");
  assert.equal(needleAngle(-Infinity), NEEDLE_MIN_ANGLE);
  assert.equal(needleAngle(3), NEEDLE_MAX_ANGLE, "0보다 큰 값은 압축이 아니다");
  assert.equal(needleAngle(Infinity), NEEDLE_MAX_ANGLE);
  assert.equal(needleAngle(Number.NaN), NEEDLE_MAX_ANGLE, "숫자가 아니면 쉬는 자리");
});

test("바늘: 화면에 적힌 눈금 위에서는 그 눈금 자리를 정확히 가리킨다", () => {
  assert.deepEqual([...NEEDLE_SCALE_DB], [20, 15, 10, 7, 5, 3, 1, 0], "눈금은 화면의 숫자와 같다");
  const step = (NEEDLE_MAX_ANGLE - NEEDLE_MIN_ANGLE) / (NEEDLE_SCALE_DB.length - 1);
  NEEDLE_SCALE_DB.forEach((db, index) => {
    near(needleAngle(-db), NEEDLE_MIN_ANGLE + step * index, `${db} dB`);
  });
});

test("바늘: 눈금 사이는 직선으로 잇고, 압축이 많을수록 늘 왼쪽으로 간다", () => {
  near(needleAngle(-8.5), (needleAngle(-10) + needleAngle(-7)) / 2, "10과 7의 한가운데", 1e-9);
  near(needleAngle(-0.5), (needleAngle(-1) + needleAngle(0)) / 2, "1과 0의 한가운데", 1e-9);
  let previous = needleAngle(0);
  for (let db = 0.1; db <= 20.0001; db += 0.1) {
    const angle = needleAngle(-db);
    assert.ok(angle < previous, `${db.toFixed(1)} dB에서 바늘이 더 왼쪽으로 가야 한다(${angle} < ${previous})`);
    previous = angle;
  }
});

test("바늘: 노브(기준 음량·비율)는 바늘 계산에 들어가지 않는다 — 압축량 하나만 받는다", () => {
  assert.equal(needleAngle.length, 1, "needleAngle은 압축량 하나만 받는다");
  const source = read("src/ui/inspector/CompressorPanel.tsx");
  assert.doesNotMatch(source, /threshold \+ 60/, "옛 계산(기준 음량으로 바늘 각도를 정함)이 남아 있으면 안 된다");
  assert.doesNotMatch(source, /rotate\(/, "패널이 바늘 각도를 직접 정하면 안 된다(CompressorNeedle이 한다)");
});

test("바늘: 표시용 압축량은 0 이하·소수 첫째 자리이고 −0이나 숫자가 아닌 값은 0이다", () => {
  assert.equal(displayReduction(-3.14159), -3.1);
  assert.equal(displayReduction(-0.04), 0);
  assert.ok(Object.is(displayReduction(-0.04), 0), "−0이 아니라 0");
  assert.equal(displayReduction(2), 0, "양수는 압축이 아니다");
  assert.equal(displayReduction(Number.NaN), 0);
  assert.equal(displayReduction(-Infinity), 0);
  assert.equal(displayReduction(-20), -20);
});

// ───────── 컴프레서 바늘: 연결 ─────────

test("바늘 연결: 공용 프레임 루프에서 엔진의 실제 압축량을 읽고, 쉴 때는 제자리로 돌아온다", () => {
  const needle = read("src/ui/inspector/CompressorNeedle.tsx");
  assert.match(needle, /from "\.\.\/\.\.\/services\/frameLoop"/, "공용 루프(onFrame)를 쓴다");
  assert.match(needle, /onFrame\(/);
  assert.match(needle, /audioEngine\.getCompressorReduction\(trackId\)/, "엔진에서 트랙의 압축량을 읽는다");
  assert.doesNotMatch(needle, /requestAnimationFrame|setInterval/, "자기 루프를 따로 돌리지 않는다");
  assert.match(needle, /place\(0\)/, "재생이 끝나면 쉬는 자리(0 dB)로 돌아온다");
  assert.match(needle, /data-testid="comp-needle"/);
  assert.match(needle, /dataset\.reduction/, "시험이 읽는 압축량 값을 적어 둔다");
  const panel = read("src/ui/inspector/CompressorPanel.tsx");
  assert.match(panel, /<CompressorNeedle trackId=\{track\.id\} enabled=\{compressor\.enabled\} \/>/);
  assert.match(panel, /NEEDLE_SCALE_DB\.map/, "눈금 숫자도 바늘 계산과 같은 표에서 온다");
});

test("바늘 연결: 옛 엔진도 같은 모양의 함수를 갖고(늘 0), 새 엔진이 그것을 덮어쓴다", () => {
  assert.match(read("src/audio/audioEngine.ts"), /getCompressorReduction\(_trackId: string\): number \{\s*return 0;/);
  assert.match(read("src/audio/engine/AudioEngine.ts"), /override getCompressorReduction\(trackId: string\)/);
});

// ───────── 스냅 선택지 ─────────

test("스냅 선택지: 마디 · 박 · 1/2박 · 1/4박 · 없음, 다섯 개뿐이고 처음은 1/2박이다", () => {
  assert.deepEqual([...PLAYLIST_SNAPS], ["bar", "beat", "halfBeat", "quarterBeat", "none"]);
  assert.equal(PLAYLIST_SNAPS.length, 5);
  assert.equal(DEFAULT_SNAP, "halfBeat", "옛 \"라인\"과 같은 간격(1/2박)");
  assert.equal(store().playlistSnap, "halfBeat", "처음 스냅");
  assert.equal(store().snapEnabled, true);
  assert.equal(store().gridDivision, 2);
});

test("스냅 선택지: 다섯 개의 간격이 모두 다르다(4/4·3/4·2/4·6/8 모두, 120 BPM)", () => {
  const beat = getBeatSeconds(120);
  for (const signature of [{ beats: 4, unit: 4 }, { beats: 3, unit: 4 }, { beats: 2, unit: 4 }, { beats: 6, unit: 8 }]) {
    const barSeconds = (beat * signature.beats * 4) / signature.unit;
    // 선택을 스토어에 알린 뒤 화면이 쓰는 값(잡을지 · 격자 분할)에서 간격을 읽는다.
    store().setTimeSignature(signature);
    const steps = PLAYLIST_SNAPS.map((snap) => {
      store().setPlaylistSnap(snap);
      const { snapEnabled, gridDivision } = store();
      return snapEnabled ? (gridDivision < 1 ? beat * (1 / gridDivision) : beat / gridDivision) : 0;
    });
    const label = `${signature.beats}/${signature.unit}`;
    assert.equal(new Set(steps.map((step) => step.toFixed(9))).size, 5, `${label}: 다섯 간격이 모두 달라야 한다 ${steps}`);
    near(steps[0], barSeconds, `${label} 마디`);
    near(steps[1], beat, `${label} 박`);
    near(steps[2], beat / 2, `${label} 1/2박`);
    near(steps[3], beat / 4, `${label} 1/4박`);
    assert.equal(steps[4], 0, `${label} 없음은 잡지 않는다`);
    assert.deepEqual(steps.slice().sort((a, b) => b - a), steps, `${label}: 마디 > 박 > 1/2박 > 1/4박 > 없음 순서`);
  }
});

test("스냅 선택지: 실제로 시각을 붙여 보면 간격이 다르다(4초 동안 붙는 자리의 수)", () => {
  // 120 BPM 4/4: 마디 2초, 박 0.5초, 1/2박 0.25초, 1/4박 0.125초. 0.01초 간격으로 시각을 훑어 서로 다른 결과의 수를 센다.
  const distinct = (snap) => {
    const { enabled, division } = snapSettings(snap);
    const found = new Set();
    for (let hundredths = 0; hundredths <= 400; hundredths += 1) {
      found.add(Math.round(snapTime(hundredths / 100, 120, enabled, division) * 1e6));
    }
    return found.size;
  };
  const counts = PLAYLIST_SNAPS.map(distinct);
  assert.deepEqual(counts, [3, 9, 17, 33, 401], "마디 0·2·4 / 박 9곳 / 1/2박 17곳 / 1/4박 33곳 / 없음은 훑은 시각 그대로");
  assert.equal(new Set(counts).size, 5);
});

test("스냅 단추(상단 바 자석): 끄면 '없음', 켜면 처음 값(1/2박)으로 돌아온다", () => {
  store().setPlaylistSnap("quarterBeat");
  assert.equal(store().snapEnabled, true);
  assert.equal(store().gridDivision, 4);

  store().setSnapEnabled(false);
  assert.equal(store().playlistSnap, "none");
  assert.equal(store().snapEnabled, false);
  assert.equal(store().gridDivision, snapDivisionOf("none"), "눈금 격자는 반 박 간격을 유지");

  store().setSnapEnabled(true);
  assert.equal(store().playlistSnap, "halfBeat");
  assert.equal(store().snapEnabled, true);
  assert.equal(store().gridDivision, 2);
});

test("스냅: '없음'을 고르면 박자표를 바꿔도 계속 꺼져 있고, 마디를 고르면 박자표를 따라간다", () => {
  store().setPlaylistSnap("none");
  store().setTimeSignature({ beats: 3, unit: 4 });
  assert.equal(store().snapEnabled, false);
  assert.equal(store().playlistSnap, "none");

  store().setPlaylistSnap("bar");
  assert.equal(store().snapEnabled, true);
  near(store().gridDivision, 1 / 3, "3/4 마디");
  store().setTimeSignature({ beats: 2, unit: 4 });
  near(store().gridDivision, 1 / 2, "2/4 마디");
});

test("스냅: 새 프로젝트·프로젝트 열기는 스냅을 처음(1/2박)으로 돌린다", () => {
  store().setPlaylistSnap("bar");
  store().resetProject();
  assert.equal(store().playlistSnap, "halfBeat");
  assert.equal(store().gridDivision, 2);

  store().setPlaylistSnap("quarterBeat");
  store().importProject({ ...createEmptyDoc(), timeSignature: { beats: 3, unit: 4 } });
  assert.equal(store().playlistSnap, "halfBeat");
  assert.equal(store().snapEnabled, true);
  assert.equal(store().gridDivision, 2);
  assert.deepEqual(store().timeSignature, { beats: 3, unit: 4 });
});

test("스냅: 로컬·글로벌 구분이 스토어에 없다", () => {
  const state = store();
  assert.equal("globalSnap" in state, false);
  assert.equal("setGlobalSnap" in state, false);
  assert.deepEqual(Object.keys(state).filter((key) => /snap/i.test(key)).sort(), ["playlistSnap", "setPlaylistSnap", "setSnapEnabled", "snapEnabled"]);
});

// ───────── 스냅 선택지: 소스 확인 ─────────

test("스냅 값 목록(타입)은 다섯 개이고 옛 \"main\"·\"line\"은 없다", () => {
  const types = read("src/domain/types.ts");
  const body = /export type PlaylistSnap =([^;]+);/.exec(types)?.[1] ?? "";
  const values = [...body.matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(values, ["bar", "beat", "halfBeat", "quarterBeat", "none"]);
});

test("스냅 메뉴: 위 다섯 개가 같은 순서로 있고 '메인'·'라인'·로컬·글로벌 글자가 없다", () => {
  const toolbar = code("src/components/PlaylistToolbar.tsx");
  const block = /const snapOptions[^=]*=\s*\[([\s\S]*?)\n\];/.exec(toolbar)?.[1] ?? "";
  const options = [...block.matchAll(/\{ value: "(\w+)", label: "([^"]+)" \}/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(options, [["bar", "마디"], ["beat", "박"], ["halfBeat", "1/2박"], ["quarterBeat", "1/4박"], ["none", "없음"]]);
  assert.deepEqual(options.map(([value]) => value), [...PLAYLIST_SNAPS], "도메인의 목록과 같은 순서");
  for (const text of ["메인", "라인", "로컬", "글로벌", "globalSnap", "setGlobalSnap"]) {
    assert.ok(!toolbar.includes(text), `메뉴에 "${text}"가 남아 있다`);
  }
  assert.equal((toolbar.match(/snapOptions\.map/g) ?? []).length, 1, "스냅 목록은 한 번만 그린다");
});

test("스냅: 안 쓰게 된 이름(globalSnap · resolveSnap · \"line\" 스냅)이 소스 어디에도 없다", () => {
  for (const path of sourceFiles()) {
    const text = code(path);
    assert.doesNotMatch(text, /globalSnap|setGlobalSnap|resolveSnap/, `${path}에 옛 스냅 이름이 남아 있다`);
    assert.doesNotMatch(text, /(?:Snap|snap)\w*\(\s*"(?:line|main)"/, `${path}에 옛 스냅 값이 남아 있다`);
    assert.doesNotMatch(text, /playlistSnap:\s*"(?:line|main)"/, `${path}에 옛 스냅 값이 남아 있다`);
  }
});
