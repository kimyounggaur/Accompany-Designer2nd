/**
 * 브라우저 안 저장소(IndexedDB) 연결.
 *
 * 데이터베이스 "accompany-designer"
 *  - v1: 저장소 projects 하나. 키 "autosave" 한 칸에 `{format, version, project, audio}` 통째로.
 *  - v2: 저장소 4개
 *      projects  키=프로젝트 id      값=ProjectRecord   (문서 + 음원 해시 목록)
 *      assets    키=음원 해시(SHA-256) 값=AssetRecord     (같은 음원은 한 번만 저장)
 *      peaks     키=`${해시}:${단계}`  값=파형 최소·최대값 (P4-3에서 사용, 지금은 비어 있음)
 *      meta      키=이름              값=문자열           (lastProjectId 등)
 *
 * 올림 처리(onupgradeneeded) 안에서는 비동기 해시 계산을 기다릴 수 없으므로 새 저장소만 만든다.
 * 옛 자동 저장(v1)을 새 구조로 옮기는 일은 연 다음에 한다(autosave.ts의 migrateLegacyAutosave).
 */
import type { ProjectDoc } from "../../domain/types";

export const DB_NAME = "accompany-designer";
export const DB_VERSION = 2;

export const STORE = {
  projects: "projects",
  assets: "assets",
  peaks: "peaks",
  meta: "meta",
} as const;

/** v1에서 자동 저장 한 칸이 쓰던 키 */
export const LEGACY_AUTOSAVE_KEY = "autosave";
export const META_LAST_PROJECT_ID = "lastProjectId";

export const PROJECT_SCHEMA_VERSION = 2;

export interface ProjectRecord {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  /**
   * 프로젝트 문서(문서 형식 v2). 기록의 `schemaVersion`은 이 기록의 칸 구조 버전이라 그대로 2다.
   * 6월~11월 초에 저장된 기록의 문서는 옛 모양(audioAssets·timeMarkers·waveformPeaks)이며, 읽을 때 검사기(parseProject)가 새 모양으로 바꾼다.
   */
  doc: ProjectDoc;
  /** 음원 id → 해시. 음원 데이터는 assets 저장소에 있다. 데이터가 없는 음원(다시 연결 필요)은 빠져 있다. */
  assetHashes: Record<string, string>;
  updatedAt: number;
}

export interface AssetRecord {
  blob: Blob;
  mimeType: string;
  byteSize: number;
  addedAt: number;
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // v1의 projects 저장소는 그대로 둔다(옛 자동 저장 한 칸이 들어 있다). 없는 저장소만 만든다.
      for (const name of Object.values(STORE)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 다른 탭이 더 새 버전으로 올리려 하면 길을 비켜 준다.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("자동 저장 공간을 열 수 없습니다."));
    request.onblocked = () => reject(new Error("자동 저장 공간이 다른 탭에서 사용 중입니다."));
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("자동 저장 공간을 읽지 못했습니다."));
  });
}

/** 트랜잭션이 끝까지 반영되면 풀리고, 저장 공간 부족 같은 이유로 취소되면 그 오류로 거절된다. */
export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("자동 저장에 실패했습니다."));
    tx.onabort = () => reject(tx.error ?? new Error("자동 저장이 취소되었습니다."));
  });
}

/** 연결을 열어 일을 하고, 끝나면(실패해도) 닫는다. */
export async function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await run(db);
  } finally {
    db.close();
  }
}
