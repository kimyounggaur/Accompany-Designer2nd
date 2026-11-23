/**
 * 음원 다시 연결 규칙(설계서 §P4-2). 프로젝트를 열었는데 음원 데이터가 빠져 있을 때,
 * 사용자가 고른 파일이 그 음원과 같은 것인지 판정한다. 화면·저장소를 모르는 순수 함수라 Node 시험으로 모두 검사한다.
 *
 *   같은 파일    해시가 같다                                                  → 확인 없이 연결
 *   비슷한 파일  이름이 같고 길이 차이가 0.25초 이내(해시는 다르거나 기록이 없다)  → "이 파일로 연결할까요?" 확인 뒤 연결
 *   다른 파일    그 밖                                                        → 연결하지 않고 이유를 알린다
 *
 * 해시가 기록되지 않은 음원(6월·11월 형식 파일)은 같은 파일인지 증명할 수 없으므로 "같은 파일"이 되지 못하고, 이름과 길이만으로 "비슷한 파일"이 된다.
 */
import type { AssetMeta, ProjectDoc } from "../types";

/** "길이가 같다"고 보는 차이(초). 인코더·디코더마다 끝 무음이 조금씩 달라서 완전히 같지 않을 수 있다. */
export const RELINK_DURATION_TOLERANCE_SECONDS = 0.25;

export type RelinkVerdict = "same" | "similar" | "different";

export interface RelinkCandidate {
  fileName: string;
  duration: number;
  /** 고른 파일의 SHA-256. 계산하지 못한 환경에서는 없다. */
  hash?: string;
}

/** 파일 이름 비교용: 운영체제마다 다른 한글 조합 방식(NFC·NFD)과 대소문자 차이를 없앤다. */
function comparableName(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/** 고른 파일(candidate)이 빠진 음원(missing)과 같은 것인지 판정한다. */
export function judgeRelink(missing: Pick<AssetMeta, "fileName" | "duration" | "hash">, candidate: RelinkCandidate): RelinkVerdict {
  if (missing.hash && candidate.hash && missing.hash === candidate.hash) return "same";
  const sameName = comparableName(missing.fileName) === comparableName(candidate.fileName);
  // 부동소수점 오차(0.25000000000000006 같은 값)로 경계에서 뒤집히지 않게 아주 작은 여유를 둔다.
  const closeLength = Math.abs(missing.duration - candidate.duration) <= RELINK_DURATION_TOLERANCE_SECONDS + 1e-9;
  return sameName && closeLength ? "similar" : "different";
}

/** 다른 파일로 판정했을 때 안내에 쓸 이유: 길이가 크게 다르면 "length", 아니면(이름이 다르다) "name" */
export function mismatchReason(missing: Pick<AssetMeta, "duration">, candidate: Pick<RelinkCandidate, "duration">): "length" | "name" {
  return Math.abs(missing.duration - candidate.duration) > RELINK_DURATION_TOLERANCE_SECONDS + 1e-9 ? "length" : "name";
}

/** 데이터가 빠진 음원 한 개와 그것을 쓰는 클립 수 */
export interface MissingAsset {
  asset: AssetMeta;
  clipCount: number;
}

/** 음원 id → 그것을 쓰는 클립 수 */
export function countClipsByAsset(tracks: ProjectDoc["tracks"]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    for (const clip of track.clips) counts.set(clip.audioBufferId, (counts.get(clip.audioBufferId) ?? 0) + 1);
  }
  return counts;
}

/** 소리 데이터가 없는 음원들(`hasAudio`가 거짓인 것)을 문서 순서대로 모은다. */
export function listMissingAssets(doc: Pick<ProjectDoc, "assets" | "tracks">, hasAudio: (assetId: string) => boolean): MissingAsset[] {
  const counts = countClipsByAsset(doc.tracks);
  return Object.values(doc.assets)
    .filter((asset) => !hasAudio(asset.id))
    .map((asset) => ({ asset, clipCount: counts.get(asset.id) ?? 0 }));
}

/** 데이터가 빠진 음원 중 해시가 같은 것들(같은 파일을 두 번 올렸다면 둘 이상일 수 있다). 해시를 모르면 비어 있다. */
export function findMissingByHash(missing: ReadonlyArray<MissingAsset>, hash: string | undefined): MissingAsset[] {
  if (!hash) return [];
  return missing.filter((item) => item.asset.hash === hash);
}
