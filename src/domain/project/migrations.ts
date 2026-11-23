/**
 * 문서 형식의 버전 감지와 이전(설계서 §P4-1).
 *
 *   v0  6월 master    프로젝트 JSON(`format` 없음)                              음원 없음
 *   v1  11월 codex    { format, version: 1, project, audio: { id: "data:…" } }  base64
 *   v2  이 설계       { format, schemaVersion: 2, doc } (+ 음원은 파일 쪽)       원본 바이트
 *
 * v0과 v1은 안쪽 프로젝트 모양이 같다(v1은 그것을 껍데기로 감싸고 음원을 더한 것). 그래서 이전은 한 걸음이다:
 * "옛 프로젝트 모양" → "v2 모양의 아직 검사 전 값". 검사(범위·자료형)는 parseProject가 v2 모양으로 한 번만 한다.
 *
 * 이전 규칙: `audioAssets` → `assets`(`waveformPeaks`·`blobUrl` 제거, `sourceType` → `source`), `timeMarkers` → `markers`,
 * `timeSignature { beats: 4, unit: 4 }`·`master { volumeDb: 0 }` 추가.
 * (설계서의 "스냅 값 line → halfBeat"는 문서가 아니라 화면 설정의 일이라 6단계 P5-6에서 한다.)
 */
import { MASTER_VOLUME_DEFAULT_DB } from "../master/volume";
import { DEFAULT_TIME_SIGNATURE } from "./defaults";
import type { IssueLog } from "./issues";
import { isObject, type Obj } from "./readers";

/** 프로젝트 파일(껍데기)이 쓰는 형식 이름. v1부터 같다. */
export const FORMAT = "accompany-designer-project";
export const SCHEMA_VERSION = 2;

export type Detected =
  /** v2 문서(껍데기 안이거나 문서 자체) */
  | { kind: "v2"; doc: unknown }
  /** v0·v1의 옛 프로젝트 모양 */
  | { kind: "legacy"; project: unknown; version: 0 | 1 };

/** 무엇으로 쓴 값인지 알아낸다. 알 수 없는 형식·더 새로운 버전은 실패한다. */
export function detectVersion(log: IssueLog, raw: unknown): Detected {
  if (!isObject(raw)) return log.fail("", "type");

  if ("format" in raw) {
    if (raw.format !== FORMAT) return log.fail("format", "enum");
    if (raw.schemaVersion !== undefined) {
      if (raw.schemaVersion !== SCHEMA_VERSION) return log.fail("schemaVersion", "enum");
      return { kind: "v2", doc: raw.doc };
    }
    if (raw.version === 1) return { kind: "legacy", project: raw.project, version: 1 };
    return log.fail("version", "enum");
  }

  if (raw.schemaVersion !== undefined) {
    if (raw.schemaVersion !== SCHEMA_VERSION) return log.fail("schemaVersion", "enum");
    return { kind: "v2", doc: raw };
  }
  // 6월 프로젝트에는 껍데기 표시가 없다. 트랙 목록조차 없으면 프로젝트가 아닌 다른 JSON 파일로 본다.
  if (!Array.isArray(raw.tracks)) return log.fail("", "type");
  return { kind: "legacy", project: raw, version: 0 };
}

/** 옛 음원 정보 → v2 음원 정보(검사 전). 다시 만들 수 있는 `waveformPeaks`·`blobUrl`은 가져가지 않는다. */
function migrateAsset(asset: unknown): unknown {
  if (!isObject(asset)) return asset; // 검사기가 자료형 오류로 거른다
  const { id, fileName, duration, sampleRate, channels, mimeType, byteSize, detectedBpm, recordedAt } = asset;
  return {
    id,
    fileName,
    duration,
    sampleRate,
    channels,
    source: asset.sourceType === "recording" ? "recording" : "upload",
    mimeType,
    byteSize,
    detectedBpm,
    recordedAt,
  };
}

/** 옛 프로젝트 모양 → v2 모양(검사 전) */
export function migrateLegacyProject(project: unknown, log: IssueLog): Obj {
  if (!isObject(project)) return log.fail("", "type");
  const assets = project.audioAssets;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: project.id,
    name: project.name,
    bpm: project.bpm,
    timeSignature: { ...DEFAULT_TIME_SIGNATURE },
    sampleRate: project.sampleRate,
    master: project.master === undefined ? { volumeDb: MASTER_VOLUME_DEFAULT_DB } : project.master,
    tracks: project.tracks,
    assets: isObject(assets) ? Object.fromEntries(Object.entries(assets).map(([key, value]) => [key, migrateAsset(value)])) : assets,
    markers: project.timeMarkers,
  };
}
