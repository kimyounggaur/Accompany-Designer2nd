/**
 * P5-5 기본 편집 기능이 화면·단축키·계층 규칙에 이어져 있는가(화면 부품은 .tsx라서 시험이 가져올 수 없어 소스 글자로 확인한다).
 * 동작 자체는 clip-editing-math / clip-editing-flow 시험과 e2e가 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const importsOf = (source) => [...source.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gms)].map((match) => match[1]);

test("계층: 자리 계산(clipMath·drop·snap)은 화면·앱·스토어를 모르고, 앱 안 클립보드는 도메인 타입만 쓴다", () => {
  for (const path of ["src/domain/timeline/clipMath.ts", "src/domain/timeline/drop.ts", "src/domain/timeline/snap.ts"]) {
    for (const target of importsOf(read(path))) {
      assert.ok(!/(^|\/)(ui|app|components|store|state|services|audio)(\/|$)/.test(target), `${path}가 ${target}을 가져온다`);
    }
  }
  for (const target of importsOf(read("src/services/clipboard.ts"))) {
    assert.ok(target.startsWith("../domain/"), `클립보드가 도메인 밖 ${target}을 가져온다`);
  }
});

test("타임라인: 파일을 끌어다 놓으면 importDroppedFiles로 올리고, 놓일 자리를 보여 준다", () => {
  const timeline = read("src/components/Timeline.tsx");
  assert.match(timeline, /importDroppedFiles\(files, placement\)/);
  assert.match(timeline, /useFileDrop\(\{[^}]*onFiles: uploadDropped/);
  assert.match(timeline, /\{\.\.\.dragHandlers\}/, "끌기 이벤트를 스크롤 영역에 단다");
  assert.match(timeline, /<DropIndicator\b/);
  assert.match(timeline, /drop-active/);
});

test("끌어다 놓기: 놓을 자리는 순수 계산에 맡기고, 창 전체에서 파일 놓기의 기본 동작(파일 열기)을 막는다", () => {
  const hook = read("src/ui/timeline/useFileDrop.ts");
  assert.match(hook, /dropPlacementAt\(/);
  assert.match(hook, /window\.addEventListener\("dragover"/);
  assert.match(hook, /window\.addEventListener\("drop"/);
  assert.match(hook, /removeEventListener\("drop"/, "정리 함수가 창 이벤트를 걷는다");
  assert.match(hook, /includes\("Files"\)/, "파일이 아닌 끌기(클립 끌기 등)는 건드리지 않는다");
  assert.match(hook, /!event\.altKey|event\.altKey/, "Alt를 누르면 스냅을 끈다");
});

test("클립: 끌어서 옮기는 길은 여러 클립 옮기기(movingItems·planMultiMove·moveClips)를 거친다", () => {
  const view = read("src/components/ClipView.tsx");
  assert.match(view, /movingItems\(/);
  assert.match(view, /planMultiMove\(/);
  assert.match(view, /moveClips\(/);
  assert.ok(!/\bmoveClip\(/.test(view), "클립 하나만 옮기는 옛 길이 남아 있으면 그룹·여러 클립이 따로 놀 수 있다");
  assert.match(view, /sliceSelectedClipsAtPlayhead|clipsToCutAt/, "메뉴의 자르기도 선택 전체를 대상으로 한다");
});

test("단축키: Ctrl+D·Ctrl+E가 선택 전체를 대상으로 하는 동작에 이어져 있다", () => {
  const keyboard = read("src/app/keyboard.ts");
  assert.match(keyboard, /duplicate: duplicateSelectedClips/);
  assert.match(keyboard, /sliceAtPlayhead: sliceSelectedClipsAtPlayhead/);
  const shortcuts = read("src/services/shortcuts.ts");
  assert.match(shortcuts, /Mod\+KeyD/);
  assert.match(shortcuts, /Mod\+KeyE/);
});

test("상단 막대: 박자표 선택 칸이 있고, 녹음 중에는 바꿀 수 없다", () => {
  const tempo = read("src/ui/transport/TempoControls.tsx");
  assert.match(tempo, /aria-label="박자표"/);
  assert.match(tempo, /disabled=\{recordingBusy\}/);
  assert.match(tempo, /TIME_SIGNATURES/, "고를 수 있는 박자표 목록은 도메인(time-signature.test.mjs가 내용을 본다)에서 가져온다");
});

test("스냅: 플레이리스트 스냅 목록에 '마디'가 있다", () => {
  const toolbar = read("src/components/PlaylistToolbar.tsx");
  assert.match(toolbar, /\{ value: "bar", label: "마디" \}/);
});

test("눈금자: 마디 번호는 박자표의 마디 길이로 그린다(4박 고정이 아니다)", () => {
  const timeline = read("src/components/Timeline.tsx");
  assert.match(timeline, /quarterBeatsPerBar\(timeSignature\)/);
  assert.match(timeline, /barBeats/);
});

test("클립 글자는 선택되지 않는다: Shift+클릭이 글자 범위를 잡아 끌기가 pointercancel로 멈추는 일을 막는다", () => {
  const css = read("src/styles/layout.css");
  const block = /(?:^|\n)\.clip\s*\{([^}]*)\}/.exec(css);
  assert.ok(block, ".clip 규칙이 layout.css에 있어야 한다");
  assert.match(block[1], /user-select:\s*none/);
  assert.match(css, /\.clip \.clip-name-editor\s*\{[^}]*user-select:\s*text/, "이름 바꾸기 칸은 글자를 고를 수 있어야 한다");
});

test("우클릭 메뉴: 너비가 놓인 자리에 따라 달라지지 않는다(max-content) — 화면 오른쪽 끝에서 재면 좁게 재어져 옮긴 뒤 화면 밖으로 나가던 결함", () => {
  const css = read("src/styles/controls.css");
  const block = /(?:^|\n)\.context-menu\s*\{([^}]*(?:\/\*[\s\S]*?\*\/[^}]*)*)\}/.exec(css);
  assert.ok(block, ".context-menu 규칙이 controls.css에 있어야 한다");
  assert.match(block[1], /(?:^|[;\s])width:\s*max-content/);
  assert.match(block[1], /max-width:/, "너무 긴 메뉴는 화면 폭으로 막는다");
});
