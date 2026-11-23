/**
 * 문서 → 프로젝트 파일의 `project.json` 내용(설계서 §P4-1). 되돌려 읽는 쪽은 `parseProject`이고,
 * `parseProject(serialize(doc)).value`는 원래 `doc`과 같다(왕복).
 *
 * 음원 데이터는 이 값에 없다. 파일을 쓰는 쪽(services/persistence/projectFile)이 문서의 `assets`를 보고 따로 담는다.
 */
import type { ProjectDoc } from "../types";
import { FORMAT, SCHEMA_VERSION } from "./migrations";

export { FORMAT, SCHEMA_VERSION };

export interface ProjectFileJson {
  format: typeof FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  doc: ProjectDoc;
}

export function serialize(doc: ProjectDoc): ProjectFileJson {
  return { format: FORMAT, schemaVersion: SCHEMA_VERSION, doc };
}
