import type { Clip, DawProject, Track } from "../../types";
import { MAX_EXPORT_SECONDS, type ExportOptions } from "../../domain/export/exportOptions";
import { getClipTimelineDuration } from "../../utils/audioMath";
import { wavByteLength } from "../../utils/wavEncoder";
import { projectTailSeconds } from "../effects/tail";

/**
 * 믹스 내보내기 계획(P3-6). 소리 노드를 만들지 않고 "무엇을, 얼마나 길게 렌더할지"만 계산하는 순수 함수들이다.
 * 화면은 이 계산으로 대화상자의 길이·크기 안내와 "내보낼 수 없음" 판단을 하고, 렌더러는 같은 계산으로 길이를 정한다.
 */

/** 진행률을 알리려고 렌더를 멈추는 간격(초) */
export const PROGRESS_INTERVAL_SECONDS = 2;
/** Web Audio가 한 번에 처리하는 프레임 수. 멈춤 시각(suspend)은 이 단위로 올림된다. */
export const RENDER_QUANTUM = 128;
/** 내보내는 채널 수(스테레오) */
export const EXPORT_CHANNELS = 2;

/** 믹스에 들어가는 클립: 꺼져 있지 않고 녹음 중이 아닌 것(재생 예약기와 같은 조건) */
export interface MixClip {
  track: Track;
  clip: Clip;
}

export function mixClips(project: Pick<DawProject, "tracks">): MixClip[] {
  return project.tracks.flatMap((track) =>
    track.clips.filter((clip) => !clip.muted && !clip.isRecording).map((clip) => ({ track, clip })),
  );
}

export interface MixPlan {
  options: ExportOptions;
  /** 소리가 나는 클립 수 */
  clipCount: number;
  /** 마지막 클립이 끝나는 곳(초) */
  endSeconds: number;
  /** 이펙트 꼬리(초, 최대 30) */
  tailSeconds: number;
  /** 파일에 들어갈 프레임 수 = ⌈(마지막 클립 끝 + 꼬리) × 샘플레이트⌉ */
  frames: number;
  /** frames ÷ 샘플레이트(초) */
  durationSeconds: number;
  /** 예상 파일 크기(바이트, 머리말 포함) */
  bytes: number;
}

export type MixPlanResult =
  | { ok: true; plan: MixPlan }
  /** 소리가 나는 클립이 하나도 없다 */
  | { ok: false; reason: "no-clips" }
  /** 음원을 찾을 수 없는 클립이 있다. `missing`은 찾을 수 없는 음원의 수 */
  | { ok: false; reason: "missing-audio"; missing: number }
  /** 길이가 한도(1시간)를 넘는다 */
  | { ok: false; reason: "too-long"; durationSeconds: number };

/**
 * 내보낼 수 있는지 살피고, 가능하면 길이와 크기를 계산한다.
 * @param hasAudio 음원 id → 소리 엔진이 그 음원의 버퍼를 가지고 있는가
 */
export function planMixRender(
  project: Pick<DawProject, "bpm" | "tracks">,
  hasAudio: (assetId: string) => boolean,
  options: ExportOptions,
): MixPlanResult {
  const clips = mixClips(project);
  if (!clips.length) return { ok: false, reason: "no-clips" };
  const missing = new Set(clips.map(({ clip }) => clip.audioBufferId).filter((assetId) => !hasAudio(assetId)));
  if (missing.size) return { ok: false, reason: "missing-audio", missing: missing.size };
  const endSeconds = clips.reduce((end, { clip }) => Math.max(end, clip.startTime + getClipTimelineDuration(project.bpm, clip)), 0);
  const tailSeconds = projectTailSeconds(project);
  const duration = endSeconds + tailSeconds;
  if (duration > MAX_EXPORT_SECONDS) return { ok: false, reason: "too-long", durationSeconds: duration };
  const frames = Math.max(1, Math.ceil(duration * options.sampleRate));
  return {
    ok: true,
    plan: {
      options,
      clipCount: clips.length,
      endSeconds,
      tailSeconds,
      frames,
      durationSeconds: frames / options.sampleRate,
      bytes: wavByteLength(frames, options.bitDepth, EXPORT_CHANNELS),
    },
  };
}

/**
 * 진행률을 알릴 멈춤 시각(초) 목록: `intervalSeconds`마다, 렌더 퀀텀(128프레임)에 맞춰서.
 * 맨 끝(마지막 퀀텀)에 닿는 시각은 뺀다 — 길이 이상으로 멈추려 하면 브라우저가 거절한다.
 */
export function progressMarks(totalFrames: number, sampleRate: number, intervalSeconds: number = PROGRESS_INTERVAL_SECONDS): number[] {
  const step = Math.max(RENDER_QUANTUM, Math.round((intervalSeconds * sampleRate) / RENDER_QUANTUM) * RENDER_QUANTUM);
  const marks: number[] = [];
  for (let frame = step; frame + RENDER_QUANTUM < totalFrames; frame += step) marks.push(frame / sampleRate);
  return marks;
}
