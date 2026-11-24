/**
 * 컴프레서 바늘(설계서 P5-6): 실제로 줄이고 있는 음량(dB)을 바늘 각도로 바꾼다. 화면·소리를 모르는 순수 계산이다.
 *
 * 입력은 `DynamicsCompressorNode.reduction`이 돌려주는 값이다. 0 이하의 dB이고 −6이면 6 dB를 줄이는 중이다.
 * 예전 바늘은 이 값이 아니라 기준 음량(threshold) 노브를 따라 움직여서 소리와 상관없이 노브만 돌리면 바늘이 움직였다.
 *
 * 눈금은 왼쪽 끝 20에서 오른쪽 끝 0까지 여덟 칸이다(`NEEDLE_SCALE_DB`, 화면의 숫자와 같다).
 * 바늘은 줄이는 것이 없으면 오른쪽 끝(0)에 서고, 20 dB 이상 줄이면 왼쪽 끝(20)에서 멈춘다.
 * 칸 사이는 직선으로 이으므로 −5 dB는 눈금 "5" 바로 위를 가리킨다(아날로그 미터처럼 눈금 간격이 dB에 비례하지 않는다).
 */

/** 화면에 적힌 눈금(왼쪽 → 오른쪽). 첫 값이 바늘의 끝(−20 dB), 마지막 값이 쉬는 자리(0 dB)다. */
export const NEEDLE_SCALE_DB: readonly number[] = [20, 15, 10, 7, 5, 3, 1, 0];

/** 바늘이 끝까지 가는 압축량(dB) */
export const NEEDLE_FULL_DB = 20;

/** 바늘의 각도(도, 시계 방향이 +). 왼쪽 끝은 −80°, 쉬는 자리(오른쪽 끝)는 +80°다. */
export const NEEDLE_MIN_ANGLE = -80;
export const NEEDLE_MAX_ANGLE = 80;

/** 눈금 하나(`index`)가 놓인 각도: 여덟 칸이 −80°~+80°에 고르게 놓인다. */
function scaleAngle(index: number): number {
  return NEEDLE_MIN_ANGLE + ((NEEDLE_MAX_ANGLE - NEEDLE_MIN_ANGLE) * index) / (NEEDLE_SCALE_DB.length - 1);
}

/**
 * 압축량(dB, 0 이하) → 바늘 각도(도). 줄이는 것이 없거나 숫자가 아니면 쉬는 자리(+80°), 20 dB 이상이면 끝(−80°).
 * 0보다 큰 값은 압축이 아니므로 0으로 본다.
 */
export function needleAngle(reductionDb: number): number {
  if (Number.isNaN(reductionDb)) return NEEDLE_MAX_ANGLE;
  const amount = Math.min(NEEDLE_FULL_DB, Math.max(0, -reductionDb));
  for (let index = 0; index < NEEDLE_SCALE_DB.length - 1; index += 1) {
    const high = NEEDLE_SCALE_DB[index];
    const low = NEEDLE_SCALE_DB[index + 1];
    if (amount > high || amount < low) continue;
    const fraction = (high - amount) / (high - low);
    return scaleAngle(index) + (scaleAngle(index + 1) - scaleAngle(index)) * fraction;
  }
  return NEEDLE_MAX_ANGLE;
}

/** 표시용 압축량: 0 이하로 맞추고 소수 첫째 자리까지만 남긴다(−0은 0으로). 숫자가 아니면 0. */
export function displayReduction(reductionDb: number): number {
  if (!Number.isFinite(reductionDb)) return 0;
  const rounded = Math.round(Math.min(0, reductionDb) * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}
