/**
 * 믹스 내보내기용 WAV 인코더(P3-6). 화면 스레드에서 수백만 샘플을 정수로 바꾸고 이어 붙이지 않도록 Worker에서 한다.
 * 메시지 `{ id, channels, sampleRate, bitDepth }`를 받으면 채널 데이터(소유권을 받은 것)로 WAV를 만들어
 * `{ id, buffer }`로 돌려준다(역시 소유권 이전). 실패하면 `{ id, error }`.
 */
import { encodePcmWav } from "../../utils/wavEncoder";

interface EncodeRequest {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
  bitDepth: 16 | 24;
}

// 이 파일은 Worker 안에서 돌아가는데 lib.dom에는 Worker 전역이 없어서, 쓰는 부분만 좁혀 선언한다.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EncodeRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { id, channels, sampleRate, bitDepth } = event.data;
  try {
    const buffer = encodePcmWav(channels, sampleRate, bitDepth);
    scope.postMessage({ id, buffer }, [buffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
