/**
 * 자동 저장 서비스 (IndexedDB v2).
 *
 *  - saveAutosave   : 프로젝트 문서 + 음원을 한 번의 트랜잭션으로 쓴다(음원은 해시로 한 번만).
 *  - loadAutosave   : 마지막으로 저장한 프로젝트를 읽는다. 옛 형식(v1)이 남아 있으면 먼저 새 구조로 옮긴다.
 *  - startAutosave  : 변경 감지 → 1.2초 뒤 저장, 탭을 숨기거나 닫을 때 바로 저장, 닫을 때 경고, 저장 공간 점검.
 *
 * 화면(React)과 오디오 엔진은 모른다. 필요한 것(현재 프로젝트, 음원 데이터, 변경 알림)은 호출하는 쪽이 넘겨 준다(AutosaveHost).
 */
import { ko } from "../../i18n/ko";
import { useAutosaveStore } from "../../state/autosaveStore";
import { FORMAT, VERSION, projectCopy, validateProject, type Stored } from "../../storage/projectStorage";
import type { DawProject } from "../../types";
import { notify, notifyError } from "../notify";
import { assetKey } from "./assetHash";
import {
  LEGACY_AUTOSAVE_KEY,
  META_LAST_PROJECT_ID,
  STORE,
  requestToPromise,
  transactionDone,
  withDb,
  type AssetRecord,
  type ProjectRecord,
} from "./db";
import {
  MAX_PROJECT_RECORDS,
  STORAGE_WARN_RATIO,
  buildProjectRecord,
  createChangeWatcher,
  isProjectRecord,
  orphanHashes,
  projectIdsToDelete,
  referencedHashes,
  storageUsageRatio,
  type AutosaveSlice,
} from "./projectRecord";
import { AutosaveScheduler } from "./scheduler";

// ───────────────────────── 쓰기 ─────────────────────────

export interface SaveOutcome {
  projectId: string;
  /** 이번 기록이 가리키는 음원 해시 */
  hashes: Set<string>;
  hadAudio: boolean;
}

function assetRecord(blob: Blob, addedAt: number): AssetRecord {
  return { blob, mimeType: blob.type, byteSize: blob.size, addedAt };
}

/** 음원이 아직 저장소에 없을 때만 넣는다(같은 해시는 한 번만 저장). 트랜잭션 안에서 부른다. */
function putAssetIfMissing(store: IDBObjectStore, hash: string, blob: Blob, addedAt: number): void {
  const exists = store.getKey(hash);
  exists.onsuccess = () => {
    if (exists.result === undefined) store.put(assetRecord(blob, addedAt), hash);
  };
}

/**
 * 프로젝트를 저장한다. 문서 기록·음원·"마지막 프로젝트" 표시가 한 트랜잭션이라
 * 중간에 실패(저장 공간 부족 등)하면 전부 취소되어 이전 기록이 그대로 남는다.
 */
export async function saveAutosave(
  project: DawProject,
  audioFor: (assetId: string) => Blob | undefined,
  now: number = Date.now(),
): Promise<SaveOutcome> {
  const doc = projectCopy(project);
  const assetHashes: Record<string, string> = {};
  const blobsByHash = new Map<string, Blob>();
  for (const assetId of Object.keys(doc.audioAssets)) {
    const blob = audioFor(assetId);
    if (!blob) continue; // 데이터가 없는 음원(다시 연결 필요)은 문서에만 남긴다.
    const hash = await assetKey(blob, `${doc.id}:${assetId}`);
    assetHashes[assetId] = hash;
    if (!blobsByHash.has(hash)) blobsByHash.set(hash, blob);
  }
  const record = buildProjectRecord(doc, assetHashes, now);

  await withDb(async (db) => {
    const tx = db.transaction([STORE.assets, STORE.projects, STORE.meta], "readwrite");
    const done = transactionDone(tx);
    done.catch(() => undefined); // 아래에서 기다리기 전에 던져진 오류가 '처리 안 된 거절'로 남지 않게
    const assets = tx.objectStore(STORE.assets);
    for (const [hash, blob] of blobsByHash) putAssetIfMissing(assets, hash, blob, now);
    tx.objectStore(STORE.projects).put(record, doc.id);
    tx.objectStore(STORE.meta).put(doc.id, META_LAST_PROJECT_ID);
    await done;
  });

  return { projectId: doc.id, hashes: new Set(blobsByHash.keys()), hadAudio: blobsByHash.size > 0 };
}

