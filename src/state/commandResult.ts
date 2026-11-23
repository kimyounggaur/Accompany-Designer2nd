/**
 * 스토어 갱신 함수가 돌려주는 결과.
 * 스토어는 안내 문구를 만들지 않는다. 성공/거절과 이유만 돌려주고, 문구는 app/actions가 정한다.
 */
export type CommandResult<Reason extends string = never, Data extends object = Record<never, never>> =
  | ({ ok: true } & Data)
  | { ok: false; reason: Reason };

export function ok<Data extends object = Record<never, never>>(data?: Data): { ok: true } & Data {
  return { ok: true, ...(data as Data) };
}

export function fail<Reason extends string>(reason: Reason): { ok: false; reason: Reason } {
  return { ok: false, reason };
}
