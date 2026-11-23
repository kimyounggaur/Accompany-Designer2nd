/**
 * 화면 오류 안내의 [오류 내용 복사]에 담길 글. 문의할 때 그대로 붙여 넣을 수 있게 짧고 평범한 글자로 만든다.
 * 프로젝트 내용(곡 이름·음원)은 넣지 않는다.
 */

export interface CrashReportInput {
  error: unknown;
  componentStack?: string;
  buildCommit: string;
  buildTime: string;
  now: Date;
  userAgent: string;
  /** 주소에서 쿼리를 뺀 값 */
  page: string;
}

const MAX_STACK_CHARS = 4000;

function describe(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack ?? "" };
  if (error && typeof error === "object") {
    const record = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof record.name === "string" ? record.name : "Error",
      message: typeof record.message === "string" ? record.message : String(error),
      stack: typeof record.stack === "string" ? record.stack : "",
    };
  }
  return { name: "Error", message: String(error), stack: "" };
}

const clip = (text: string) => (text.length > MAX_STACK_CHARS ? `${text.slice(0, MAX_STACK_CHARS)}\n… (이하 생략)` : text);

export function buildCrashReport(input: CrashReportInput): string {
  const { name, message, stack } = describe(input.error);
  return [
    "반주 디자이너 2 오류 내용",
    `빌드: ${input.buildCommit} (${input.buildTime})`,
    `시각: ${input.now.toISOString()}`,
    `주소: ${input.page}`,
    `브라우저: ${input.userAgent}`,
    "",
    `오류: ${name}: ${message}`,
    stack ? `\n호출 순서:\n${clip(stack)}` : "",
    input.componentStack ? `\n화면 부품 위치:\n${clip(input.componentStack.trim())}` : "",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
    .trimEnd();
}
