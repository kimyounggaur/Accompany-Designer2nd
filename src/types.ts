export type StretchMode = "none" | "resample";

export interface EqSettings {
  lowGain: number;
  midGain: number;
  highGain: number;
}

export interface CompressorSettings {
  enabled: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
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
}

export interface DawProject {
  id: string;
  name: string;
  bpm: number;
  sampleRate: number;
  tracks: Track[];
  audioAssets: Record<string, AudioAsset>;
}
