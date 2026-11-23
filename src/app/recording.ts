/**
 * 녹음 흐름의 연결부(P3-5). 예전에는 App.tsx 안에 흩어져 있던 녹음·카운트인·메트로놈 약 280줄이 이리로 모였다.
 *
 * 녹음의 규칙과 순서는 `audio/recording/RecordingController`가 맡고, 이 파일은 그 컨트롤러를 소리 엔진·마이크 녹음기에 이어 준다.
 * 스토어·문서·안내 쪽 연결은 `recordingHost.ts`에 있다. 화면 부품은 이 파일의 함수만 부른다.
 */
import { audioEngine } from "../audio/currentEngine";
import { createTickTimer } from "../audio/engine/tickTimer";
import { createClickPlayer } from "../audio/Metronome";
import { MicRecorder } from "../audio/recording/Recorder";
import { RecordingController, type RecordingEngine } from "../audio/recording/RecordingController";
import { setPeaks } from "../services/peaksCache";
import { hashOrUndefined } from "../services/persistence/assetHash";
import { getProjectSnapshot } from "./projectSnapshot";
import { recordingHost } from "./recordingHost";

const engine: RecordingEngine = {
  ensureContext: () => audioEngine.ensureContext(),
  play: (from, options) => audioEngine.play(getProjectSnapshot(), from, options),
  stop: () => audioEngine.stop(),
  isPlaying: () => audioEngine.isPlaying(),
  getCurrentPlayhead: () => audioEngine.getCurrentPlayhead(),
  positionAt: (contextTime) => audioEngine.positionAt(contextTime),
  getOutputLatency: () => audioEngine.getOutputLatency(),
  getBaseLatency: () => audioEngine.getBaseLatency(),
  getMonitorInput: () => audioEngine.getMonitorInput(),
  decode: async (blob, fileName, assetId) => {
    const decoded = await audioEngine.decodeBlob(blob, fileName, assetId, "recording");
    setPeaks(decoded.asset.id, decoded.peaks); // 문서에는 파형이 없다. 화면은 파형 보관소에서 읽는다.
    const hash = await hashOrUndefined(blob); // 같은 파일 판별·다시 연결에 쓴다(P4-2)
    return hash ? { ...decoded.asset, hash } : decoded.asset;
  },
};

let controller: RecordingController | undefined;

function recordingController(): RecordingController {
  controller ??= new RecordingController({
    engine,
    host: recordingHost,
    createRecorder: () => new MicRecorder(),
    createTimer: createTickTimer,
    createClickPlayer: (context) => createClickPlayer(context, () => audioEngine.getMonitorInput()),
  });
  return controller;
}

/** 녹음 버튼: 쉬는 중이면 녹음을 시작하고, 진행 중이면 멈춘다(준비·카운트인 중에는 취소). */
export function toggleRecording(): Promise<void> {
  return recordingController().toggle();
}

/** 녹음을 멈추고 저장한다(준비·카운트인 중이면 취소). */
export function stopRecording(): Promise<void> {
  return recordingController().stop();
}

/** 하던 녹음을 저장하지 않고 버린다(프로젝트를 열기 전, 화면을 닫을 때). */
export function cancelRecording(): void {
  controller?.cancel({ silent: true });
}

export function disposeRecording(): void {
  controller?.dispose();
  controller = undefined;
}
