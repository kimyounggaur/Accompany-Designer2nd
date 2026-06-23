export type StretchMode = "none" | "resample";
export type FadeCurve = "linear" | "equalPower";
export type PlaylistTool =
  | "move"
  | "draw"
  | "paint"
  | "delete"
  | "mute"
  | "slip"
  | "slice"
  | "select"
  | "zoom"
  | "play-selected";
export type PlaylistSnap =
  | "main"
  | "line"
  | "beat"
  | "halfBeat"
  | "quarterBeat"
  | "none";
export type RecordingStatus =
  | "idle"
  | "armed"
  | "counting-in"
  | "recording"
  | "stopping";
export type DelaySyncDivision =
  | "1/1"
  | "1/2"
  | "1/4"
  | "1/8"
  | "1/16"
  | "1/8d"
  | "1/8t";
export type ReverbMode = "plate" | "room" | "hall";
export type EffectSlotType = "eq" | "comp" | "delay" | "reverb";

export interface EffectSlot {
  id: string;
  type: EffectSlotType;
  enabled: boolean;
}

export interface EqSettings {
  enabled: boolean;
  bassGain: number;
  middleLowGain: number;
  middleHighGain: number;
  highGain: number;
  presenceGain: number;
}

export interface CompressorSettings {
  enabled: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
}

export interface DelaySettings {
  enabled: boolean;
  delayTimeMs: number;
  feedback: number;
  dry: number;
  wet: number;
  highCutHz: number;
  syncEnabled: boolean;
  syncDivision: DelaySyncDivision;
  pingPong: boolean;
}

export interface ReverbSettings {
  enabled: boolean;
  mode: ReverbMode;
  preDelayMs: number;
  decay: number;
  drive: number;
  dry: number;
  wet: number;
  width: number;
  highPassHz: number;
  lowPassHz: number;
  modEnabled: boolean;
  modAmount: number;
  postEqLowGain: number;
  postEqMidGain: number;
  postEqHighGain: number;
}

export interface Clip {
  id: string;
  audioBufferId: string;
  name: string;
  trackId: string;
  startTime: number;
  offset: number;
  duration: number;
  sourceBpm: number;
  stretchMode: StretchMode;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  fadeCurve?: FadeCurve;
  muted?: boolean;
  groupId?: string;
  isRecording?: boolean;
}

export interface Track {
  id: string;
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  eq: EqSettings;
  compressor: CompressorSettings;
  delay: DelaySettings;
  reverb: ReverbSettings;
  effectChain: EffectSlot[];
  clips: Clip[];
}

export interface AudioAsset {
  id: string;
  fileName: string;
  duration: number;
  sampleRate: number;
  channels: number;
  waveformPeaks: number[];
  detectedBpm?: number;
  sourceType?: "upload" | "recording";
  blobUrl?: string;
  mimeType?: string;
  byteSize?: number;
  recordedAt?: string;
}

export interface RecordingState {
  status: RecordingStatus;
  armedTrackId?: string;
  trackId?: string;
  clipId?: string;
  startedAtProjectTime: number;
  elapsed: number;
  inputDeviceId?: string;
  monitoringEnabled: boolean;
  metronomeEnabled: boolean;
  countInBeats: number;
  countInRemaining: number;
  waveformPeaks: number[];
}

export interface DawProject {
  id: string;
  name: string;
  bpm: number;
  sampleRate: number;
  tracks: Track[];
  audioAssets: Record<string, AudioAsset>;
  timeMarkers: TimeMarker[];
}

export interface TimeMarker {
  id: string;
  time: number;
  name: string;
}
