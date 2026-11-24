import { analyzeBpm, BpmCancelledError } from "../audio/bpmAnalyzer";
import { audioEngine } from "../audio/currentEngine";
import { BPM_RANGE } from "../domain/project/ranges";
import { ko } from "../i18n/ko";
import { notify } from "../services/notify";
import { useBpmStore } from "../state/bpmStore";
import { useDawStore } from "../store/useDawStore";
import { findClip } from "../utils/audioMath";

/**
 * 클립의 BPM 감지(설계서 §P4-4, 보고서 B5). 계산은 Worker가 하고(audio/bpmAnalyzer), 진행 상태는 `state/bpmStore`에 둔다.
 * 감지한 값은 음원의 `detectedBpm`에 기록하고(이력에 넣지 않음), 클립 원본 BPM이나 프로젝트 템포에 적용하는 것은 사용자가 고른다.
 */

/** 시험에서 바꿔 끼우는 의존물 */
export interface BpmDetectionDeps {
  getBuffer: (assetId: string) => Parameters<typeof analyzeBpm>[0] | undefined;
  analyze: typeof analyzeBpm;
}

const defaultDeps: BpmDetectionDeps = {
  getBuffer: (assetId) => audioEngine.getBuffer(assetId),
  analyze: analyzeBpm,
};

/** 지금 돌고 있는 감지를 그만두는 신호. 없으면 돌고 있는 것이 없다. */
let running: AbortController | undefined;

function writeDetectedBpm(assetId: string, bpm: number) {
  const state = useDawStore.getState();
  if (state.assets[assetId]) state.updateAudioAsset(assetId, { detectedBpm: bpm }, { history: false });
}

/** 클립의 음원에서 박자를 감지한다. 이미 돌고 있는 감지가 있으면 그것을 그만두고 새로 시작한다. */
export async function startBpmDetection(clipId: string, deps: BpmDetectionDeps = defaultDeps): Promise<void> {
  const store = useBpmStore.getState();
  running?.abort();
  running = undefined;

  const clip = findClip(useDawStore.getState().tracks, clipId)?.clip;
  if (!clip) return;
  const assetId = clip.audioBufferId;
  const buffer = deps.getBuffer(assetId);
  if (!buffer) {
    store.set({ status: "failed", clipId, message: ko.clip.bpm.noBuffer });
    return;
  }

  const mine = new AbortController();
  running = mine;
  store.set({ status: "running", clipId, progress: 0 });
  try {
    const detected = await deps.analyze(buffer, {
      signal: mine.signal,
      onProgress: (progress) => {
        if (running === mine) useBpmStore.getState().set({ status: "running", clipId, progress });
      },
    });
    if (running !== mine) return;
    running = undefined;
    // 분석하는 사이 클립이 지워졌거나 다른 음원으로 바뀌었으면(프로젝트를 새로 열었을 때 등) 결과를 버린다.
    if (findClip(useDawStore.getState().tracks, clipId)?.clip.audioBufferId !== assetId) {
      useBpmStore.getState().reset();
      return;
    }
    if (detected === undefined) {
      useBpmStore.getState().set({ status: "failed", clipId, message: ko.clip.bpm.unstable });
      return;
    }
    writeDetectedBpm(assetId, detected);
    useBpmStore.getState().set({ status: "done", clipId, detected, value: detected });
  } catch (error) {
    if (running !== mine) return;
    running = undefined;
    useBpmStore
      .getState()
      .set(error instanceof BpmCancelledError ? { status: "cancelled", clipId } : { status: "failed", clipId, message: ko.clip.bpm.failed });
  }
}

/** 돌고 있는 감지를 그만둔다. 돌고 있는 것이 없으면 아무것도 하지 않는다. */
export function cancelBpmDetection(): void {
  const current = useBpmStore.getState().detection;
  if (!running || current.status !== "running") return;
  running.abort();
  running = undefined;
  useBpmStore.getState().set({ status: "cancelled", clipId: current.clipId });
}

/** 제안 값을 절반·두 배로 고칠 수 있는지(결과가 BPM 범위 안인지) */
export function canScaleBpmSuggestion(value: number, factor: 0.5 | 2): boolean {
  const next = scaled(value, factor);
  return next >= BPM_RANGE[0] && next <= BPM_RANGE[1];
}

function scaled(value: number, factor: 0.5 | 2): number {
  return Math.round(value * factor * 10) / 10;
}

/** 곡에 따라 절반이나 두 배로 감지되는 것을 바로잡는 빠른 고침(×½, ×2). 범위를 벗어나면 아무것도 하지 않는다. */
export function scaleBpmSuggestion(factor: 0.5 | 2): void {
  const current = useBpmStore.getState().detection;
  if (current.status !== "done" || !canScaleBpmSuggestion(current.value, factor)) return;
  const value = scaled(current.value, factor);
  const clip = findClip(useDawStore.getState().tracks, current.clipId)?.clip;
  if (clip) writeDetectedBpm(clip.audioBufferId, value);
  useBpmStore.getState().set({ ...current, value });
}

/** 화면에 보이는 제안 값을 클립의 원본 BPM으로 적용한다. 그 사이 클립이 지워졌으면 아무것도 하지 않는다. */
export function applyBpmToClip(): void {
  const current = useBpmStore.getState().detection;
  if (current.status !== "done") return;
  const state = useDawStore.getState();
  if (!findClip(state.tracks, current.clipId)) return;
  state.updateClip(current.clipId, { sourceBpm: current.value });
  notify("info", ko.clip.bpm.appliedToClip(current.value));
}

/** 화면에 보이는 제안 값을 프로젝트 템포로 적용한다. */
export function applyBpmToProject(): void {
  const current = useBpmStore.getState().detection;
  if (current.status !== "done") return;
  useDawStore.getState().setBpm(current.value);
  notify("info", ko.clip.bpm.appliedToProject(current.value));
}

/** 감지 표시를 없앤다(프로젝트를 새로 열었을 때 등) */
export function resetBpmDetection(): void {
  running?.abort();
  running = undefined;
  useBpmStore.getState().reset();
}
