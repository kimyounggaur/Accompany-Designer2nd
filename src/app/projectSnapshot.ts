import { getDoc } from "../state/projectStore";
import type { ProjectDoc } from "../domain/types";

/**
 * 지금 화면의 프로젝트 문서. 저장·재생·내보내기가 모두 이 문서를 받는다.
 * 문서(형식 v2)에는 파형·재생 주소처럼 실행 중에만 의미 있는 값이 없으므로 그대로 돌려준다.
 */
export function getProjectSnapshot(): ProjectDoc {
  return getDoc();
}
