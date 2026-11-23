import { judgeRelink, listMissingAssets, mismatchReason, findMissingByHash, type MissingAsset } from "../domain/project/relink";
import type { AssetMeta } from "../domain/types";
import { ko } from "../i18n/ko";
import { attachAudio, readAudioFile, type ReadAudio } from "../services/importer";
import { notify, notifyError } from "../services/notify";
import { hasRememberedAudio } from "../services/persistence/audioBlobs";
import { useRelinkStore } from "../state/relinkStore";
import { useDawStore } from "../store/useDawStore";
import { requestAutosave } from "./autosaveControl";
import { decodeUpload, type ImportDeps } from "./importing";
import { getProjectSnapshot } from "./projectSnapshot";

/**
 * "음원 다시 연결" 대화상자의 동작(설계서 §P4-2). 상태는 `state/relinkStore`, 화면은 `ui/dialogs/RelinkDialog`.
 *
 *   고른 파일 → 풀고 해시 계산 → `domain/project/relink`가 판정
 *     같은 파일   → 바로 연결(해시가 같은 다른 빠진 음원도 함께)
 *     비슷한 파일 → 줄에 "이 파일로 연결할까요?"를 보이고 사용자가 [연결]을 누르면 연결
 *     다른 파일   → 연결하지 않고 이유를 보인다
 */

/** 확인을 기다리는 파일(음원 id → 읽은 결과). 화면 상태가 아니라 데이터 덩어리라 스토어 밖에 둔다. */
const pending = new Map<string, { file: File; read: ReadAudio }>();

/** 지금 프로젝트에서 소리 데이터가 빠진 음원들 */
export function missingAudio(): MissingAsset[] {
  return listMissingAssets(getProjectSnapshot(), hasRememberedAudio);
}

/** 대화상자를 연다. 빠진 음원이 없으면 없다고 알려 주는 대화상자가 열린다. */
export function openRelinkDialog(): void {
  useRelinkStore.getState().show(
    missingAudio().map(({ asset, clipCount }) => ({ assetId: asset.id, fileName: asset.fileName, duration: asset.duration, clipCount })),
  );
}

function discard(assetId: string): void {
  pending.get(assetId)?.read.release();
  pending.delete(assetId);
}

/** 빠진 음원들에 읽은 파일을 잇고 문서의 음원 정보를 갱신한다(실행 취소 기록에는 남기지 않는다). */
function link(targets: ReadonlyArray<AssetMeta>, file: File, read: ReadAudio, sameFile: boolean): void {
  const store = useDawStore.getState();
  for (const asset of targets) {
    store.updateAudioAsset(asset.id, attachAudio(asset, file, read), { history: false });
    useRelinkStore.getState().setRow(asset.id, { kind: "linked", sameFile });
  }
  requestAutosave(); // 문서가 그대로여도 저장할 음원 데이터가 늘었다
}

/** 줄의 [파일 찾기]에서 파일을 골랐다 */
export async function chooseRelinkFile(assetId: string, file: File, deps: ImportDeps = { decode: decodeUpload }): Promise<void> {
  const rows = useRelinkStore.getState();
  discard(assetId);
  rows.setRow(assetId, { kind: "checking" });
  try {
    const read = await readAudioFile(file, deps.decode);
    const missing = missingAudio();
    const target = missing.find((item) => item.asset.id === assetId);
    if (!target) {
      read.release(); // 그 사이 이미 연결되었다
      useRelinkStore.getState().setRow(assetId, { kind: "linked", sameFile: false });
      return;
    }
    const verdict = judgeRelink(target.asset, { fileName: file.name, duration: read.asset.duration, hash: read.hash });
    if (verdict === "same") {
      const sameFiles = findMissingByHash(missing, read.hash).map((item) => item.asset);
      link(sameFiles, file, read, true);
    } else if (verdict === "similar") {
      pending.set(assetId, { file, read });
      useRelinkStore.getState().setRow(assetId, { kind: "confirm", fileName: file.name, duration: read.asset.duration });
    } else {
      read.release();
      useRelinkStore.getState().setRow(assetId, {
        kind: "different",
        reason: mismatchReason(target.asset, read.asset),
        actualDuration: read.asset.duration,
      });
    }
  } catch (error) {
    useRelinkStore.getState().setRow(assetId, { kind: "failed", fileName: file.name });
    notifyError(error, { kind: "decode", title: ko.failed.decode(file.name), fileName: file.name });
  }
}

/** "이 파일로 연결할까요?"에서 [연결] */
export function confirmRelinkFile(assetId: string): void {
  const item = pending.get(assetId);
  if (!item) return;
  pending.delete(assetId);
  const target = missingAudio().find((candidate) => candidate.asset.id === assetId);
  if (!target) {
    item.read.release();
    return;
  }
  link([target.asset], item.file, item.read, false);
}

/** "이 파일로 연결할까요?"에서 [취소] */
export function declineRelinkFile(assetId: string): void {
  discard(assetId);
  useRelinkStore.getState().setRow(assetId, { kind: "waiting" });
}

/** 대화상자를 닫는다. 확인을 기다리던 파일은 버리고, 연결한 것이 있으면 결과를 알린다. */
export function closeRelinkDialog(): void {
  const { items, rows } = useRelinkStore.getState();
  for (const assetId of [...pending.keys()]) discard(assetId);
  const linked = items.filter((item) => rows[item.assetId]?.kind === "linked").length;
  useRelinkStore.getState().hide();
  if (linked > 0) {
    const remaining = items.length - linked;
    notify(remaining > 0 ? "warning" : "success", ko.notice.relinkDone(linked, remaining));
  }
}
