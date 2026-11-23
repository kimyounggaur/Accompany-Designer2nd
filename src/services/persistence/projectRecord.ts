/**
 * 저장소에 넣고 빼는 기록의 모양을 만드는 순수 함수들(브라우저 저장소 없이 시험할 수 있다).
 */
import type { ProjectDoc } from "../../domain/types";
import { PROJECT_SCHEMA_VERSION, type ProjectRecord } from "./db";

/** 프로젝트 기록을 몇 개까지 남길지. 새 프로젝트를 시작해도 바로 이전 작업을 잃지 않게 한다(v1은 한 칸을 덮어썼다). */
export const MAX_PROJECT_RECORDS = 5;

/** 저장 공간을 이 비율 넘게 쓰면 경고한다. */
export const STORAGE_WARN_RATIO = 0.8;

/** 저장소에서 읽은 값이 v2 프로젝트 기록의 모양인가(옛 v1 "autosave" 칸이나 알 수 없는 값은 false). */
export function isProjectRecord(value: unknown): value is ProjectRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ProjectRecord>;
  return (
    record.schemaVersion === PROJECT_SCHEMA_VERSION &&
    !!record.doc &&
    typeof record.doc === "object" &&
    !!record.assetHashes &&
    typeof record.assetHashes === "object" &&
    !Array.isArray(record.assetHashes) &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt)
  );
}

export function buildProjectRecord(doc: ProjectDoc, assetHashes: Record<string, string>, updatedAt: number): ProjectRecord {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, doc, assetHashes, updatedAt };
}

/** 가장 최근에 저장한 `keep`개를 남기고 지울 프로젝트 id를 돌려준다. `protectId`(방금 저장한 프로젝트)는 절대 지우지 않는다. */
export function projectIdsToDelete(
  entries: ReadonlyArray<{ id: string; updatedAt: number }>,
  keep: number,
  protectId: string,
): string[] {
  const newestFirst = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = new Set<string>([protectId]);
  for (const entry of newestFirst) {
    if (kept.size >= keep) break;
    kept.add(entry.id);
  }
  return newestFirst.filter((entry) => !kept.has(entry.id)).map((entry) => entry.id);
}

/** 어느 프로젝트에서든 쓰이는 음원 해시 */
export function referencedHashes(records: ReadonlyArray<Pick<ProjectRecord, "assetHashes">>): Set<string> {
  const used = new Set<string>();
  for (const record of records) for (const hash of Object.values(record.assetHashes ?? {})) used.add(hash);
  return used;
}

/** 아무 프로젝트도 쓰지 않는 음원 해시(지워도 되는 것) */
export function orphanHashes(storedHashes: ReadonlyArray<string>, used: ReadonlySet<string>): string[] {
  return storedHashes.filter((hash) => !used.has(hash));
}

/** navigator.storage.estimate() 결과에서 쓴 비율(0~1). 알 수 없으면 undefined. */
export function storageUsageRatio(estimate: { usage?: number; quota?: number } | undefined): number | undefined {
  const usage = estimate?.usage;
  const quota = estimate?.quota;
  if (typeof usage !== "number" || typeof quota !== "number" || !(quota > 0)) return undefined;
  return usage / quota;
}

/** 저장 시각을 "02:41" 꼴(24시간제, 현지 시간)로 */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 자동 저장이 지켜보는 상태 조각(전체 스토어의 일부) */
export interface AutosaveSlice {
  name: string;
  bpm: number;
  tracks: unknown;
  assets: unknown;
  markers: unknown;
  /** 마스터 설정(볼륨)·박자표. 옛 시험 자료에는 없을 수 있다 */
  master?: unknown;
  timeSignature?: unknown;
}

/** 저장해야 할 문서(이름·템포·마스터·트랙·음원·마커)가 바뀌었는가. 선택·재생 위치·확대 같은 화면 상태는 저장 대상이 아니다. */
export function documentChanged(state: AutosaveSlice, previous: AutosaveSlice): boolean {
  return (
    state.name !== previous.name ||
    state.bpm !== previous.bpm ||
    state.tracks !== previous.tracks ||
    state.assets !== previous.assets ||
    state.markers !== previous.markers ||
    state.master !== previous.master ||
    state.timeSignature !== previous.timeSignature
  );
}

/** 변경 감시기. 문서 조각이 바뀔 때마다 부르고, 녹음 흐름이 끝나 쉬게 되면 `idle()`을 부른다. */
export interface ChangeWatcher {
  (state: AutosaveSlice, previous: AutosaveSlice): void;
  /** 녹음 흐름이 끝났다. 진행 중에 문서가 바뀌었다면 이제 저장을 예약한다. */
  idle(): void;
}

/**
 * 변경 감시기. 녹음하는 동안(`isBusy`)에는 저장을 예약하지 않고 "녹음 중에 바뀜"만 기억해 두었다가,
 * 녹음이 끝나 `idle()`이 불리면 한 번 예약한다. 녹음을 시작만 하고 취소해 문서가 그대로면 저장하지 않는다.
 * (녹음 중에는 문서가 바뀌지 않으므로 보통은 마지막에 "녹음 추가"가 들어올 때 한 번만 예약된다.)
 */
export function createChangeWatcher(onChange: () => void, isBusy: () => boolean): ChangeWatcher {
  let dirtyWhileBusy = false;
  const watcher = ((state: AutosaveSlice, previous: AutosaveSlice) => {
    const changed = documentChanged(state, previous);
    if (isBusy()) {
      if (changed) dirtyWhileBusy = true;
      return;
    }
    if (changed || dirtyWhileBusy) {
      dirtyWhileBusy = false;
      onChange();
    }
  }) as ChangeWatcher;
  watcher.idle = () => {
    if (!dirtyWhileBusy) return;
    dirtyWhileBusy = false;
    onChange();
  };
  return watcher;
}
