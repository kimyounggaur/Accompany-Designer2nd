/**
 * 값을 이어서 고치는 편집(키보드로 값 올리기, 단추 연타)을 한 단계로 묶는 key를 만든다.
 * 묶는 시간(800ms)과 묶는 방법은 state/history가 정한다. 여기서는 "무엇과 무엇이 같은 조작인가"만 정한다.
 *
 *  - 숫자만 바뀔 때만 key가 생긴다. 켜고 끄기·목록 고르기는 누를 때마다 한 단계다. 글자는 `name`만 묶는다(글자 입력은 초점 묶음이 따로 맡는다).
 *  - 이펙트 설정처럼 값이 묶음(객체)이면 안쪽 이름까지 key에 넣는다(`eq.bassGain`). 서로 다른 노브가 한 단계로 묶이지 않는다.
 *  - 아무것도 바뀌지 않으면 key가 없다.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @param scope  무엇의 값인가(`track:t1`, `clip:c1`처럼)
 * @param before 바꾸기 전 값들
 * @param patch  바꿀 값들(같은 값은 건너뛴다)
 */
export function editKey(scope: string, before: object, patch: object): string | undefined {
  const old = before as Record<string, unknown>;
  const fields: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    const previous = old[field];
    if (previous === value) continue;
    if (isRecord(value) && isRecord(previous)) {
      for (const inner of new Set([...Object.keys(previous), ...Object.keys(value)])) {
        if (previous[inner] === value[inner]) continue;
        if (!isNumber(value[inner])) return undefined;
        fields.push(`${field}.${inner}`);
      }
      continue;
    }
    if (isNumber(value) || (field === "name" && typeof value === "string")) {
      fields.push(field);
      continue;
    }
    return undefined;
  }
  return fields.length ? `${scope}:${fields.sort().join(",")}` : undefined;
}
