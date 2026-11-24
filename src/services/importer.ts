/**
 * 음원 파일 가져오기(설계서 §P4-2): 파일 하나를 소리·해시로 읽고, 빠진 음원에 이어 주는 일.
 * 소리를 푸는 일은 소리 엔진이 하므로(services는 audio를 모른다) 부르는 쪽(app)이 `decode`를 넘겨 준다 — 자동 저장이 `recallAudio`를 받는 것과 같다.
 * 문서를 고치는 일(음원·클립 추가, 음원 정보 갱신)은 여기서 하지 않는다. 돌려준 값을 보고 app이 한다.
 *
 * 4단계 P4-5에서 이 파일에 "어느 트랙에 놓을지"(placement)가 더해진다.
 */
import type { AssetMeta } from "../domain/types";
import { hashOrUndefined } from "./persistence/assetHash";
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

/** 소리를 풀고 해시를 계산한다. 풀 수 없는 파일이면 던진다. */
export async function readAudioFile(file: File, decode: (file: File) => Promise<DecodedUpload>): Promise<ReadAudio> {
  const [decoded, hash] = await Promise.all([decode(file), hashOrUndefined(file)]);
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