/**
 * 오래된 프로젝트 기록(최근 MAX_PROJECT_RECORDS개만 남김)과 어느 기록도 쓰지 않는 음원을 지운다.
 * 저장 직후 따로 하는 정리라서 실패해도 저장 결과에는 영향이 없다. 기록과 음원을 한 트랜잭션에서 보므로
 * 다른 탭이 동시에 저장하더라도 방금 저장된 음원을 잘못 지우지 않는다.
 */
export async function pruneStorage(protectId: string): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction([STORE.projects, STORE.assets], "readwrite");
    const done = transactionDone(tx);
    done.catch(() => undefined);
    const projects = tx.objectStore(STORE.projects);
    const assets = tx.objectStore(STORE.assets);
    const [keys, values, assetKeys] = await Promise.all([
      requestToPromise(projects.getAllKeys()),
      requestToPromise(projects.getAll()),
      requestToPromise(assets.getAllKeys()),
    ]);
    const entries = keys.flatMap((key, index) => {
      const value: unknown = values[index];
      // 옛 자동 저장 한 칸(아직 못 옮긴 경우)이나 알 수 없는 값은 건드리지 않는다.
      return typeof key === "string" && isProjectRecord(value) ? [{ id: key, record: value }] : [];
    });
    const doomed = new Set(projectIdsToDelete(entries.map((e) => ({ id: e.id, updatedAt: e.record.updatedAt })), MAX_PROJECT_RECORDS, protectId));
    for (const id of doomed) projects.delete(id);
    const used = referencedHashes(entries.filter((e) => !doomed.has(e.id)).map((e) => e.record));
    for (const hash of orphanHashes(assetKeys.filter((key): key is string => typeof key === "string"), used)) assets.delete(hash);
    await done;
  });
}

// ───────────────────────── 읽기 ─────────────────────────

export interface LoadedAutosave {
  /** 프로젝트 파일과 같은 모양이라 restoreAudio가 그대로 받는다 */
  stored: Stored;
  updatedAt: number;
}

export async function loadAutosave(): Promise<LoadedAutosave | undefined> {
  return withDb(async (db) => {
    await migrateLegacyAutosave(db);

    const tx = db.transaction([STORE.projects, STORE.assets, STORE.meta], "readonly");
    const projects = tx.objectStore(STORE.projects);
    const lastId = await requestToPromise<unknown>(tx.objectStore(STORE.meta).get(META_LAST_PROJECT_ID));
    let record: unknown = typeof lastId === "string" ? await requestToPromise<unknown>(projects.get(lastId)) : undefined;

    if (!isProjectRecord(record)) {
      // 표시가 없거나 가리키는 기록이 없으면 가장 최근에 저장한 기록을 쓴다.
      const values = await requestToPromise<unknown[]>(projects.getAll());
      record = values.filter(isProjectRecord).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    }
    if (!isProjectRecord(record)) return undefined;

    const project = validateProject(record.doc);
    const assets = tx.objectStore(STORE.assets);
    const audio: Record<string, Blob> = {};
    await Promise.all(
      Object.entries(record.assetHashes).map(async ([assetId, hash]) => {
        if (!(assetId in project.audioAssets)) return;
        const stored = await requestToPromise<unknown>(assets.get(hash));
        const blob = (stored as Partial<AssetRecord> | undefined)?.blob;
        if (blob instanceof Blob) audio[assetId] = blob;
      }),
    );
    return { stored: { format: FORMAT, version: VERSION, project, audio }, updatedAt: record.updatedAt };
  });
}

