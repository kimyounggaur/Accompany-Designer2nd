/**
 * 타사 표기 정리(P6-3)의 구조 시험. 설계서 §P6-3의 수용 기준을 글자 검사로 지킨다.
 * - `src`(주석·CSS·화면 글자 포함 모든 파일)에 타사 프로그램 이름이 없다.
 * - 앱 바깥 얼굴(`index.html`·`public/`·`package.json`·`vite.config.ts`)에도 없다.
 * - 이름을 바꾼 부품은 마크업과 CSS 양쪽에 새 이름으로 있다(한쪽만 바뀌면 화면에서 스타일이 사라진다).
 * - 지운 장식(나사·진공관 창·나무 틀)의 이름이 남아 있지 않다.
 * `docs/`는 이력을 적은 글이라 옛 이름을 인용하므로 검사하지 않는다.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (file) => path.relative(root, file).split(path.sep).join("/");
const read = (file) => fs.readFileSync(file, "utf8");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const srcFiles = walk(path.join(root, "src"));
const srcText = srcFiles.map((file) => ({ file: rel(file), text: read(file) }));

/** 설계서 수용 기준의 검색식과 같다: `grep -rniE "arturia|fl studio|t-racks|trax|specan|ableton" src` */
const THIRD_PARTY = /arturia|fl studio|t-racks|trax|specan|ableton/i;

/** "경로:줄번호: 줄 내용" 목록 */
function hitsIn(entries, pattern) {
  return entries.flatMap(({ file, text }) =>
    text.split("\n").flatMap((line, index) => (pattern.test(line) ? [`${file}:${index + 1}: ${line.trim().slice(0, 100)}`] : [])),
  );
}

test("src 어디에도 타사 프로그램 이름이 없다(설계서 수용 기준의 검색식 그대로)", () => {
  assert.deepEqual(hitsIn(srcText, THIRD_PARTY), []);
});

test("src의 파일 이름에도 타사 이름이 없다", () => {
  assert.deepEqual(srcFiles.map(rel).filter((file) => THIRD_PARTY.test(file)), []);
});

test("앱 바깥 얼굴(index.html · public · package.json · vite.config.ts)에도 타사 이름이 없다", () => {
  const outer = [path.join(root, "index.html"), path.join(root, "package.json"), path.join(root, "vite.config.ts"), ...walk(path.join(root, "public"))]
    .filter((file) => /\.(html|json|ts|svg|webmanifest|txt)$/.test(file))
    .map((file) => ({ file: rel(file), text: read(file) }));
  assert.ok(outer.length >= 4, "검사할 파일을 찾지 못했습니다");
  assert.deepEqual(hitsIn(outer, THIRD_PARTY), []);
});

const tsx = srcText.filter(({ file }) => file.endsWith(".tsx"));
const css = srcText.filter(({ file }) => file.endsWith(".css"));
const has = (entries, needle) => entries.some(({ text }) => text.includes(needle));

test("트랙 믹스 칸의 이름(mix-*)이 마크업과 CSS 양쪽에 있다", () => {
  const names = [
    "mix-panel", "mix-rack", "mix-header", "mix-brand", "mix-toggles", "mix-toggle-group",
    "mix-switch", "mix-switch-lever", "mix-switch-label", "mix-knobs", "mix-knob-wrap", "mix-knob-label", "mix-knob-val",
  ];
  const markup = names.filter((name) => !has(tsx, name));
  // 한쪽에만 쓰이는 이름이 없는지: 마크업에 있는 이름은 CSS에도 있어야 한다
  assert.deepEqual(markup, [], "마크업에 없는 이름");
  assert.deepEqual(names.filter((name) => !has(css, `.${name}`)), [], "CSS에 없는 이름");
});

test("리버브 배지(reverb-badge)가 마크업과 CSS 양쪽에 있다", () => {
  assert.ok(has(tsx, 'className="reverb-badge"'));
  assert.ok(has(css, ".reverb-badge"));
});

test("노브 얼굴 이름은 eq·mix·comp·arc·cap이고 트랙 믹스 칸이 mix를 쓴다", () => {
  const faces = srcText.find(({ file }) => file === "src/ui/controls/knobFaces.tsx").text;
  assert.match(faces, /export type KnobFaceName = "eq" \| "mix" \| "comp" \| "arc" \| "cap";/);
  assert.match(faces, /^\s*mix: MixFace,/m);
  const panel = srcText.find(({ file }) => file === "src/ui/inspector/TrackMixPanel.tsx").text;
  assert.match(panel, /id="mix"/);
  assert.match(panel, /face="mix"/);
});

test("지운 장식(나사·진공관 창·나무 틀)과 그 CSS가 남아 있지 않다", () => {
  assert.deepEqual(hitsIn(srcText, /reverb-screws|reverb-tube|reverb-wood|dly-wood/), []);
});
