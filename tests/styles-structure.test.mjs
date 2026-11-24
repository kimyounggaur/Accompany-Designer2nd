/**
 * P6-1 스타일 정리(설계서 6단계)의 약속이 지켜지는가.
 * CSS는 브라우저가 해석하므로 여기서는 글자로 확인할 수 있는 것만 본다 — 파일 구성, 토큰 값, 명암비 계산, 이름 참조, 층(z-index).
 * 실제 화면의 색 대비는 e2e의 axe `color-contrast` 점검이, 넘침·단위 글자는 e2e의 화면 측정이 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const stylesDir = new URL("src/styles/", root);
const cssFiles = readdirSync(stylesDir).filter((name) => name.endsWith(".css")).sort();
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const cssOf = (name) => stripComments(read(`src/styles/${name}`));

/** src 아래 모든 파일(하위 폴더 포함)의 경로 */
const sourceFiles = readdirSync(new URL("src/", root), { recursive: true })
  .map(String)
  .filter((path) => /\.(tsx?|css|html)$/.test(path));

/** `:root { --이름: 값; … }`의 값들 */
function declarations(css) {
  const found = new Map();
  for (const match of stripComments(css).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) found.set(match[1], match[2].trim());
  return found;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("옛 styles.css는 없고, 어디서도 가져오지 않는다", () => {
  assert.equal(existsSync(new URL("src/styles.css", root)), false);
  for (const path of [...sourceFiles.map((p) => `src/${p}`), "index.html"]) {
    assert.doesNotMatch(read(path), /["'/]styles\.css["']/, `${path}가 옛 styles.css를 가져온다`);
  }
});

test("src/styles의 CSS는 모두 main.tsx에서 한 번씩만 불러오고, 불러오는 파일은 모두 있다", () => {
  const imported = [...read("src/main.tsx").matchAll(/^import "\.\/styles\/([^"]+\.css)";$/gm)].map((match) => match[1]);
  assert.deepEqual([...imported].sort(), cssFiles, "불러오지 않는 CSS가 있거나, 없는 CSS를 불러온다");
  assert.equal(new Set(imported).size, imported.length, "같은 CSS를 두 번 불러온다");
  assert.equal(imported[0], "tokens.css", "토큰이 맨 먼저 와야 뒤의 규칙이 var()로 쓸 수 있다");
});

test("토큰 값이 설계서(§P6-1)와 같다", () => {
  const tokens = declarations(read("src/styles/tokens.css"));
  const design = {
    "--color-bg": "#fffaeb",
    "--color-surface": "#fff0c2",
    "--color-text": "#242018",
    "--color-text-muted": "#5c4514",
    "--color-accent": "#8b2b08",
    "--color-danger": "#a1121a",
    "--color-ok": "#1f6b3a",
    "--space-1": "4px",
    "--space-2": "8px",
    "--space-3": "12px",
    "--space-4": "16px",
    "--radius-1": "4px",
    "--font-size-1": "12px",
    "--font-size-2": "13px",
    "--font-size-3": "15px",
    "--z-menu": "900",
    "--z-toast": "1000",
  };
  for (const [name, value] of Object.entries(design)) assert.equal(tokens.get(name), value, `${name}`);
});

test("글자색 토큰의 명암비가 설계서의 숫자와 같고, 어느 바탕 위에서도 4.5 이상이다", () => {
  const tokens = declarations(read("src/styles/tokens.css"));
  const surface = tokens.get("--color-surface");
  const expectedOnSurface = { "--color-text": 14.3, "--color-text-muted": 8.0, "--color-accent": 7.6, "--color-danger": 7.1, "--color-ok": 5.7 };
  for (const [name, expected] of Object.entries(expectedOnSurface)) {
    assert.equal(Number(contrast(tokens.get(name), surface).toFixed(1)), expected, `${name}의 surface 위 명암비`);
  }
  assert.equal(Number(contrast(tokens.get("--color-accent"), "#ffffff").toFixed(1)), 8.6, "accent의 흰 바탕 위 명암비");
  for (const text of Object.keys(expectedOnSurface)) {
    for (const ground of ["--color-bg", "--color-surface", "--color-surface-raised"]) {
      assert.ok(contrast(tokens.get(text), tokens.get(ground)) >= 4.5, `${text}가 ${ground} 위에서 4.5 미만`);
    }
  }
});

test("토큰(색·간격·모양·글자 크기·층)은 tokens.css에서만 정한다", () => {
  for (const name of cssFiles.filter((file) => file !== "tokens.css")) {
    const defined = [...declarations(read(`src/styles/${name}`)).keys()].filter((key) => /^--(color|space|radius|font-size|z|shadow)-/.test(key));
    assert.deepEqual(defined, [], `${name}가 토큰 ${defined.join(", ")}을 다시 정한다`);
  }
});

test("var(--이름)으로 쓰는 값은 모두 어딘가에서 정해져 있다(오타·지운 토큰 방지)", () => {
  const declared = new Set();
  for (const name of cssFiles) for (const key of declarations(read(`src/styles/${name}`)).keys()) declared.add(key);
  // 화면 부품이 style={{ "--angle": … }}처럼 건네는 값
  for (const path of sourceFiles.filter((p) => /\.tsx?$/.test(p))) {
    for (const match of read(`src/${path}`).matchAll(/["'](--[a-z][a-z0-9-]*)["']\s*:/g)) declared.add(match[1]);
  }
  const missing = [];
  for (const name of cssFiles) {
    for (const match of cssOf(name).matchAll(/var\(\s*(--[a-z0-9-]+)/g)) if (!declared.has(match[1])) missing.push(`${name}: ${match[1]}`);
  }
  assert.deepEqual(missing, []);
});

test("옛 이름표(--mistral-·--apple-)와 옛 테마의 흔적이 남아 있지 않다", () => {
  for (const name of cssFiles) {
    const css = read(`src/styles/${name}`);
    assert.doesNotMatch(css, /--(mistral|apple|mint)-/, `${name}에 옛 변수 이름이 남아 있다`);
    assert.doesNotMatch(css, /prefers-color-scheme:\s*dark/, `${name}에 어두운 테마 규칙이 남아 있다`);
  }
  assert.match(cssOf("tokens.css"), /color-scheme:\s*light;/, "밝은 테마 하나만 남긴다");
});

test("층(z-index)은 100 이상이면 토큰으로만 쓴다", () => {
  const tokens = declarations(read("src/styles/tokens.css"));
  const layers = [...tokens.keys()].filter((key) => key.startsWith("--z-"));
  assert.ok(layers.includes("--z-menu") && layers.includes("--z-toast"));
  assert.ok(Number(tokens.get("--z-toast")) > Number(tokens.get("--z-menu")), "알림이 메뉴 위에 있어야 한다");
  for (const name of cssFiles) {
    for (const match of cssOf(name).matchAll(/z-index:\s*([^;]+);/g)) {
      const value = match[1].trim();
      const token = value.match(/^var\((--z-[a-z-]+)\)$/);
      if (token) {
        assert.ok(layers.includes(token[1]), `${name}: 없는 층 토큰 ${value}`);
      } else {
        assert.ok(/^-?\d+$/.test(value) && Math.abs(Number(value)) < 100, `${name}: z-index ${value}는 토큰으로 써야 한다`);
      }
    }
  }
});

test("값을 보여 주는 글자(375 ms·8000 Hz·0 dB)는 대문자로 바꾸지 않는다", () => {
  assert.match(cssOf("controls.css"), /\.knob-value\s*\{[^}]*text-transform:\s*none;/, "knob-value");
  assert.match(cssOf("master.css"), /\.master-reset\s*\{[^}]*text-transform:\s*none;/, "master-reset");
  assert.match(cssOf("compressor.css"), /\.comp-vu-label\s*\{[^}]*text-transform:\s*none;/, "comp-vu-label");
  assert.doesNotMatch(cssOf("reverb.css"), /\.reverb-knob strong\s*\{[^}]*text-transform:\s*uppercase/, "reverb-knob strong");
  for (const selector of ["dly-knob-value", "dly-time-display"]) {
    const upper = [...cssOf("delay.css").matchAll(/([^{}]+)\{[^}]*text-transform:\s*uppercase;[^}]*\}/g)].map((match) => match[1]);
    assert.ok(!upper.some((selectors) => selectors.includes(selector)), `${selector}이 대문자 규칙에 들어 있다`);
  }
});

test("글자색은 토큰을 쓴다 — 토큰과 같은 값을 직접 쓰지 않는다", () => {
  const tokens = declarations(read("src/styles/tokens.css"));
  const literal = ["--color-bg", "--color-surface", "--color-text", "--color-text-muted", "--color-accent", "--color-danger", "--color-ok"].map((name) => [name, tokens.get(name)]);
  for (const name of cssFiles.filter((file) => file !== "tokens.css")) {
    for (const [token, value] of literal) {
      assert.ok(!new RegExp(value.replace("#", "#"), "i").test(cssOf(name)), `${name}가 ${token}의 값 ${value}을 직접 쓴다`);
    }
  }
});
