import { create } from "zustand";
import { LATENCY_OFFSET_DEFAULT_MS, clampLatencyOffsetMs } from "../domain/recording/latency";
import { clamp } from "../utils/audioMath";
import { fail, ok, type CommandResult } from "./commandResult";

/**
 * 녹음 저장소(P3-5): 녹음 단계, 대상 트랙, 경과 시간, 녹음 중 임시 파형, 녹음 설정.
 *
 * 프로젝트 문서가 아니다. 녹음 중 파형은 여기에만 쌓이고(초당 20회 이하), 문서(`projectStore`)는 녹음이 끝나는 순간
 * 음원·클립을 한 번에 받는다. 그래서 녹음 중에는 문서가 바뀌지 않고, 자동 저장도 돌지 않는다.
 *
 *   idle → preparing → counting-in → recording → stopping → idle
 */
export type RecordingStatus = "idle" | "preparing" | "counting-in" | "recording" | "stopping";

/** 녹음 설정: 사용자가 고르는 값. 녹음이 끝나도 남는다. */
export interface RecordingSettings {
  /** 녹음 대기 트랙. 없으면 비어 있는 첫 트랙, 그것도 없으면 새 트랙에 녹음한다. */
  armedTrackId?: string;
  inputDeviceId?: string;
  monitoringEnabled: boolean;
  metronomeEnabled: boolean;
  /** 카운트인 박 수(0~8) */
  countInBeats: number;
  /** 지연 보정(ms, −200~+200). 양수면 녹음 클립이 앞으로 당겨진다. */
  latencyOffsetMs: number;
}

/** 지금 진행 중인 녹음의 값: 녹음이 끝나면 처음으로 돌아간다. */
export interface RecordingProgress {
  status: RecordingStatus;
  /** 녹음하고 있는 트랙 */
  trackId?: string;
  /** 녹음이 놓일 곡 위치(초) */
  startedAtProjectTime: number;
  /** 녹음한 길이(초) */
  elapsed: number;
  /** 카운트인이 끝날 때까지 남은 박 수 */
  countInRemaining: number;
  /** 녹음 중에 그리는 임시 파형(0~1) */
  waveformPeaks: number[];
}

export const COUNT_IN_BEATS_MAX = 8;

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  armedTrackId: undefined,
  inputDeviceId: undefined,
  monitoringEnabled: false,
  metronomeEnabled: false,
  countInBeats: 0,
  latencyOffsetMs: LATENCY_OFFSET_DEFAULT_MS,
};

export const IDLE_PROGRESS: RecordingProgress = {
  status: "idle",
  trackId: undefined,
  startedAtProjectTime: 0,
  elapsed: 0,
  countInRemaining: 0,
  waveformPeaks: [],
};

export interface RecordingStoreState extends RecordingSettings, RecordingProgress {
  /** 진행 값을 일부만 바꾼다(컨트롤러가 부른다). */
  setProgress: (patch: Partial<RecordingProgress>) => void;
  /** 진행 값을 처음(idle)으로 되돌린다. 설정은 그대로 둔다. */
  resetProgress: () => void;
  toggleArm: (trackId: string) => CommandResult<"recording", { armed: boolean }>;
  /** 지운 트랙이 녹음 대기 중이었으면 푼다. */
  disarmTrack: (trackId: string) => void;
  /** 문서를 통째로 바꿨을 때(불러오기·새 프로젝트): 트랙이 달라졌으니 녹음 대기만 푼다. 장치·보정 같은 설정은 이 브라우저의 것이라 남긴다. */
  resetForNewProject: () => void;
  setInputDevice: (inputDeviceId?: string) => void;
  setMonitoring: (monitoringEnabled: boolean) => void;
  setMetronome: (metronomeEnabled: boolean) => void;
  setCountIn: (countInBeats: number) => void;
  setLatencyOffsetMs: (latencyOffsetMs: number) => void;
}

export const useRecordingStore = create<RecordingStoreState>((set, get) => ({
  ...DEFAULT_RECORDING_SETTINGS,
  ...IDLE_PROGRESS,
  setProgress: (patch) => set(patch),
  resetProgress: () => set({ ...IDLE_PROGRESS, waveformPeaks: [] }),
  toggleArm: (trackId) => {
    if (get().status !== "idle") return fail("recording");
    const armedTrackId = get().armedTrackId === trackId ? undefined : trackId;
    set({ armedTrackId });
    return ok({ armed: Boolean(armedTrackId) });
  },
  disarmTrack: (trackId) => {
    if (get().armedTrackId === trackId) set({ armedTrackId: undefined });
  },
  resetForNewProject: () => set({ armedTrackId: undefined, ...IDLE_PROGRESS, waveformPeaks: [] }),
  setInputDevice: (inputDeviceId) => set({ inputDeviceId }),
  setMonitoring: (monitoringEnabled) => set({ monitoringEnabled }),
  setMetronome: (metronomeEnabled) => set({ metronomeEnabled }),
  setCountIn: (countInBeats) => set({ countInBeats: clamp(Math.round(countInBeats) || 0, 0, COUNT_IN_BEATS_MAX) }),
  setLatencyOffsetMs: (latencyOffsetMs) => set({ latencyOffsetMs: clampLatencyOffsetMs(latencyOffsetMs) }),
}));

/** 녹음 흐름이 진행 중인가(준비·카운트인·녹음·저장 중). 이 동안에는 트랙 삭제·되돌리기·위치 이동을 막는다. */
export function isRecordingBusy(status: RecordingStatus = useRecordingStore.getState().status): boolean {
  return status !== "idle";
}

/** 소리가 들어오는 중인가: 미터·스펙트럼이 움직여야 하는 때 */
export function isCapturing(status: RecordingStatus): boolean {
  return status === "recording";
}
