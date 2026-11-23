/**
 * 녹음기 처리 함수(순수). AudioWorklet 없이도 단위 시험할 수 있게 계산만 따로 둔다(리미터의 `limiterCore.ts`와 같은 방식).
 *
 * - 입력의 여러 채널을 모노로 합쳐 4096 프레임씩 모아 내보낸다.
 * - 조각마다 256 프레임 단위의 최대값(파형용)을 같이 낸다. 화면은 이 값으로 녹음 중 파형을 그린다.
 * - 시작은 "이 프레임부터"로 예약한다(`arm`). 카운트인이 끝나는 바로 그 프레임에서 녹음이 시작되고 그 앞 소리는 버린다.
 *   예약한 프레임이 이미 지났으면(메시지가 늦게 닿았으면) 다음 블록부터 시작하고, 실제 첫 프레임은 `firstFrame`에 남는다.
 * - 입력이 끊겨 채널이 없는 블록은 0으로 채운다: 오디오 시계와 샘플 수가 어긋나지 않게 한다.
 */
export const RECORDER_CHUNK_FRAMES = 4096;
export const RECORDER_PEAK_FRAMES = 256;

export interface RecorderChunk {
  /** 모노 샘플. 길이는 4096(마지막 조각만 더 짧을 수 있다) */
  samples: Float32Array;
  /** 256 프레임마다의 최대 절댓값 */
  peaks: Float32Array;
  /** 이 조각의 첫 샘플이 놓인 오디오 시계 위치(프레임) */
  firstFrame: number;
}

export class ChunkRecorder {
  private readonly emit: (chunk: RecorderChunk) => void;
  private readonly chunkFrames: number;
  private readonly peakFrames: number;
  private armed = false;
  private startFrame = 0;
  private chunk: Float32Array;
  private peaks: Float32Array;
  private filled = 0;
  private chunkFirstFrame = 0;
  /** 녹음된 첫 샘플의 오디오 시계 위치(프레임). 아직 없으면 -1 */
  firstFrame = -1;
  /** 지금까지 모은 프레임 수 */
  framesCaptured = 0;

  constructor(emit: (chunk: RecorderChunk) => void, chunkFrames = RECORDER_CHUNK_FRAMES, peakFrames = RECORDER_PEAK_FRAMES) {
    this.emit = emit;
    this.chunkFrames = chunkFrames;
    this.peakFrames = peakFrames;
    this.chunk = new Float32Array(chunkFrames);
    this.peaks = new Float32Array(Math.ceil(chunkFrames / peakFrames));
  }

  /** 이 프레임부터 담기 시작한다. 이미 담는 중이면 무시한다. */
  arm(startFrame: number): void {
    if (this.armed) return;
    this.startFrame = Math.max(0, Math.floor(startFrame) || 0);
    this.armed = true;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /**
   * 한 블록(보통 128 프레임)을 받는다.
   * @param channels 입력 채널들(없을 수 있다)
   * @param blockStartFrame 이 블록의 첫 프레임이 놓인 오디오 시계 위치(AudioWorklet의 `currentFrame`)
   * @param length 블록 길이(프레임). 채널이 없을 때 알려 준다.
   */
  process(channels: ArrayLike<Float32Array>, blockStartFrame: number, length: number = channels[0]?.length ?? 0): void {
    if (!this.armed || length <= 0) return;
    if (blockStartFrame + length <= this.startFrame) return; // 아직 시작 전
    let index = Math.max(0, this.startFrame - blockStartFrame);
    if (this.firstFrame < 0) this.firstFrame = blockStartFrame + index;
    const count = channels.length;
    for (; index < length; index += 1) {
      let sample = 0;
      for (let channel = 0; channel < count; channel += 1) sample += channels[channel][index] || 0;
      if (count > 1) sample /= count;
      if (this.filled === 0) this.chunkFirstFrame = blockStartFrame + index;
      this.chunk[this.filled] = sample;
      const magnitude = sample < 0 ? -sample : sample;
      const slot = Math.floor(this.filled / this.peakFrames);
      if (magnitude > this.peaks[slot]) this.peaks[slot] = magnitude;
      this.filled += 1;
      this.framesCaptured += 1;
      if (this.filled === this.chunkFrames) this.flush();
    }
  }

  /** 담기를 끝내고 남은 조각을 내보낸다. */
  stop(): void {
    this.armed = false;
    if (this.filled > 0) this.flush();
  }

  private flush(): void {
    const full = this.filled === this.chunkFrames;
    const samples = full ? this.chunk : this.chunk.slice(0, this.filled);
    const peaks = full ? this.peaks : this.peaks.slice(0, Math.ceil(this.filled / this.peakFrames));
    const firstFrame = this.chunkFirstFrame;
    this.chunk = new Float32Array(this.chunkFrames);
    this.peaks = new Float32Array(Math.ceil(this.chunkFrames / this.peakFrames));
    this.filled = 0;
    this.emit({ samples, peaks, firstFrame });
  }
}
