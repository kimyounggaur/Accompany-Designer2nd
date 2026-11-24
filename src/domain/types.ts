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
  | "bar"
  | "beat"
  | "halfBeat"
  | "quarterBeat"
  | "none";
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

/** 음원 id. 문서 안의 클립이 `audioBufferId`로 이 값을 가리킨다. */
export type AssetId = string;

/**
 * 문서에 남는 음원 정보(문서 형식 v2). 파형·재생 주소 같은 "다시 만들 수 있는 값"은 문서에 없다.
 *  - 파형: 음원을 풀 때마다 만든다(지금은 services/peaksCache의 메모리 보관, 4단계 P4-3에서 저장소 캐시로).
 *  - 원본 데이터: services/persistence/audioBlobs가 id로 기억하고, 자동 저장·프로젝트 파일이 해시로 담는다.
 */
export interface AssetMeta {
  id: AssetId;
  fileName: string;
  duration: number;
  sampleRate: number;
  channels: number;
  source: "upload" | "recording";
  /** SHA-256(소문자 16진수 64자). 같은 파일 판별·재연결에 쓴다(P4-2). */
  hash?: string;
  mimeType?: string;
  byteSize?: number;
  detectedBpm?: number;
  recordedAt?: string;
}

/** 마스터 설정. 지금은 볼륨(−60 ~ +6 dB)뿐이다. */
export interface MasterSettings {
  volumeDb: number;
}

/** 박자표(C13). 눈금자의 마디 번호·마디 스냅·메트로놈 강박이 이 값을 따른다(P5-5). 템포는 박자표와 상관없이 4분음표 기준이다. */
export interface TimeSignature {
  beats: number;
  unit: 4 | 8;
}

export interface TimeMarker {
  id: string;
  time: number;
  name: string;
}

/**
 * 프로젝트 문서(형식 v2). 실행 취소·자동 저장·엔진 동기화·프로젝트 파일의 대상이다.
 * 문서는 바꾸지 않고 새로 만든다(immer). 그래서 "무엇이 바뀌었나"를 === 로 알 수 있다.
 * 옛 이름(`DawProject`, `audioAssets`, `timeMarkers`)은 domain/project/migrations가 읽을 때만 쓴다.
 */
export interface ProjectDoc {
  schemaVersion: 2;
  id: string;
  name: string;
  bpm: number;
  timeSignature: TimeSignature;
  sampleRate: number;
  master: MasterSettings;
  tracks: Track[];
  assets: Record<AssetId, AssetMeta>;
  markers: TimeMarker[];
}

/** 이펙트 랙 프리셋(저장소·파일로 주고받는 모양). `domain/project/parsePreset`이 읽는다. */
export interface EffectRackPreset {
  name: string;
  /** 만든 시각(ISO 8601 문자열) */
  createdAt: string;
  effectChain: EffectSlot[];
  eq: EqSettings;
  compressor: CompressorSettings;
  delay: DelaySettings;
  reverb: ReverbSettings;
}
