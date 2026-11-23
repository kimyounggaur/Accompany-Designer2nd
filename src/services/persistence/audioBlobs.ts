/**
 * 실행 중에 기억해 두는 원본 음원 데이터(음원 id → Blob).
 * 자동 저장·프로젝트 파일·"녹음 WAV 저장"이 여기서 꺼내 쓴다. 문서에는 음원의 정보(AssetMeta)만 있고 데이터는 없다.
 * (예전에는 storage/projectStorage.ts 안에 있었다.)
 */
import { sha256Hex } from "./assetHash";

const audioBlobs = new Map<string, Blob>();

export function rememberAudio(id: string, blob: Blob): void {
  audioBlobs.set(id, blob);
  // 자동 저장이 해시를 기다리지 않도록 미리 계산해 둔다(탭을 닫는 순간의 저장이 빨라진다). 실패해도 저장 때 다시 시도한다.
  sha256Hex(blob).catch(() => undefined);
}

export function hasRememberedAudio(id: string): boolean {
  return audioBlobs.has(id);
}

export function recallAudio(id: string): Blob | undefined {
  return audioBlobs.get(id);
}

/** 기억하던 음원을 모두 잊는다 */
export function forgetAllAudio(): void {
  audioBlobs.clear();
}
