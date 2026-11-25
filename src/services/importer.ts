/**
 * 음원 파일 가져오기(설계서 §P4-2): 파일 하나를 소리·해시로 읽고, 빠진 음원에 이어 주는 일.
 * 소리를 푸는 일은 소리 엔진이 하므로(services는 audio를 모른다) 부르는 쪽(app)이 `decode`를 넘겨 준다 — 자동 저장이 `recallAudio`를 받는 것과 같다.
 * 문서를 고치는 일(음원·클립 추가, 음원 정보 갱신, 트랙 만들기)은 여기서 하지 않는다. 돌려준 값을 보고 app이 한다.
 * 어느 트랙에 놓을지(`planUpload`)는 순수한 규칙(`domain/timeline/placement`)에 맡긴다(P4-5).
 */
import { chooseTrack, type PlacementChoice } from "../domain/timeline/placement";
import type { AssetMeta, Clip, ProjectDoc } from "../domain/types";
import { getClipTimelineDuration } from "../utils/audioMath";
import { hashOrUndefined } from "./persistence/assetHash";
import type { UploadGuard } from "./memoryGuard";
import { rememberAudio } from "./persistence/audioBlobs";

/** 소리 엔진이 파일 하나를 푼 결과 */
export interface DecodedUpload {
  asset: AssetMeta;
  /** 같은 소리를 다른 음원 id로도 소리 엔진에 올린다(빠진 음원에 이을 때) */
  registerAs: (assetId: string) => void;
  /** 이 파일을 쓰지 않기로 했을 때, 풀면서 임시로 올려 둔 소리를 내린다 */
  release: () => void;
}

/** 파일 하나를 읽은 결과. `asset`에는 해시가 들어 있다(계산하지 못한 환경은 제외). */
export interface ReadAudio extends DecodedUpload {
  hash?: string;
}

/**
 * 소리를 풀고 해시를 계산한다. 풀 수 없는 파일이면 던진다.
 * `guard`가 있으면(P6-4) 파일을 읽기 전에 큰 파일을 묻거나 막고, 푼 뒤에 풀린 크기로 다시 따진다. 올리지 않기로 하면
 * `UploadSkipped`를 던지고(풀어 둔 소리는 내려놓는다), 풀기 전에 막힌 파일은 해시도 읽지 않는다(큰 파일을 통째로 읽는 일을 피한다).
 */
export async function readAudioFile(file: File, decode: (file: File) => Promise<DecodedUpload>, guard?: UploadGuard): Promise<ReadAudio> {
  const before = await guard?.beforeDecode(file);
  const hashing = hashOrUndefined(file); // 풀기와 함께 시작한다(실패하지 않는 약속)
  const decoded = await decode(file);
  if (guard && before) {
    try {
      await guard.afterDecode(file, decoded.asset, before);
    } catch (error) {
      decoded.release();
      throw error;
    }
  }
  const hash = await hashing;
  return { ...decoded, hash, asset: hash ? { ...decoded.asset, hash } : decoded.asset };
}

/**
 * 읽은 파일의 소리를 빠진 음원(`missing`)에 잇는다: 소리 엔진·원본 데이터를 그 음원 id로 채운다.
 * 문서의 음원 정보에 덮어쓸 값(파일에 따라 달라지는 것들)을 돌려준다. 이름·종류·녹음 시각 같은 프로젝트 쪽 정보는 그대로 둔다.
 * 파형은 여기서 만들지 않는다(services는 소리 엔진을 모른다): 부르는 쪽(app)이 `ensurePeaks`로 갖춘다.
 */
export function attachAudio(missing: AssetMeta, file: Blob, read: ReadAudio): Partial<AssetMeta> {
  read.registerAs(missing.id);
  read.release();
  rememberAudio(missing.id, file);
  const { duration, sampleRate, channels, mimeType, byteSize, hash } = read.asset;
  return { duration, sampleRate, channels, mimeType, byteSize, hash };
}

/** 올린 음원 하나를 문서에 놓는 계획 */
export interface UploadPlan {
  /** 놓을 클립. `trackId`는 놓을 트랙이 정해진 뒤(새 트랙이면 만든 뒤) 부르는 쪽이 채운다. */
  clip: Omit<Clip, "trackId">;
  /** 놓을 트랙: 있는 트랙의 id, 또는 새 트랙 */
  target: PlacementChoice;
}

export interface UploadContext {
  /** 새 클립의 id */
  clipId: string;
  /** 클립이 시작할 곡 위치(초): 지금 재생 위치(편집 커서) */
  startTime: number;
  /** 지금 선택한 트랙 */
  selectedTrackId?: string;
}

/**
 * 올린 음원의 새 클립을 만들고 놓을 트랙을 정한다(P4-5, 보고서 B8). 문서는 고치지 않는다.
 * 새 클립은 원본 속도(템포 맞춤 꺼짐)이고 원본 BPM은 프로젝트 템포로 둔다(결정 3).
 * 파일이 여럿이면 한 파일을 놓아 문서를 갱신한 뒤 다음 파일로 이 함수를 다시 부른다(앞 파일이 놓인 자리를 보고 판단하려고).
 */
export function planUpload(doc: Pick<ProjectDoc, "bpm" | "tracks">, asset: AssetMeta, context: UploadContext): UploadPlan {
  const clip: Omit<Clip, "trackId"> = {
    id: context.clipId,
    audioBufferId: asset.id,
    name: asset.fileName,
    startTime: context.startTime,
    offset: 0,
    duration: asset.duration,
    sourceBpm: doc.bpm,
    stretchMode: "none",
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: "equalPower",
    muted: false,
  };
  const length = getClipTimelineDuration(doc.bpm, { ...clip, trackId: "" });
  const target = chooseTrack(doc, { purpose: "upload", selectedTrackId: context.selectedTrackId, start: context.startTime, length });
  return { clip, target };
}
