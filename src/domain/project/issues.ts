/**
 * 검사 결과의 모양(설계서 §P4-1). 검사기 하나가 파일·자동 저장·프리셋을 모두 읽고, 고친 것과 막힌 것을 이 모양으로 돌려준다.
 *
 *  - missing : 있어야 할 항목이 없다
 *  - type    : 자료형이 다르다(숫자 자리에 글자 등)
 *  - range   : 숫자가 허용 범위 밖이거나 유한한 수가 아니다 → 가장 가까운 허용값으로 고친다
 *  - enum    : 허용된 값 중 하나가 아니다
 *  - unsafe  : 주소(URL·blob:·javascript:)처럼 보이는 글자, 쓸 수 없는 id
 *  - limit   : 개수·길이 상한을 넘었다
 */
export type IssueProblem = "missing" | "type" | "range" | "enum" | "unsafe" | "limit";

export type Issue = { path: string; problem: IssueProblem; fixed: boolean };

export type Parsed<T> = { ok: true; value: T; issues: Issue[] } | { ok: false; issues: Issue[] };

/** 검사하는 동안 쌓는 기록. 못 고치는 문제를 만나면 `fail`이 던지고, 맨 바깥(parseProject 등)이 받아 `{ ok: false }`로 돌려준다. */
export class IssueLog {
  readonly issues: Issue[] = [];

  /** 고친 항목을 남긴다 */
  fixed(path: string, problem: IssueProblem): void {
    this.issues.push({ path, problem, fixed: true });
  }

  /** 못 고치는 문제: 기록하고 검사를 멈춘다 */
  fail(path: string, problem: IssueProblem): never {
    this.issues.push({ path, problem, fixed: false });
    throw new Rejected();
  }
}

/** 검사를 멈추려고 던지는 값(바깥으로 나가지 않는다) */
export class Rejected extends Error {
  constructor() {
    super("rejected");
  }
}

/** 검사를 돌려 `Parsed`로 만든다. 던져진 `Rejected`만 받고, 다른 오류(프로그램 실수)는 그대로 던진다. */
export function runParse<T>(run: (log: IssueLog) => T): Parsed<T> {
  const log = new IssueLog();
  try {
    const value = run(log);
    return { ok: true, value, issues: log.issues };
  } catch (error) {
    if (error instanceof Rejected) return { ok: false, issues: log.issues };
    throw error;
  }
}

/** 고친 값의 개수(불러온 뒤 "값 N개를 허용 범위로 고쳤습니다" 안내에 쓴다) */
export function countFixed(issues: ReadonlyArray<Issue>): number {
  return issues.filter((issue) => issue.fixed).length;
}

/** 못 고친 첫 문제를 사람이 읽을 수 있는 짧은 설명으로 (개발용 detail에 쓴다) */
export function describeFailure(issues: ReadonlyArray<Issue>): string {
  const blocking = issues.find((issue) => !issue.fixed);
  if (!blocking) return "";
  return `${blocking.path || "(전체)"}: ${blocking.problem}`;
}
