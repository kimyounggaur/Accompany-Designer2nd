/**
 * 값의 범위와 개수 상한. 설계서의 범위표는 "지금 코드의 값을 그대로 옮긴 것"이고,
 * 표에 없는 값(클립 게인·원본 BPM·시간·샘플레이트 등)은 화면 입력 범위나 사용상 충분한 상한을 썼다.
 */
export type Range = readonly [min: number, max: number];

// ── 프로젝트 ──
export const BPM_RANGE: Range = [20, 300];
export const BPM_DEFAULT = 120;
export const SAMPLE_RATE_RANGE: Range = [8000, 192000];
export const SAMPLE_RATE_DEFAULT = 44100;
export const TIME_SIGNATURE_BEATS_RANGE: Range = [1, 32];
/** 시간(초)의 상한: 하루. 이보다 큰 값(1e308 등)은 이 값으로 고친다. */
export const MAX_TIME_SECONDS = 86_400;
export const TIME_RANGE: Range = [0, MAX_TIME_SECONDS];

// ── 트랙 ──
export const TRACK_VOLUME_RANGE: Range = [0, 2];
export const TRACK_PAN_RANGE: Range = [-1, 1];

// ── 이펙트 ──
export const EQ_GAIN_RANGE: Range = [-12, 12];
export const COMPRESSOR_THRESHOLD_RANGE: Range = [-100, 0];
export const COMPRESSOR_RATIO_RANGE: Range = [1, 20];
export const COMPRESSOR_TIME_RANGE: Range = [0, 1];
export const DELAY_TIME_RANGE: Range = [1, 2000];
export const DELAY_FEEDBACK_RANGE: Range = [0, 0.95];
export const DELAY_HIGH_CUT_RANGE: Range = [1000, 20000];
export const UNIT_RANGE: Range = [0, 1];
export const REVERB_PRE_DELAY_RANGE: Range = [0, 250];
export const REVERB_DECAY_RANGE: Range = [0.2, 12];
export const REVERB_HIGH_PASS_RANGE: Range = [20, 2000];
export const REVERB_LOW_PASS_RANGE: Range = [1000, 20000];

// ── 클립 ──
export const CLIP_GAIN_RANGE: Range = [0, 2];
export const CLIP_SOURCE_BPM_RANGE: Range = [20, 300];

// ── 음원 ──
export const ASSET_SAMPLE_RATE_RANGE: Range = [3000, 768000];
export const ASSET_CHANNELS_RANGE: Range = [1, 32];
export const ASSET_BYTE_SIZE_RANGE: Range = [0, Number.MAX_SAFE_INTEGER];

// ── 개수·길이 상한 ──
export const MAX_TRACKS = 128;
export const MAX_CLIPS = 10_000;
export const MAX_MARKERS = 1_000;
export const MAX_NAME_LENGTH = 200;
/** 프리셋 목록(저장소)에 남기는 개수 */
export const MAX_PRESETS = 24;
/** id의 길이 상한(미만) */
export const MAX_ID_LENGTH = 500;
/** 지금 규칙 그대로: 객체 키로 쓰면 위험한 이름 */
export const FORBIDDEN_IDS: ReadonlyArray<string> = ["__proto__", "prototype", "constructor"];
