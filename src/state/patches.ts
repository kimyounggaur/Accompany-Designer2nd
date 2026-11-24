/**
 * immer 패치열을 다루는 순수한 도우미(이력 단계가 쓴다).
 * 문서도 저장소도 모른다.
 */
import type { Patch } from "immer";

/** 빈 경로(문서 전체)를 가리키는 표시 */
const ROOT = "\u0000";
const SEP = "\u0001";

/**
 * "바꾸기"(replace)만으로 된 패치열에서, 나중에 같은 자리(또는 그 자리를 품은 윗자리)를 다시 바꾼 앞선 패치를 버린다.
 * 뒤의 패치가 그 자리를 통째로 덮어쓰므로 적용한 결과 문서는 같다. 끌기 600번이 패치 1개로 줄어든다.
 *
 * 줄일 수 없으면(버릴 것이 없거나, add·remove가 섞여 배열 번호가 밀릴 수 있으면) undefined를 돌려준다.
 * 이때 원래 패치열을 그대로 쓴다.
 */
export function compactReplacePatches(patches: readonly Patch[]): Patch[] | undefined {
  if (patches.length < 2) return undefined;
  for (const patch of patches) {
    if (patch.op !== "replace") return undefined;
  }

  // 뒤에서부터 보며 "이미 나중에 바뀐 자리"를 모은다. 자기 자리나 윗자리가 그 안에 있으면 버려도 되는 패치다.
  const overwritten = new Set<string>();
  const keep: boolean[] = new Array(patches.length).fill(false);
  let dropped = 0;
  for (let index = patches.length - 1; index >= 0; index -= 1) {
    const path = patches[index].path;
    let key = ROOT;
    let dead = false;
    for (let depth = 0; ; depth += 1) {
      if (overwritten.has(key)) {
        dead = true;
        break;
      }
      if (depth === path.length) break;
      key = key === ROOT ? String(path[depth]) : key + SEP + String(path[depth]);
    }
    if (dead) {
      dropped += 1;
    } else {
      keep[index] = true;
      overwritten.add(key);
    }
  }
  if (dropped === 0) return undefined;
  return patches.filter((_, index) => keep[index]);
}

/** 패치열을 JSON으로 썼을 때의 글자 수(메모리 크기를 가늠하는 값. 시험·점검용) */
export function patchBytes(patches: readonly Patch[]): number {
  return JSON.stringify(patches).length;
}
