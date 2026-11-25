/**
 * 휴대폰 "재생·녹음" 모드(설계서 §P6-5).
 *  - 기준 폭(768px)이 한 곳(domain/layout/breakpoints)에서 정해지고, 메모리 기준·화면 구조·CSS가 모두 같은 값을 쓴다
 *  - 아래 시트의 열림 상태(상단 바의 단추와 시트가 같이 쓴다)
 *  - 휴대폰 CSS가 같은 폭에서만 켜지고, 손가락이 닿는 단추를 44px 이상으로 키운다
 * 화면에 실제로 그려지는 모습(한 줄 상단 바·타임라인 폭·눌러서 재생·녹음)은 e2e "P6-5 휴대폰 모드"가 잰다.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHONE_BREAKPOINT, PHONE_QUERY, isPhoneWidth } from "../src/domain/layout/breakpoints.ts";
import { isPhoneClass } from "../src/domain/memory/budget.ts";
import { usePhoneSheetStore } from "../src/state/phoneSheetStore.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

beforeEach(() => {
  usePhoneSheetStore.setState({ open: false });
});

test("기준 폭: 768px 미만이 휴대폰이고, 미디어 쿼리는 767px까지다", () => {
  assert.equal(PHONE_BREAKPOINT, 768);
  assert.equal(PHONE_QUERY, "(max-width: 767px)");
  assert.equal(isPhoneWidth(320), true);
  assert.equal(isPhoneWidth(390), true);
  assert.equal(isPhoneWidth(767), true);
  assert.equal(isPhoneWidth(768), false, "768px부터는 태블릿 이상(오른쪽 패널이 있는 화면)");
  assert.equal(isPhoneWidth(1440), false);
});

test("메모리 기준(§P6-4)이 휴대폰급으로 보는 폭과 이 모드의 기준 폭이 같다", () => {
  for (const width of [390, 767, 768, 1024]) {
    assert.equal(isPhoneClass({ width }), isPhoneWidth(width), `${width}px`);
  }
});

test("휴대폰 CSS는 같은 기준 폭(PHONE_QUERY)에서만 켜지고, 폭 쿼리는 그 안(767px 이하)에서만 더 쓴다", () => {
  const css = read("src/styles/phone.css");
  assert.ok(css.includes(`@media ${PHONE_QUERY}`), "phone.css의 미디어 쿼리는 breakpoints의 PHONE_QUERY와 같아야 한다");
  const widthQueries = [...css.matchAll(/@media[^{]*\((min|max)-width:\s*(\d+)px\)/g)].map((match) => ({ kind: match[1], px: Number(match[2]), text: match[0] }));
  assert.equal(widthQueries[0].text, `@media ${PHONE_QUERY}`);
  for (const query of widthQueries) {
    assert.equal(query.kind, "max", `${query.text}: 위로 넓어지는 쿼리는 두지 않는다`);
    assert.ok(query.px < PHONE_BREAKPOINT, `${query.text}: 휴대폰 폭 안쪽의 쿼리여야 한다(넓은 화면에는 영향이 없다)`);
  }
});

test("화면 구조를 바꾸는 쪽(usePhoneMode)도 같은 PHONE_QUERY를 쓴다", () => {
  const source = read("src/ui/usePhoneMode.ts");
  assert.match(source, /PHONE_QUERY/);
  assert.doesNotMatch(source, /useMediaQuery\(\s*["'`]/, "쿼리 글자를 따로 적지 않는다");
});

test("손가락이 닿는 단추(아이콘·글자·토글·따라가기)는 모두 44px 이상으로 키운다", () => {
  const css = read("src/styles/phone.css");
  const rule = css.match(/\.app-shell\[data-phone="true"\] \.icon-button,[^{]*\{([^}]*)\}/);
  assert.ok(rule, "단추 크기 규칙이 있어야 한다");
  const selectors = rule[0].slice(0, rule[0].indexOf("{"));
  for (const name of [".icon-button", ".text-button", ".toggle", ".follow-toggle"]) {
    assert.ok(selectors.includes(name), `${name}가 44px 규칙에 들어 있다`);
  }
  assert.match(rule[1], /min-width:\s*44px/);
  assert.match(rule[1], /height:\s*44px/);
  assert.match(rule[1], /min-height:\s*44px/);
});

test("시트 안 슬라이더·선택 상자·입력 칸도 44px 이상이다", () => {
  const css = read("src/styles/phone.css");
  assert.match(css, /\.phone-track__volume input\[type="range"\]\s*\{[^}]*height:\s*44px/);
  assert.match(css, /\.record-options-sheet \.count-in-control select,[^{]*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.record-options-sheet input:not\(\[type="range"\]\)\s*\{[^}]*min-height:\s*44px/);
});

test("시트 상태: 처음에는 닫혀 있고, 열고 닫고 뒤집을 수 있다", () => {
  const sheet = () => usePhoneSheetStore.getState();
  assert.equal(sheet().open, false);
  sheet().setOpen(true);
  assert.equal(sheet().open, true);
  sheet().toggle();
  assert.equal(sheet().open, false);
  sheet().toggle();
  assert.equal(sheet().open, true);
  sheet().setOpen(false);
  assert.equal(sheet().open, false);
});

test("휴대폰 모드의 글자는 한국어 문구 파일에서 온다(영어 단어를 화면에 직접 적지 않는다)", () => {
  for (const file of ["src/ui/phone/PhoneSheet.tsx", "src/ui/transport/TopBar.tsx"]) {
    assert.match(read(file), /ko\.phone\./, `${file}는 ko.phone 문구를 쓴다`);
  }
});