// ───────────────────────── 옛 자동 저장(v1) 이전 ─────────────────────────

export type MigrationResult = "none" | "migrated" | "skipped";

/**
 * v1은 projects 저장소의 "autosave" 한 칸에 `{format, version, project, audio}`를 통째로 넣었다.
 * 그 칸을 새 구조(projects/assets/meta)로 옮기고 옛 칸을 지운다.
 *  - 해시 계산은 비동기라 트랜잭션 안에서 기다릴 수 없으므로 먼저 읽고 계산한 뒤, 쓰기 트랜잭션에서 옛 칸이 아직 있는지 다시 확인한다.
 *  - 새 기록 쓰기와 옛 칸 삭제는 한 트랜잭션이라 중간에 끊겨도 옛 데이터가 사라지지 않는다.
 *  - 이미 새 형식의 "마지막 프로젝트"가 있으면 새 쪽이 더 최신이므로 옮기지 않는다(옛 칸은 그대로 둔다).
 *  - 읽을 수 없는 옛 데이터는 지우지 않고 오류로 알린다.
 */
export async function migrateLegacyAutosave(db: IDBDatabase, now: number = Date.now()): Promise<MigrationResult> {
  const probe = db.transaction([STORE.projects, STORE.meta], "readonly");
  const [legacy, newer] = await Promise.all([
    requestToPromise<unknown>(probe.objectStore(STORE.projects).get(LEGACY_AUTOSAVE_KEY)),
    requestToPromise<unknown>(probe.objectStore(STORE.meta).get(META_LAST_PROJECT_ID)),
  ]);
  if (legacy === undefined) return "none";
  if (newer !== undefined) return "skipped";

  const value = legacy as Partial<Stored> | null;
  if (!value || typeof value !== "object" || value.format !== FORMAT || value.version !== VERSION) throw new Error("지원하지 않는 자동 저장 형식입니다.");
  const project = validateProject(value.project);

  const assetHashes: Record<string, string> = {};
  const blobsByHash = new Map<string, Blob>();
  for (const [assetId, blob] of Object.entries(value.audio ?? {})) {
    if (!(assetId in project.audioAssets) || !(blob instanceof Blob)) continue;
    const hash = await assetKey(blob, `${project.id}:${assetId}`);
    assetHashes[assetId] = hash;
    if (!blobsByHash.has(hash)) blobsByHash.set(hash, blob);
  }
  const record = buildProjectRecord(project, assetHashes, now);

  const tx = db.transaction([STORE.projects, STORE.assets, STORE.meta], "readwrite");
  const done = transactionDone(tx);
  done.catch(() => undefined);
  const projects = tx.objectStore(STORE.projects);
  const meta = tx.objectStore(STORE.meta);
  const [stillThere, movedByOtherTab] = await Promise.all([
    requestToPromise<unknown>(projects.get(LEGACY_AUTOSAVE_KEY)),
    requestToPromise<unknown>(meta.get(META_LAST_PROJECT_ID)),
  ]);
  if (stillThere === undefined || movedByOtherTab !== undefined) {
    await done; // 다른 탭이 먼저 옮겼다.
    return "skipped";
  }
  const assets = tx.objectStore(STORE.assets);
  for (const [hash, blob] of blobsByHash) putAssetIfMissing(assets, hash, blob, now);
  projects.put(record, project.id);
  meta.put(project.id, META_LAST_PROJECT_ID);
  projects.delete(LEGACY_AUTOSAVE_KEY);
  await done;
  return "migrated";
}

// ───────────────────────── 저장 공간 ─────────────────────────

/**
 * 브라우저가 저장소를 마음대로 비우지 않도록 요청하고(음원을 처음 저장한 뒤 한 번),
 * 저장 공간을 80% 넘게 쓰고 있으면 세션당 한 번 경고한다. 둘 다 실패해도 자동 저장에는 영향이 없다.
 */
