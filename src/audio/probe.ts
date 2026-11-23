/** 마스터 출력 뒤에서 잰 값(0.1초마다 갱신). `?probe=1`일 때만 `window.__probe`에 들어온다. */
export interface ProbeReport {
  jumps: number;
  gaps: number;
  peak: number;
  longestGapMs: number;
}

declare global {
  interface Window {
    __probe?: ProbeReport;
    /** 측정값을 0으로 되돌린다(재생을 시작하기 직전에 부른다). */
    __probeReset?: () => void;
  }
}

export function isProbeEnabled(search: string = typeof location === "undefined" ? "" : location.search): boolean {
  return new URLSearchParams(search).get("probe") === "1";
}

/**
 * `tap`(마스터 출력)의 소리를 프로브에 나눠 보낸다. 스피커로 가는 길은 그대로 두고, 프로브는 소리 없는 가지에만 둔다.
 * 출력이 이어지지 않은 노드는 처리하지 않는 브라우저가 있어서, 이득 0짜리 GainNode를 거쳐 destination에 잇는다.
 */
export async function attachProbe(context: AudioContext, tap: AudioNode): Promise<void> {
  // 정적으로 가져오면 Node 단위 시험에서 이 파일을 읽을 수 없으므로, 켜졌을 때만 불러온다.
  const { default: probeModuleUrl } = await import("./worklets/probe.worklet.ts?worker&url");
  await context.audioWorklet.addModule(probeModuleUrl);
  const node = new AudioWorkletNode(context, "probe", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  node.port.onmessage = (event: MessageEvent<ProbeReport>) => {
    window.__probe = event.data;
  };
  window.__probeReset = () => node.port.postMessage("reset");
  const silent = context.createGain();
  silent.gain.value = 0;
  tap.connect(node);
  node.connect(silent);
  silent.connect(context.destination);
}
