/**
 * 공용 조작부(P5-0)의 구조 시험. 설계서 §P5-0의 수용 기준을 코드 모양으로 지킨다.
 * - 노브는 한 곳(ui/controls/Knob.tsx)에만 있다. 슬라이더도 한 곳(Slider.tsx)에서만 만든다.
 * - 부품은 모듈 맨 위에 정의한다(다른 부품 안에서 만들면 다시 그릴 때마다 지워지고 새로 생겨 초점이 사라진다 — 점검 보고서 C12·D6).
 * - 인스펙터는 칸별 파일을 차례로 놓기만 한다.
 * `.tsx`는 노드 시험에서 불러올 수 없어서 소스 글자를 읽어 확인한다.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(src).filter((file) => /\.(ts|tsx)$/.test(file));
const rel = (file) => path.relative(root, file).split(path.sep).join("/");
const read = (file) => fs.readFileSync(file, "utf8");
const tsxFiles = files.filter((file) => file.endsWith(".tsx"));

/** 설명 줄(`//`, `/*`, ` *`)은 코드가 아니므로 건너뛴다 */
const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

/** "경로:줄번호" 목록에서 파일 경로만 중복 없이 뽑는다 */
const filesOf = (hits) => [...new Set(hits.map((hit) => hit.split(":")[0]))];

/** 소스에서 조건에 맞는 코드 줄을 "경로:줄번호" 목록으로 모은다 */
function grep(list, pattern) {
  const hits = [];
  for (const file of list) {
    read(file).split("\n").forEach((line, index) => {
      if (!isComment(line) && pattern.test(line)) hits.push(`${rel(file)}:${index + 1}`);
    });
  }
  return hits;
}

test("노브 정의는 ui/controls/Knob.tsx 한 곳뿐이다", () => {
  const hits = grep(files, /\bfunction\s+[A-Za-z]*Knob\s*\(/);
  assert.deepEqual(filesOf(hits), ["src/ui/controls/Knob.tsx"], hits.join(", "));
  const arrows = grep(files, /\bconst\s+[A-Za-z]*Knob\s*=\s*(\(|function|[a-z]\w*\s*=>)/);
  assert.deepEqual(arrows, []);
});

test("예전 노브 이름(EqKnob·TraxKnob·CompKnob·DelayKnob)이 남아 있지 않다", () => {
  assert.deepEqual(grep(files, /\b(EqKnob|TraxKnob|CompKnob|DelayKnob)\b/), []);
});

test("슬라이더(input type=range)는 ui/controls/Slider.tsx에서만 만든다", () => {
  const hits = grep(tsxFiles, /type=["']range["']/);
  assert.deepEqual(filesOf(hits), ["src/ui/controls/Slider.tsx"], hits.join(", "));
});

test('role="slider"는 노브 부품(Knob.tsx)만 붙인다', () => {
  assert.deepEqual(grep(tsxFiles, /role=["']slider["']/), []);
  const hits = grep(files, /role:\s*["']slider["']/);
  assert.deepEqual(filesOf(hits), ["src/ui/controls/Knob.tsx"], hits.join(", "));
});

test("다른 부품 안에서 부품을 만들지 않는다(안쪽에 들여 쓴 대문자 함수·화살표 부품이 없다)", () => {
  const nested = grep(tsxFiles, /^\s{2,}(function\s+[A-Z][A-Za-z0-9]*\s*\(|const\s+[A-Z][A-Za-z0-9]*\s*=\s*(\([^)]*\)|[a-z]\w*)\s*=>)/);
  assert.deepEqual(nested, []);
});

test("숫자 칸(CommittedNumberInput)은 ui/controls에 있고 옛 자리에는 없다", () => {
  assert.ok(fs.existsSync(path.join(src, "ui/controls/CommittedNumberInput.tsx")));
  assert.ok(!fs.existsSync(path.join(src, "components/CommittedNumberInput.tsx")));
  assert.deepEqual(grep(files, /components\/CommittedNumberInput/), []);
});

test("인스펙터는 칸별 파일을 차례로 놓기만 한다", () => {
  assert.ok(!fs.existsSync(path.join(src, "components/Inspector.tsx")), "옛 Inspector.tsx가 남아 있다");
  const inspector = read(path.join(src, "ui/inspector/Inspector.tsx"));
  for (const panel of ["ClipPanel", "TrackMixPanel", "MasterPanel", "EqPanel", "CompressorPanel", "DelayPanel", "ReverbPanel", "AnalyzerPanel"]) {
    assert.ok(fs.existsSync(path.join(src, `ui/inspector/${panel}.tsx`)), `${panel}.tsx가 없다`);
    assert.match(inspector, new RegExp(`<${panel}\\b`), `Inspector가 ${panel}을(를) 놓지 않았다`);
  }
  assert.ok(inspector.split("\n").length < 80, "Inspector가 다시 커졌다 — 칸 안의 일은 칸 파일에 둔다");
  assert.match(read(path.join(src, "App.tsx")), /from "\.\/ui\/inspector\/Inspector"/);
});

test("딜레이·리버브 패널은 공용 노브·슬라이더·토글을 쓴다(자체 노브·범위 입력이 없다)", () => {
  for (const name of ["DelayPluginPanel", "ReverbPluginPanel"]) {
    const text = read(path.join(src, `components/${name}.tsx`));
    assert.match(text, /from "\.\.\/ui\/controls\/Knob"/, `${name}이(가) 공용 Knob을 쓰지 않는다`);
    assert.match(text, /from "\.\.\/ui\/controls\/Toggle"/, `${name}이(가) 공용 Toggle을 쓰지 않는다`);
    assert.doesNotMatch(text, /type=["']range["']/);
  }
  assert.match(read(path.join(src, "components/ReverbPluginPanel.tsx")), /from "\.\.\/ui\/controls\/Slider"/);
});

test("끌기 묶음을 여는 옛 방식(인스펙터 전체 pointerdown 가로채기)이 없다", () => {
  assert.deepEqual(grep(tsxFiles.filter((file) => rel(file).startsWith("src/ui/inspector/")), /onPointerDownCapture/), []);
});

test("entries: plainEntry는 값을 그대로, scaledEntry는 단위만 바꾼다", async () => {
  const { plainEntry, scaledEntry } = await import("../src/ui/controls/entries.ts");

  const plain = plainEntry("저음 이퀄라이저 값(dB)", -12, 12, 0.5);
  assert.equal(plain.label, "저음 이퀄라이저 값(dB)");
  assert.equal(plain.toInput(1.5), 1.5);
  assert.equal(plain.fromInput(-4.5), -4.5);
  assert.deepEqual([plain.min, plain.max, plain.step], [-12, 12, 0.5]);

  const percent = scaledEntry("볼륨 값(%)", 100, 0, 100, 1);
  assert.ok(Math.abs(percent.toInput(0.86) - 86) < 1e-9);
  assert.ok(Math.abs(percent.fromInput(86) - 0.86) < 1e-9);
  assert.deepEqual([percent.min, percent.max, percent.step], [0, 100, 1]);

  const ms = scaledEntry("반응 시간 값(ms)", 1000, 1, 1000, 1);
  assert.ok(Math.abs(ms.toInput(0.012) - 12) < 1e-9);
  assert.ok(Math.abs(ms.fromInput(250) - 0.25) < 1e-9);
});