export function createStorageGuard(
  storage: Pick<StorageManager, "persist" | "estimate"> | undefined = typeof navigator === "undefined" ? undefined : navigator.storage,
) {
  let persistRequested = false;
  let warned = false;
  return async function check(hadAudio: boolean): Promise<void> {
    if (!storage) return;
    try {
      if (hadAudio && !persistRequested && typeof storage.persist === "function") {
        persistRequested = true;
        await storage.persist();
      }
    } catch {
      /* 요청이 거절되어도 계속 저장한다 */
    }
    try {
      if (!warned && typeof storage.estimate === "function") {
        const ratio = storageUsageRatio(await storage.estimate());
        if (ratio !== undefined && ratio >= STORAGE_WARN_RATIO) {
          warned = true;
          notify("warning", ko.autosave.storageNearlyFull(Math.min(100, Math.round(ratio * 100))));
        }
      }
    } catch {
      /* 사용량을 알 수 없으면 경고하지 않는다 */
    }
  };
}

// ───────────────────────── 시작 ─────────────────────────

export interface AutosaveHost {
  /** 지금 프로젝트 문서 */
  getProject: () => DawProject;
  /** 음원 id에 해당하는 원본 데이터(없으면 undefined) */
  recallAudio: (assetId: string) => Blob | undefined;
  /** 상태가 바뀔 때마다 (새 상태, 이전 상태)로 불린다. 해제 함수를 돌려준다. */
  subscribe: (listener: (state: AutosaveSlice, previous: AutosaveSlice) => void) => () => void;
  isRecording: () => boolean;
  /** 저장 실패 안내의 [프로젝트 파일로 저장] 단추가 부르는 동작 */
  exportToFile: () => void;
}

export interface AutosaveHandle {
  /** 복구가 끝났으니 이제부터 저장한다. `dirty`는 복구를 기다리는 사이 사용자가 문서를 바꿨다는 뜻이다. */
  markReady: (options?: { dirty?: boolean }) => void;
  flush: () => Promise<void>;
  hasUnsaved: () => boolean;
  dispose: () => void;
}

export function startAutosave(host: AutosaveHost): AutosaveHandle {
  let lastHashes = new Set<string>();
  let lastProjectId: string | undefined;
  const guard = createStorageGuard();

  const scheduler = new AutosaveScheduler({
    save: async () => {
      const outcome = await saveAutosave(host.getProject(), host.recallAudio);
      // 프로젝트가 바뀌었거나(새 기록 생김) 이 프로젝트에서 음원이 빠졌을 때만 정리한다.
      const dropped = [...lastHashes].some((hash) => !outcome.hashes.has(hash));
      const needsPrune = lastProjectId === undefined || lastProjectId !== outcome.projectId || dropped;
      lastHashes = outcome.hashes;
      lastProjectId = outcome.projectId;
      if (needsPrune) await pruneStorage(outcome.projectId).catch(() => undefined);
      void guard(outcome.hadAudio);
    },
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    now: () => Date.now(),
    isPaused: host.isRecording,
    onStatus: (status) => useAutosaveStore.getState().setStatus(status),
    onError: (error) =>
      notifyError(error, { kind: "autosave", title: ko.failed.autosave }, { action: { label: ko.action.saveProjectFile, run: host.exportToFile } }),
  });

  const unsubscribe = host.subscribe(createChangeWatcher(() => scheduler.changed()));

  // 탭이 가려지거나(화면 전환·창 닫기 직전) 페이지가 사라질 때 기다리지 않고 바로 저장을 시작한다. 마감 전에 끝난다는 보장은 없다(최선).
  const onVisibility = () => {
    if (document.visibilityState === "hidden") void scheduler.flush();
  };
  const onPageHide = () => void scheduler.flush();
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (scheduler.hasUnsaved() || host.isRecording()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onBeforeUnload);

  return {
    markReady: (options) => {
      scheduler.markReady();
      if (options?.dirty) scheduler.changed();
    },
    flush: () => scheduler.flush(),
    hasUnsaved: () => scheduler.hasUnsaved(),
    dispose: () => {
      scheduler.dispose();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      useAutosaveStore.getState().reset();
    },
  };
}
