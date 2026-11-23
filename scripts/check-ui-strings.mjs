/**
 * 화면에 보이는 글자에 영어 단어가 섞여 있는지 검사한다(보고서 C6, 설계 P2-3).
 *
 * 검사 대상(src 아래 .ts·.tsx 파일, TypeScript 구문 분석으로 찾음)
 *  - JSX 글자(<b>Hello</b>의 Hello)와 {조건 ? "A" : "B"} 같은 JSX 안의 문자열 (.tsx)
 *  - 글자가 들어가는 속성: aria-label, aria-description, aria-valuetext, title, placeholder, alt, label (.tsx)
 *  - 화면 문구를 담는 객체 속성: label, title, placeholder, description, hint (.ts·.tsx 모두)
 * 영어 단어 = 영문자 세 글자 이상이 이어진 것. 허용 목록에 있으면 통과.
 *
 * 쓰는 법
 *   node scripts/check-ui-strings.mjs          # 위반이 있으면 목록을 보이고 종료 코드 1
 *   node scripts/check-ui-strings.mjs --list   # 위반 개수만 세어 보이고 항상 종료 코드 0(조사용)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");

/** 업계에서 그대로 쓰는 약어(설계 P2-3). WARP는 P4-4에서 "템포 맞춤"으로 이름을 바꿀 때까지 임시로 둔다. */
const ALLOWED = new Set(["eq", "bpm", "wav", "mp3", "rms", "warp", "khz"]);

/** 글자가 들어가는 JSX 속성 */
const TEXT_ATTRIBUTES = new Set(["aria-label", "aria-description", "aria-valuetext", "title", "placeholder", "alt", "label"]);
/** 화면 문구를 담는 객체 속성 이름 */
const TEXT_PROPERTIES = new Set(["label", "title", "placeholder", "description", "hint"]);

function listSource(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return listSource(full);
    return /\.tsx?$/.test(full) && !full.endsWith(".d.ts") ? [full] : [];
  });
}

/** 화면에 그대로 나올 수 있는 문자열을 표현식에서 모은다(비교·인덱스에 쓰인 코드 값은 제외). */
function renderedStrings(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.flatMap((span) => [...renderedStrings(span.expression), span.literal.text])];
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return renderedStrings(node.expression);
  if (ts.isConditionalExpression(node)) return [...renderedStrings(node.whenTrue), ...renderedStrings(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return renderedStrings(node.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return [...renderedStrings(node.left), ...renderedStrings(node.right)];
  }
  return [];
}

function englishWords(text) {
  return (text.match(/[A-Za-z]{3,}/g) ?? []).filter((word) => !ALLOWED.has(word.toLowerCase()));
}

const violations = [];

function report(sourceFile, node, kind, text, words) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  violations.push({ file: path.relative(root, sourceFile.fileName), line: line + 1, kind, text: text.trim().replace(/\s+/g, " "), words });
}

function visit(sourceFile, node) {
  if (ts.isJsxText(node)) {
    const text = node.getText(sourceFile);
    const words = englishWords(text);
    if (text.trim() && words.length) report(sourceFile, node, "글자", text, words);
  } else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
    for (const text of renderedStrings(node.expression)) {
      const words = englishWords(text);
      if (words.length) report(sourceFile, node, "글자", text, words);
    }
  } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(sourceFile))) {
    const init = node.initializer;
    const texts = !init ? [] : ts.isStringLiteral(init) ? [init.text] : ts.isJsxExpression(init) ? renderedStrings(init.expression) : [];
    for (const text of texts) {
      const words = englishWords(text);
      if (words.length) report(sourceFile, node, node.name.getText(sourceFile), text, words);
    }
  } else if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && TEXT_PROPERTIES.has(node.name.text)) {
    for (const text of renderedStrings(node.initializer)) {
      const words = englishWords(text);
      if (words.length) report(sourceFile, node, node.name.text, text, words);
    }
  }
  ts.forEachChild(node, (child) => visit(sourceFile, child));
}

for (const file of listSource(srcDir)) {
  const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  visit(sourceFile, sourceFile);
}

const listOnly = process.argv.includes("--list");
if (violations.length) {
  for (const v of violations) console.log(`${v.file}:${v.line}  [${v.kind}] "${v.text}"  → ${[...new Set(v.words)].join(", ")}`);
  console.log(`\n영어 단어가 보이는 곳 ${violations.length}개 (허용: ${[...ALLOWED].join(", ")}).`);
  process.exit(listOnly ? 0 : 1);
}
console.log("화면 글자에 영어 단어가 없습니다.");
